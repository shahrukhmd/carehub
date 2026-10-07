import "server-only";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney, patientName } from "@/lib/format";
import { claimNumber, OPEN_AR_STATUSES } from "@/lib/claim-format";
import { logClaimEvent, refreshVisitBillingStatus } from "@/lib/claims";
import { createPaymentLink } from "@/lib/connect/payments";
import { sendMessage } from "@/lib/connect/core";
import { createTask } from "@/lib/tasks";
import { collectPayment, patientCredit } from "@/lib/checkout";
import { practiceLetterhead } from "@/lib/prescriptions";
import { Flow, MUTED, letterhead, newPdf } from "@/lib/pdf-kit";
import { ensureFollowUp, resolveFollowUps } from "@/lib/followups";

// Statement runs and dunning. One statement per guarantor per run, each claim carrying its own cycle count;
// after the practice's last cycle the account moves to the collections worklist. Payment plans and
// collections cases suppress statements. Delivery follows the patient's preference: paper (PDF), email with
// a secure pay link, or a portal notice.

const DAY = 86_400_000;
export const STATEMENT_CHANNELS: Record<string, string> = { PAPER: "Paper (PDF to print or mail)", EMAIL: "Email with pay link", PORTAL: "Portal notice" };
export const PLAN_FREQUENCIES: Record<string, { label: string; days: number }> = { WEEKLY: { label: "Weekly", days: 7 }, BIWEEKLY: { label: "Every two weeks", days: 14 }, MONTHLY: { label: "Monthly", days: 30 } };
export const PLAN_STATUSES: Record<string, string> = { ACTIVE: "Active", COMPLETED: "Completed", DEFAULTED: "Defaulted", CANCELLED: "Cancelled" };
export const COLLECTIONS_STATUSES: Record<string, string> = { REVIEW: "To decide", IN_HOUSE: "In-house calls", REFERRED: "Referred to agency", WRITTEN_OFF: "Written off", CLOSED: "Closed" };

const balanceOf = (c: { billedCents: number; paidCents: number; adjustedCents: number }) => Math.max(0, c.billedCents - c.paidCents - c.adjustedCents);

export async function statementSettings(practiceId: string) {
  const s = await prisma.practiceSettings.findUnique({ where: { practiceId }, select: { statementMinDays: true, statementCycles: true, statementMinCents: true, statementMessage1: true, statementMessage2: true, statementMessage3: true } });
  return {
    minDays: s?.statementMinDays ?? 28,
    cycles: s?.statementCycles ?? 3,
    minCents: s?.statementMinCents ?? 500,
    messages: [s?.statementMessage1 || "Thank you for choosing us. Your insurance has processed the visits below; the balance is now your responsibility.", s?.statementMessage2 || "Second notice: this balance is past due. Please pay or call us to set up a payment plan.", s?.statementMessage3 || "Final notice: this balance is seriously past due. Without payment or a payment plan it will be referred for collection."],
  };
}

export type Candidate = {
  guarantorId: string;
  guarantor: { id: string; firstName: string; lastName: string; mrn: string; email: string | null; statementPreference: string };
  claims: { id: string; number: string; patientId: string; balanceCents: number; cycle: number; lastStatementAt: Date | null; dueNow: boolean; dos: Date | null; payerName: string }[];
  totalCents: number;
  cycle: number;
  creditCents: number;
  blocked: string | null;
};

// Guarantors with a patient balance above the minimum, grouped with their dependents. "blocked" explains why a
// guarantor would be skipped (hold, plan, collections); "dueNow" on a claim means the minimum days have passed.
export async function statementCandidates(practiceId: string) {
  const s = await statementSettings(practiceId);
  const claims = await prisma.claim.findMany({
    where: { practiceId, balanceResponsibility: "PATIENT", status: { in: OPEN_AR_STATUSES } },
    include: { patient: { select: { id: true, firstName: true, lastName: true, mrn: true, email: true, statementPreference: true, statementHold: true, statementHoldReason: true, statementHoldUntil: true, guarantorPatientId: true } }, lines: { select: { dosFrom: true }, orderBy: { dosFrom: "asc" }, take: 1 } },
  });
  const groups = new Map<string, Candidate>();
  for (const c of claims) {
    const balance = balanceOf(c);
    if (balance <= 0) continue;
    const gid = c.patient.guarantorPatientId ?? c.patientId;
    let g = groups.get(gid);
    if (!g) {
      const guarantor = gid === c.patientId ? c.patient : await prisma.patient.findUnique({ where: { id: gid }, select: { id: true, firstName: true, lastName: true, mrn: true, email: true, statementPreference: true, statementHold: true, statementHoldReason: true, statementHoldUntil: true, guarantorPatientId: true } });
      if (!guarantor) continue;
      const [plan, coll, credit] = await Promise.all([
        prisma.paymentPlan.findFirst({ where: { patientId: gid, status: "ACTIVE" }, select: { id: true } }),
        prisma.collectionsCase.findFirst({ where: { patientId: gid, status: { in: ["REFERRED", "IN_HOUSE", "REVIEW"] } }, select: { status: true } }),
        patientCredit(gid),
      ]);
      const hold = guarantor.statementHold && (!guarantor.statementHoldUntil || guarantor.statementHoldUntil > new Date());
      g = {
        guarantorId: gid,
        guarantor,
        claims: [],
        totalCents: 0,
        cycle: 0,
        creditCents: credit,
        blocked: hold ? `On hold${guarantor.statementHoldReason ? `: ${guarantor.statementHoldReason}` : ""}` : plan ? "Active payment plan" : coll ? `In collections (${COLLECTIONS_STATUSES[coll.status]})` : null,
      };
      groups.set(gid, g);
    }
    const dueNow = !c.lastStatementAt || c.lastStatementAt.getTime() <= Date.now() - s.minDays * DAY;
    g.claims.push({ id: c.id, number: claimNumber(c), patientId: c.patientId, balanceCents: balance, cycle: c.statementCycle, lastStatementAt: c.lastStatementAt, dueNow, dos: c.lines[0]?.dosFrom ?? null, payerName: c.payerName });
    g.totalCents += balance;
    g.cycle = Math.max(g.cycle, c.statementCycle);
  }
  const out = [...groups.values()].filter((g) => g.totalCents >= s.minCents);
  for (const g of out) {
    if (!g.blocked && g.cycle >= s.cycles) g.blocked = `All ${s.cycles} statements sent — decide in Collections`;
    if (!g.blocked && !g.claims.some((c) => c.dueNow)) g.blocked = `Last statement under ${s.minDays} days ago`;
  }
  return { candidates: out.sort((a, b) => b.totalCents - a.totalCents), settings: s };
}

// Generates the statements for the chosen guarantors (default: everyone not blocked) and delivers each one.
export async function runStatements(practiceId: string, userId: string, guarantorIds: string[] | null, origin: string | null) {
  const { candidates, settings } = await statementCandidates(practiceId);
  const picked = candidates.filter((g) => !g.blocked && (!guarantorIds || guarantorIds.includes(g.guarantorId)));
  if (picked.length === 0) return { run: null, created: 0, sent: 0, toCollections: 0 };
  const run = await prisma.statementRun.create({ data: { practiceId, createdById: userId, status: "GENERATED", count: 0, totalCents: 0 } });
  let created = 0;
  let sent = 0;
  let toCollections = 0;
  const practice = await prisma.practice.findUniqueOrThrow({ where: { id: practiceId }, include: { connectSettings: true } });
  for (const g of picked) {
    const cycle = Math.min(settings.cycles, g.cycle + 1);
    const channel = g.guarantor.statementPreference in STATEMENT_CHANNELS ? g.guarantor.statementPreference : "PAPER";
    const statement = await prisma.statement.create({
      data: {
        practiceId,
        patientId: g.guarantorId,
        runId: run.id,
        cycle,
        channel,
        message: settings.messages[cycle - 1] ?? settings.messages[settings.messages.length - 1],
        totalCents: g.totalCents,
        lines: { create: g.claims.map((c) => ({ claimId: c.id, balanceCents: c.balanceCents })) },
      },
    });
    created++;
    // Each claim's cycle moves on only when its own minimum days have passed.
    for (const c of g.claims) {
      if (!c.dueNow) continue;
      await prisma.claim.update({ where: { id: c.id }, data: { statementCycle: { increment: 1 }, lastStatementAt: new Date() } });
      await logClaimEvent(c.id, userId, "STATEMENT", { note: `Statement ${cycle} of ${settings.cycles} (${STATEMENT_CHANNELS[channel]})` });
    }
    // Delivery.
    const clinic = practice.connectSettings?.displayName || practice.name;
    if (channel === "EMAIL" && g.guarantor.email) {
      try {
        const { link } = await createPaymentLink(practiceId, g.guarantorId, userId, "LINK", origin);
        const msg = await sendMessage({ practiceId, channel: "EMAIL", to: g.guarantor.email, subject: `${clinic}: statement ${cycle} — balance ${formatMoney(g.totalCents)}`, body: `${settings.messages[cycle - 1]}\n\nBalance: ${formatMoney(g.totalCents)}\nPay securely online: ${link}\n\n${clinic}`, kind: "OTHER", patientId: g.guarantorId, userId });
        if (msg.status === "SENT") sent++;
        await prisma.statement.update({ where: { id: statement.id }, data: { status: msg.status === "SENT" ? "SENT" : "GENERATED", sentAt: msg.status === "SENT" ? new Date() : null, deliveryNote: msg.error } });
      } catch (err) {
        await prisma.statement.update({ where: { id: statement.id }, data: { deliveryNote: err instanceof Error ? err.message : String(err) } });
      }
    } else if (channel === "PORTAL") {
      await sendMessage({ practiceId, channel: "EMAIL", to: g.guarantor.email, subject: `${clinic}: a new statement is ready`, body: `A statement for ${formatMoney(g.totalCents)} is ready in your patient portal.`, kind: "OTHER", patientId: g.guarantorId, userId });
      await prisma.statement.update({ where: { id: statement.id }, data: { status: "SENT", sentAt: new Date() } });
      sent++;
    }
    // After the last cycle the account goes to the collections worklist.
    if (cycle >= settings.cycles) {
      const open = await prisma.collectionsCase.findFirst({ where: { patientId: g.guarantorId, status: { in: ["REVIEW", "IN_HOUSE", "REFERRED"] } } });
      if (!open) {
        const cc = await prisma.collectionsCase.create({ data: { practiceId, patientId: g.guarantorId, balanceCents: g.totalCents, status: "REVIEW", createdById: userId, note: `After ${settings.cycles} statements` } });
        await createTask({ practiceId, type: "BILLING", title: `Collections decision — ${patientName(g.guarantor)} · ${formatMoney(g.totalCents)}`, body: `All ${settings.cycles} statements sent. Decide: write off, in-house calls, or refer to the agency.`, patientId: g.guarantorId, assignedRole: "BILLER", priority: "HIGH", link: `/statements?tab=collections`, sourceType: "COLLECTIONS_REVIEW", sourceId: cc.id });
        toCollections++;
      }
    }
  }
  await prisma.statementRun.update({ where: { id: run.id }, data: { count: created, totalCents: picked.reduce((s, g) => s + g.totalCents, 0) } });
  return { run, created, sent, toCollections };
}

// The printable statement.
export async function statementPdf(statementId: string, practiceId: string) {
  const s = await prisma.statement.findFirstOrThrow({ where: { id: statementId, practiceId }, include: { patient: true, lines: { include: { claim: { include: { lines: { select: { dosFrom: true }, orderBy: { dosFrom: "asc" }, take: 1 }, patient: { select: { firstName: true, lastName: true } }, encounter: { select: { provider: { select: { name: true } } } } } } } } } });
  const settings = await statementSettings(practiceId);
  const { pdf, font, bold } = await newPdf(`Statement ${formatDate(s.createdAt)}`);
  const f = new Flow(pdf, font, bold);
  letterhead(f, await practiceLetterhead(practiceId));
  f.text(`PATIENT STATEMENT${s.cycle > 1 ? ` — notice ${s.cycle} of ${settings.cycles}` : ""}`, { size: 14, bold: true });
  f.text(`${formatDate(s.createdAt)} · Account ${s.patient.mrn}`, { size: 10, color: MUTED });
  f.gap(6);
  f.text(`${s.patient.firstName} ${s.patient.lastName}`);
  for (const line of [s.patient.addressLine1, s.patient.addressLine2, [s.patient.city, s.patient.state, s.patient.zip].filter(Boolean).join(" ")].filter(Boolean)) f.text(String(line), { size: 10 });
  f.gap(10);
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0 };
  for (const l of s.lines) {
    const dos = l.claim.lines[0]?.dosFrom ?? l.claim.createdAt;
    const age = Math.floor((s.createdAt.getTime() - dos.getTime()) / DAY);
    if (age <= 30) buckets.current += l.balanceCents;
    else if (age <= 60) buckets.d30 += l.balanceCents;
    else if (age <= 90) buckets.d60 += l.balanceCents;
    else buckets.d90 += l.balanceCents;
    f.text(`${formatDate(dos)}  ${l.claim.patient.firstName} ${l.claim.patient.lastName}  ${l.claim.encounter.provider.name}  ${l.claim.payerName}  ${claimNumber(l.claim)}`, { size: 9.5 });
    f.text(`   Charges ${formatMoney(l.claim.billedCents)} · insurance paid ${formatMoney(l.claim.paidCents)} · adjustments ${formatMoney(l.claim.adjustedCents)} · you owe ${formatMoney(l.balanceCents)}`, { size: 9.5, color: MUTED });
  }
  f.gap(8);
  f.text(`Current ${formatMoney(buckets.current)}   31-60 days ${formatMoney(buckets.d30)}   61-90 days ${formatMoney(buckets.d60)}   Over 90 ${formatMoney(buckets.d90)}`, { size: 9.5, color: MUTED });
  f.text(`AMOUNT DUE: ${formatMoney(s.totalCents)}`, { size: 13, bold: true });
  f.gap(8);
  if (s.message) f.text(s.message, { size: 10 });
  f.gap(6);
  f.text("Pay by check to the address above, by card at the front desk, or online through the link in your email or portal. Questions: call our billing office.", { size: 9, color: MUTED });
  return Buffer.from(await pdf.save());
}

// ---- Payment plans ----

export async function createPaymentPlan(input: { practiceId: string; patientId: string; totalCents: number; installmentCents: number; frequency: string; firstDueAt: Date; method: string; cardRef?: string | null; note?: string | null; userId: string }) {
  const freq = PLAN_FREQUENCIES[input.frequency] ?? PLAN_FREQUENCIES.MONTHLY;
  const n = Math.max(1, Math.ceil(input.totalCents / input.installmentCents));
  const plan = await prisma.paymentPlan.create({
    data: {
      practiceId: input.practiceId,
      patientId: input.patientId,
      totalCents: input.totalCents,
      installmentCents: input.installmentCents,
      frequency: input.frequency in PLAN_FREQUENCIES ? input.frequency : "MONTHLY",
      method: input.method === "CARD_ON_FILE" ? "CARD_ON_FILE" : "MANUAL",
      cardRef: input.cardRef ?? null,
      note: input.note ?? null,
      nextDueAt: input.firstDueAt,
      createdById: input.userId,
      installments: {
        create: Array.from({ length: n }, (_, i) => ({
          dueAt: new Date(input.firstDueAt.getTime() + i * freq.days * DAY),
          amountCents: i === n - 1 ? input.totalCents - input.installmentCents * (n - 1) : input.installmentCents,
        })),
      },
    },
  });
  // A plan closes the collections review and pauses follow-ups on the patient's claims.
  await prisma.collectionsCase.updateMany({ where: { patientId: input.patientId, status: "REVIEW" }, data: { status: "CLOSED", outcome: "Payment plan set up", closedAt: new Date() } });
  return plan;
}

// Posts one installment as a patient payment on the balance (front-desk receipt + deposit), marks it paid, and
// completes the plan after the last one.
export async function recordInstallment(input: { practiceId: string; planId: string; installmentId: string; method: string; reference?: string | null; userId: string }) {
  const inst = await prisma.paymentPlanInstallment.findFirstOrThrow({ where: { id: input.installmentId, planId: input.planId, plan: { practiceId: input.practiceId } }, include: { plan: true } });
  if (inst.status === "PAID") return inst;
  const { receipt } = await collectPayment({ practiceId: input.practiceId, patientId: inst.plan.patientId, amountCents: inst.amountCents, kind: "BALANCE", method: input.method, reference: input.reference ?? null, note: `Payment plan installment`, userId: input.userId });
  await prisma.paymentPlanInstallment.update({ where: { id: inst.id }, data: { status: "PAID", paidAt: new Date(), receiptId: receipt.id } });
  const remaining = await prisma.paymentPlanInstallment.count({ where: { planId: inst.planId, status: { in: ["DUE", "MISSED"] } } });
  const next = await prisma.paymentPlanInstallment.findFirst({ where: { planId: inst.planId, status: { in: ["DUE", "MISSED"] } }, orderBy: { dueAt: "asc" } });
  await prisma.paymentPlan.update({ where: { id: inst.planId }, data: { paidCents: { increment: inst.amountCents }, missed: 0, nextDueAt: next?.dueAt ?? null, status: remaining === 0 ? "COMPLETED" : "ACTIVE", completedAt: remaining === 0 ? new Date() : null } });
  if (remaining === 0) {
    for (const c of await prisma.claim.findMany({ where: { patientId: inst.plan.patientId, balanceResponsibility: "PATIENT", status: { in: OPEN_AR_STATUSES } }, select: { id: true, encounterId: true } })) {
      await resolveFollowUps(c.id, "PAID", input.userId);
      await refreshVisitBillingStatus(c.encounterId);
    }
  }
  return inst;
}

// Nightly: installments past due become MISSED; two missed instalments default the plan and the balance goes
// back to the statement cycle with a task for the billing team.
export async function runPaymentPlanJob() {
  const overdue = await prisma.paymentPlanInstallment.findMany({ where: { status: "DUE", dueAt: { lt: new Date(Date.now() - DAY) }, plan: { status: "ACTIVE" } }, include: { plan: { include: { patient: true } } } });
  let missed = 0;
  let defaulted = 0;
  for (const inst of overdue) {
    await prisma.paymentPlanInstallment.update({ where: { id: inst.id }, data: { status: "MISSED" } });
    const plan = await prisma.paymentPlan.update({ where: { id: inst.planId }, data: { missed: { increment: 1 } } });
    missed++;
    if (plan.missed >= 2) {
      await prisma.paymentPlan.update({ where: { id: plan.id }, data: { status: "DEFAULTED" } });
      await createTask({ practiceId: plan.practiceId, type: "BILLING", title: `Payment plan defaulted — ${patientName(inst.plan.patient)} · ${formatMoney(plan.totalCents - plan.paidCents)} left`, body: "Two instalments were missed. The balance returns to the statement cycle.", patientId: plan.patientId, assignedRole: "BILLER", priority: "HIGH", link: `/statements?tab=plans`, sourceType: "PLAN_DEFAULT", sourceId: plan.id });
      for (const c of await prisma.claim.findMany({ where: { patientId: plan.patientId, balanceResponsibility: "PATIENT", status: { in: OPEN_AR_STATUSES } }, select: { id: true } })) {
        await ensureFollowUp({ claimId: c.id, trigger: "PATIENT_BALANCE", note: "Payment plan defaulted", userId: null, status: "WAITING_PATIENT" });
      }
      defaulted++;
    } else {
      await createTask({ practiceId: plan.practiceId, type: "BILLING", title: `Missed instalment — ${patientName(inst.plan.patient)} · ${formatMoney(inst.amountCents)} due ${formatDate(inst.dueAt)}`, patientId: plan.patientId, assignedRole: "BILLER", priority: "NORMAL", link: `/statements?tab=plans`, sourceType: "PLAN_MISSED", sourceId: inst.id });
    }
  }
  return `${missed} missed, ${defaulted} defaulted`;
}

// ---- Collections ----

export async function decideCollections(input: { practiceId: string; caseId: string; decision: "IN_HOUSE" | "REFERRED" | "WRITTEN_OFF" | "CLOSED"; agency?: string | null; note?: string | null; userId: string }) {
  const cc = await prisma.collectionsCase.findFirstOrThrow({ where: { id: input.caseId, practiceId: input.practiceId }, include: { patient: true } });
  const data: Record<string, unknown> = { status: input.decision, note: input.note ?? cc.note, decidedById: input.userId, decidedAt: new Date() };
  if (input.decision === "REFERRED") Object.assign(data, { agency: input.agency ?? null, referredAt: new Date() });
  if (input.decision === "CLOSED" || input.decision === "WRITTEN_OFF") Object.assign(data, { closedAt: new Date(), outcome: input.note ?? null });
  await prisma.collectionsCase.update({ where: { id: cc.id }, data });
  if (input.decision === "WRITTEN_OFF") {
    for (const c of await prisma.claim.findMany({ where: { patientId: cc.patientId, balanceResponsibility: "PATIENT", status: { in: OPEN_AR_STATUSES } } })) {
      const bal = balanceOf(c);
      if (bal <= 0) continue;
      await prisma.claim.update({ where: { id: c.id }, data: { adjustedCents: c.adjustedCents + bal, status: "WRITTEN_OFF", statusNote: `Collections write-off${input.note ? `: ${input.note}` : ""}` } });
      await logClaimEvent(c.id, input.userId, "ADJUSTMENT", { field: "status", oldValue: c.status, newValue: "WRITTEN_OFF", note: `Collections write-off ${formatMoney(bal)}` });
      await resolveFollowUps(c.id, "WRITTEN_OFF", input.userId);
      await refreshVisitBillingStatus(c.encounterId);
    }
  }
  if (input.decision === "REFERRED") {
    for (const c of await prisma.claim.findMany({ where: { patientId: cc.patientId, balanceResponsibility: "PATIENT", status: { in: OPEN_AR_STATUSES } }, select: { id: true, encounterId: true } })) {
      await prisma.claim.update({ where: { id: c.id }, data: { status: "IN_COLLECTION" } });
      await logClaimEvent(c.id, input.userId, "STATUS", { field: "status", newValue: "IN_COLLECTION", note: `Referred to ${input.agency ?? "collection agency"}` });
      await refreshVisitBillingStatus(c.encounterId);
    }
  }
  return cc;
}

// The agency file: one CSV row per referred account.
export async function collectionsExport(practiceId: string) {
  const rows = await prisma.collectionsCase.findMany({ where: { practiceId, status: "REFERRED" }, include: { patient: true } });
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["Account", "Last name", "First name", "DOB", "Address", "City", "State", "ZIP", "Phone", "Balance", "Referred", "Agency"];
  const lines = rows.map((r) => [r.patient.mrn, r.patient.lastName, r.patient.firstName, r.patient.dob.toISOString().slice(0, 10), r.patient.addressLine1, r.patient.city, r.patient.state, r.patient.zip, r.patient.phone, (r.balanceCents / 100).toFixed(2), r.referredAt?.toISOString().slice(0, 10), r.agency].map(esc).join(","));
  return [head.map(esc).join(","), ...lines].join("\r\n");
}

// A payment that arrives after referral is flagged so the agency can be told.
export async function flagPaymentAfterReferral(practiceId: string, patientId: string, amountCents: number, userId: string | null) {
  const cc = await prisma.collectionsCase.findFirst({ where: { practiceId, patientId, status: "REFERRED" }, include: { patient: true } });
  if (!cc) return false;
  await createTask({ practiceId, type: "BILLING", title: `Payment after referral — ${patientName(cc.patient)} · ${formatMoney(amountCents)}`, body: `Account was referred to ${cc.agency ?? "the agency"} on ${cc.referredAt ? formatDate(cc.referredAt) : "—"}. Tell the agency and adjust the placement.`, patientId, assignedRole: "BILLER", priority: "NORMAL", link: `/statements?tab=collections`, sourceType: "COLLECTIONS_PAYMENT", sourceId: `${cc.id}:${Date.now()}` });
  void userId;
  return true;
}
