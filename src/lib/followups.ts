import "server-only";
import { prisma } from "@/lib/prisma";
import { logClaimEvent } from "@/lib/claims";
import { OPEN_AR_STATUSES } from "@/lib/claim-format";
import { scheduleFor } from "@/lib/charge-schedules";
import { createTask } from "@/lib/tasks";

// The AR follow-up engine: every unpaid, underpaid, denied, rejected or unanswered claim becomes one worked
// item with a trigger, owner, priority, tickle date and SLA. Items are created by ERA posting, clearinghouse
// rejections and the nightly job; they resolve by themselves when a later remittance pays the claim.

export const FOLLOWUP_TRIGGERS: Record<string, string> = {
  NO_RESPONSE: "No response from payer",
  DENIAL: "Denied",
  UNDERPAYMENT: "Underpaid",
  REJECTION: "Clearinghouse rejection",
  PATIENT_BALANCE: "Patient balance",
};

export const FOLLOWUP_STATUSES: Record<string, string> = {
  OPEN: "Open",
  WAITING_PAYER: "Waiting on payer",
  WAITING_PRACTICE: "Waiting on practice",
  WAITING_PATIENT: "Waiting on patient",
  RESOLVED: "Resolved",
  WRITTEN_OFF: "Written off",
};
export const OPEN_FOLLOWUP_STATUSES = ["OPEN", "WAITING_PAYER", "WAITING_PRACTICE", "WAITING_PATIENT"];

// What a biller records on an item, and where each action leaves it (status + days to the next tickle).
export const FOLLOWUP_ACTIONS: Record<string, { label: string; status: string; tickleDays: number }> = {
  CALLED_PAYER: { label: "Called the payer", status: "WAITING_PAYER", tickleDays: 7 },
  PORTAL_CHECKED: { label: "Checked the payer portal", status: "WAITING_PAYER", tickleDays: 7 },
  RESUBMITTED: { label: "Resubmitted / corrected", status: "WAITING_PAYER", tickleDays: 14 },
  APPEALED: { label: "Appeal filed", status: "WAITING_PAYER", tickleDays: 30 },
  NEEDS_PRACTICE: { label: "Needs the practice (records, coding, auth)", status: "WAITING_PRACTICE", tickleDays: 3 },
  TO_PATIENT: { label: "Transferred to patient balance", status: "WAITING_PATIENT", tickleDays: 30 },
  NOTE: { label: "Note only", status: "OPEN", tickleDays: 7 },
};

export const DEFAULT_OUTSTANDING_DAYS = 30;
const DAY = 86_400_000;
const MAX_TICKLES_BEFORE_ESCALATION = 3;

const balanceOf = (c: { billedCents: number; paidCents: number; adjustedCents: number }) => Math.max(0, c.billedCents - c.paidCents - c.adjustedCents);

// Priority = balance band + age band + deadline band (0..9); the worklist sorts on it.
export function computePriority(input: { balanceCents: number; ageDays: number; deadlineDays: number | null }) {
  const balance = input.balanceCents >= 100_000 ? 3 : input.balanceCents >= 25_000 ? 2 : input.balanceCents >= 5_000 ? 1 : 0;
  const age = input.ageDays >= 90 ? 3 : input.ageDays >= 60 ? 2 : input.ageDays >= 30 ? 1 : 0;
  const deadline = input.deadlineDays === null ? 0 : input.deadlineDays <= 10 ? 3 : input.deadlineDays <= 30 ? 2 : input.deadlineDays <= 60 ? 1 : 0;
  return balance + age + deadline;
}

// The nearest hard date on the claim: the appeal deadline of an open denial, else the payer's timely-filing limit.
export async function claimDeadline(claim: { id: string; submittedAt: Date | null; payer?: { timelyFilingAlertDays: number | null } | null }): Promise<Date | null> {
  const denial = await prisma.claimDenial.findFirst({ where: { claimId: claim.id, status: { not: "RESOLVED" }, appealDueAt: { not: null } }, orderBy: { appealDueAt: "asc" }, select: { appealDueAt: true } });
  if (denial?.appealDueAt) return denial.appealDueAt;
  if (claim.submittedAt && claim.payer?.timelyFilingAlertDays) return new Date(claim.submittedAt.getTime() + claim.payer.timelyFilingAlertDays * DAY);
  return null;
}

async function refreshPriority(followUpId: string) {
  const f = await prisma.claimFollowUp.findUnique({ where: { id: followUpId }, include: { claim: { include: { payer: { select: { timelyFilingAlertDays: true } } } } } });
  if (!f) return;
  const deadline = await claimDeadline(f.claim);
  const priority = computePriority({
    balanceCents: balanceOf(f.claim),
    ageDays: Math.floor((Date.now() - (f.claim.submittedAt ?? f.createdAt).getTime()) / DAY),
    deadlineDays: deadline ? Math.ceil((deadline.getTime() - Date.now()) / DAY) : null,
  });
  await prisma.claimFollowUp.update({ where: { id: f.id }, data: { priority, deadlineAt: deadline, balanceCents: balanceOf(f.claim) } });
}

// One open follow-up per claim. A new trigger on a claim that already has one updates the trigger and note.
export async function ensureFollowUp(input: { claimId: string; trigger: keyof typeof FOLLOWUP_TRIGGERS; note: string; userId: string | null; expectedCents?: number | null; paidCents?: number | null; status?: string }) {
  const claim = await prisma.claim.findUniqueOrThrow({ where: { id: input.claimId }, include: { payer: { select: { outstandingDays: true } } } });
  const existing = await prisma.claimFollowUp.findFirst({ where: { claimId: claim.id, status: { in: OPEN_FOLLOWUP_STATUSES } } });
  const sla = new Date(Date.now() + (claim.payer?.outstandingDays ?? DEFAULT_OUTSTANDING_DAYS) * DAY);
  const data = {
    trigger: input.trigger,
    note: input.note.slice(0, 500),
    expectedCents: input.expectedCents ?? null,
    paidCents: input.paidCents ?? null,
    status: input.status ?? "OPEN",
    lastActionAt: new Date(),
  };
  const f = existing
    ? await prisma.claimFollowUp.update({ where: { id: existing.id }, data })
    : await prisma.claimFollowUp.create({ data: { practiceId: claim.practiceId, claimId: claim.id, ...data, tickleAt: new Date(Date.now() + 7 * DAY), slaDueAt: sla, balanceCents: balanceOf(claim) } });
  await refreshPriority(f.id);
  await logClaimEvent(claim.id, input.userId, "FOLLOWUP", { note: `${existing ? "Follow-up updated" : "Follow-up opened"}: ${FOLLOWUP_TRIGGERS[input.trigger]} — ${input.note}` });
  return f;
}

// Paid in full, written off or voided: the open follow-up closes by itself.
export async function resolveFollowUps(claimId: string, reason: string, userId: string | null) {
  const open = await prisma.claimFollowUp.findMany({ where: { claimId, status: { in: OPEN_FOLLOWUP_STATUSES } } });
  for (const f of open) {
    await prisma.claimFollowUp.update({ where: { id: f.id }, data: { status: reason === "WRITTEN_OFF" ? "WRITTEN_OFF" : "RESOLVED", resolvedReason: reason, resolvedAt: new Date(), lastActionAt: new Date() } });
    await logClaimEvent(claimId, userId, "FOLLOWUP", { note: `Follow-up resolved: ${reason}` });
  }
  return open.length;
}

// An ERA that paid less than the charge schedule's allowable (beyond the practice's tolerance) is an underpayment.
export async function expectedAllowable(claim: { practiceId: string; payerId: string | null; renderingProviderId: string | null; serviceLocationId: string | null; lines: { cptCode: string; units: number; dosFrom: Date }[] }) {
  if (claim.lines.length === 0) return null;
  const sched = await scheduleFor(claim.practiceId, { date: claim.lines[0].dosFrom, payerId: claim.payerId, locationId: claim.serviceLocationId, providerId: claim.renderingProviderId });
  if (!sched) return null;
  let total = 0;
  let any = false;
  for (const l of claim.lines) {
    const a = sched.fees.get(l.cptCode.toUpperCase())?.allowedCents;
    if (a === null || a === undefined) continue;
    any = true;
    total += a * Math.max(1, l.units);
  }
  return any ? total : null;
}

// Nightly: claims out with a payer past the payer's outstanding days and no remittance get a NO_RESPONSE item;
// items past their SLA or tickled three times without progress are escalated to the billing supervisor pool.
export async function runFollowUpJob() {
  const practices = await prisma.practice.findMany({ select: { id: true } });
  let created = 0;
  let escalated = 0;
  for (const p of practices) {
    const candidates = await prisma.claim.findMany({
      where: { practiceId: p.id, status: { in: ["SUBMITTED", "ACCEPTED"] }, submittedAt: { not: null }, paidCents: 0, followUps: { none: { status: { in: OPEN_FOLLOWUP_STATUSES } } } },
      include: { payer: { select: { outstandingDays: true, name: true } } },
    });
    for (const c of candidates) {
      const days = c.payer?.outstandingDays ?? DEFAULT_OUTSTANDING_DAYS;
      const age = Math.floor((Date.now() - c.submittedAt!.getTime()) / DAY);
      if (age < days) continue;
      await ensureFollowUp({ claimId: c.id, trigger: "NO_RESPONSE", note: `No remittance ${age} days after submission (${c.payer?.name ?? "payer"} allows ${days})`, userId: null });
      created++;
    }
    const stale = await prisma.claimFollowUp.findMany({
      where: { practiceId: p.id, status: { in: OPEN_FOLLOWUP_STATUSES }, escalatedAt: null, OR: [{ slaDueAt: { lt: new Date() } }, { tickles: { gte: MAX_TICKLES_BEFORE_ESCALATION } }] },
      include: { claim: { include: { patient: true } } },
    });
    for (const f of stale) {
      await prisma.claimFollowUp.update({ where: { id: f.id }, data: { escalatedAt: new Date() } });
      await createTask({
        practiceId: p.id,
        type: "BILLING",
        title: `Follow-up escalated — ${f.claim.patient.lastName}, ${f.claim.patient.firstName} · ${f.claim.payerName} · ${(f.balanceCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}`,
        body: `${FOLLOWUP_TRIGGERS[f.trigger] ?? f.trigger}: ${f.note ?? ""}\n${f.slaDueAt && f.slaDueAt < new Date() ? "Past its SLA." : `${f.tickles} tickles without a status change.`}`,
        patientId: f.claim.patientId,
        assignedToId: f.ownerId,
        assignedRole: "BILLER",
        priority: "HIGH",
        link: `/billing/claims/${f.claimId}#followup`,
        sourceType: "FOLLOWUP_ESCALATION",
        sourceId: f.id,
      });
      escalated++;
    }
    // Priorities move with age and deadlines.
    for (const f of await prisma.claimFollowUp.findMany({ where: { practiceId: p.id, status: { in: OPEN_FOLLOWUP_STATUSES } }, select: { id: true } })) await refreshPriority(f.id);
  }
  return `${created} opened, ${escalated} escalated`;
}

// Worklist rows for a practice.
export async function loadFollowUps(practiceId: string, filter: { view: string; userId: string; trigger?: string; q?: string }) {
  const soon = new Date(Date.now() + 10 * DAY);
  const today = new Date(new Date().toISOString().slice(0, 10));
  const where = {
    practiceId,
    ...(filter.trigger && filter.trigger in FOLLOWUP_TRIGGERS ? { trigger: filter.trigger } : {}),
    ...(filter.q ? { claim: { patient: { OR: [{ lastName: { contains: filter.q, mode: "insensitive" as const } }, { firstName: { contains: filter.q, mode: "insensitive" as const } }, { mrn: { contains: filter.q, mode: "insensitive" as const } }] } } } : {}),
    ...(filter.view === "mine"
      ? { status: { in: OPEN_FOLLOWUP_STATUSES }, ownerId: filter.userId }
      : filter.view === "unassigned"
        ? { status: { in: OPEN_FOLLOWUP_STATUSES }, ownerId: null }
        : filter.view === "due"
          ? { status: { in: OPEN_FOLLOWUP_STATUSES }, tickleAt: { lt: new Date(today.getTime() + DAY) } }
          : filter.view === "deadlines"
            ? { status: { in: OPEN_FOLLOWUP_STATUSES }, deadlineAt: { lte: soon } }
            : filter.view === "resolved"
              ? { status: { in: ["RESOLVED", "WRITTEN_OFF"] } }
              : filter.view === "all"
                ? {}
                : { status: { in: OPEN_FOLLOWUP_STATUSES } }),
  };
  return prisma.claimFollowUp.findMany({
    where,
    include: { claim: { include: { patient: { select: { id: true, firstName: true, lastName: true, mrn: true } }, lines: { select: { dosFrom: true }, orderBy: { dosFrom: "asc" }, take: 1 } } }, owner: { select: { id: true, name: true } } },
    orderBy: [{ priority: "desc" }, { tickleAt: "asc" }],
    take: 300,
  });
}

// Open AR claims that have no follow-up yet (for the supervisor to create and assign in bulk).
export async function unworkedClaims(practiceId: string) {
  return prisma.claim.findMany({
    where: { practiceId, status: { in: OPEN_AR_STATUSES }, followUps: { none: { status: { in: OPEN_FOLLOWUP_STATUSES } } } },
    include: { patient: { select: { firstName: true, lastName: true } } },
    orderBy: { submittedAt: "asc" },
    take: 200,
  });
}

export const followUpBalance = balanceOf;
