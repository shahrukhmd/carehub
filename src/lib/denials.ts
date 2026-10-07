import "server-only";
import { prisma } from "@/lib/prisma";
import { logClaimEvent } from "@/lib/claims";
import { claimNumber } from "@/lib/claim-format";
import { CARC } from "@/lib/era";
import { formatDate, formatMoney, patientName } from "@/lib/format";
import { Flow, MUTED, letterhead, newPdf } from "@/lib/pdf-kit";
import { practiceLetterhead } from "@/lib/prescriptions";
import { completeSourceTasks, createTask } from "@/lib/tasks";
import { rolesFor } from "@/lib/permissions";

// Payer denials: one ClaimDenial per denial (kept as history), a worklist, appeals with deadlines and letters.

export const DENIAL_ROLES = rolesFor("billing.work");
// Used when the payer has no appeal limit set in its insurance record.
export const DEFAULT_APPEAL_DAYS = 120;
export const APPEAL_ALERT_DAYS = 14;
const APPEAL_DECISION_DAYS = 45;
const DAY = 86_400_000;

export type DenialAction = "CORRECT" | "RESUBMIT" | "APPEAL" | "REVIEW";

export const DENIAL_CATEGORIES: Record<string, { label: string; fix: string; action: DenialAction }> = {
  ELIGIBILITY: {
    label: "Eligibility / coverage",
    fix: "Re-run eligibility for the date of service. If coverage was active, appeal with the eligibility response; if another plan was active, update the patient's insurance and bill the right payer.",
    action: "REVIEW",
  },
  COB: {
    label: "Coordination of benefits",
    fix: "Confirm which plan is primary with the patient, correct the insurance order, then bill the primary payer or resubmit with the primary payer's remittance.",
    action: "CORRECT",
  },
  AUTHORIZATION: {
    label: "Authorization / referral",
    fix: "Check the intake case for an authorization covering this date of service. Add the number and send a corrected claim, or appeal with the authorization letter or a retro-authorization request.",
    action: "APPEAL",
  },
  CODING: {
    label: "Coding / bundling",
    fix: "Review the CPT, modifier and diagnosis pointers against the visit note. Fix the coding and send a corrected claim (frequency 7); appeal only if the original coding is supported by the note.",
    action: "CORRECT",
  },
  INFORMATION: {
    label: "Missing / invalid information",
    fix: "Read the remark codes for what is missing, add it to the claim and send a corrected claim.",
    action: "CORRECT",
  },
  DUPLICATE: {
    label: "Duplicate claim",
    fix: "Check whether the original claim was already paid or is still in process. If this was a separate service, send a corrected claim with the right modifier and an explanation.",
    action: "REVIEW",
  },
  TIMELY_FILING: {
    label: "Timely filing",
    fix: "Appeal with proof of timely filing — the clearinghouse acceptance report showing the original submission date.",
    action: "APPEAL",
  },
  MEDICAL_NECESSITY: {
    label: "Medical necessity",
    fix: "Appeal with the visit note, wound measurements and photos, failed conservative treatment and the payer's coverage policy (LCD/NCD).",
    action: "APPEAL",
  },
  NON_COVERED: {
    label: "Non-covered service / benefit limit",
    fix: "Check the plan benefits. If the service is excluded, transfer the balance to the patient (ABN on file for Medicare); if it should be covered, appeal with the benefit language.",
    action: "REVIEW",
  },
  CREDENTIALING: {
    label: "Provider enrollment / network",
    fix: "Check the provider's enrollment with this payer in Credentialing. Resubmit once the enrollment is effective, or rebill under the supervising provider if the payer allows it.",
    action: "REVIEW",
  },
  OTHER: {
    label: "Other",
    fix: "Read the payer's reason and remark codes, call the payer if it is unclear, then correct the claim or appeal.",
    action: "REVIEW",
  },
};

export const DENIAL_ACTION_LABEL: Record<DenialAction, string> = {
  CORRECT: "Correct & resend",
  RESUBMIT: "Resubmit",
  APPEAL: "Appeal",
  REVIEW: "Review",
};

// Claim adjustment reason code -> denial category.
const CATEGORY_CODES: Record<string, string[]> = {
  ELIGIBILITY: ["26", "27", "31", "32", "33", "200"],
  COB: ["22", "23", "109"],
  AUTHORIZATION: ["15", "39", "197", "198", "243"],
  CODING: ["4", "5", "6", "9", "11", "59", "97", "181", "182", "234", "236", "B15"],
  INFORMATION: ["16", "129", "226", "227", "251", "252"],
  DUPLICATE: ["18", "B13"],
  TIMELY_FILING: ["29"],
  MEDICAL_NECESSITY: ["50", "55", "56", "150", "151", "152"],
  NON_COVERED: ["35", "49", "96", "119", "167", "204"],
  CREDENTIALING: ["170", "185", "242", "B7"],
};
const CODE_CATEGORY = new Map(Object.entries(CATEGORY_CODES).flatMap(([cat, codes]) => codes.map((c) => [c, cat] as const)));

export function categoryForCode(code: string | null | undefined) {
  return (code && CODE_CATEGORY.get(code.toUpperCase())) || "OTHER";
}

// Reason codes offered when a denial is keyed by hand, grouped by category.
export function denialCodeOptions() {
  return Object.entries(CATEGORY_CODES).map(([cat, codes]) => ({
    category: cat,
    label: DENIAL_CATEGORIES[cat].label,
    codes: codes.filter((c) => CARC[c]).map((c) => ({ code: c, text: CARC[c] })),
  }));
}

export const DENIAL_STATUS: Record<string, [string, string]> = {
  OPEN: ["To work", "bad"],
  APPEALED: ["Under appeal", "warn"],
  RESOLVED: ["Resolved", "ok"],
};

export const DENIAL_RESOLUTION: Record<string, string> = {
  RESUBMITTED: "Resubmitted",
  CORRECTED: "Corrected claim sent",
  OVERTURNED: "Appeal overturned",
  PAID: "Paid by payer",
  PATIENT: "Transferred to patient",
  WRITTEN_OFF: "Written off",
  VOIDED: "Claim voided",
};

export const APPEAL_LEVELS: Record<number, string> = {
  1: "First-level appeal (reconsideration)",
  2: "Second-level appeal",
  3: "External / independent review",
};

export const APPEAL_STATUS: Record<string, [string, string]> = {
  DRAFT: ["Draft — not filed", "warn"],
  FILED: ["Filed — awaiting decision", "info"],
  OVERTURNED: ["Overturned — payer will pay", "ok"],
  PARTIAL: ["Partly overturned", "ok"],
  UPHELD: ["Upheld — still denied", "bad"],
  WITHDRAWN: ["Withdrawn", "muted"],
};

export const APPEAL_METHODS: Record<string, string> = { FAX: "Fax", MAIL: "Mail", PORTAL: "Payer portal" };

// "CO-50 Not deemed a medical necessity" -> { groupCode: "CO", code: "50" }
export function parseDenialText(text: string | null | undefined) {
  const m = /\b(CO|PR|OA|PI|CR)-([A-Z]?\d{1,3})\b/.exec(text ?? "");
  return m ? { groupCode: m[1], code: m[2] } : { groupCode: null, code: null };
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// Whole calendar days from today (negative when past).
export function daysUntil(d: Date | null | undefined) {
  return d ? Math.round((dayStart(d) - dayStart(new Date())) / DAY) : null;
}

export function deadlineTone(days: number | null, alertDays = APPEAL_ALERT_DAYS) {
  if (days === null) return "muted";
  return days < 0 ? "bad" : days <= alertDays ? "warn" : "ok";
}

// The practice's appeal-alert window (Practice setup → Thresholds & timers).
export async function appealAlertDays(practiceId: string) {
  const s = await prisma.practiceSettings.findUnique({ where: { practiceId }, select: { appealAlertDays: true } });
  return s?.appealAlertDays ?? APPEAL_ALERT_DAYS;
}

export function deadlineLabel(d: Date | null | undefined) {
  const days = daysUntil(d);
  if (days === null || !d) return "—";
  return days < 0 ? `${formatDate(d)} · ${-days} days past` : days === 0 ? `${formatDate(d)} · today` : `${formatDate(d)} · ${days} days left`;
}

export async function appealLimitDays(payerId: string | null) {
  const payer = payerId ? await prisma.payer.findUnique({ where: { id: payerId }, select: { appealLimitDays: true } }) : null;
  return payer?.appealLimitDays || DEFAULT_APPEAL_DAYS;
}

// ---- Recording & resolving ----

// Called wherever a claim becomes denied. An unresolved denial is updated instead of stacking a second one.
export async function recordDenial(input: {
  claimId: string;
  source: "ERA" | "MANUAL";
  reason: string;
  groupCode?: string | null;
  code?: string | null;
  remarks?: string | null;
  category?: string | null;
  deniedAt?: Date;
  status?: "OPEN" | "APPEALED";
  userId: string | null;
  task?: boolean;
}) {
  const claim = await prisma.claim.findUniqueOrThrow({ where: { id: input.claimId }, include: { patient: true } });
  const parsed = input.code ? { groupCode: input.groupCode ?? null, code: input.code } : parseDenialText(input.reason);
  const code = parsed.code?.toUpperCase() ?? null;
  const category = input.category && DENIAL_CATEGORIES[input.category] ? input.category : categoryForCode(code);
  const data = {
    source: input.source,
    reason: input.reason.slice(0, 500),
    groupCode: parsed.groupCode,
    code,
    remarks: input.remarks?.slice(0, 200) || null,
    category,
    amountCents: Math.max(claim.billedCents - claim.paidCents - claim.adjustedCents, 0),
  };
  const open = await prisma.claimDenial.findFirst({ where: { claimId: claim.id, status: { not: "RESOLVED" } }, orderBy: { deniedAt: "desc" } });
  if (open) return prisma.claimDenial.update({ where: { id: open.id }, data });

  const deniedAt = input.deniedAt ?? new Date();
  const denial = await prisma.claimDenial.create({
    data: {
      ...data,
      practiceId: claim.practiceId,
      claimId: claim.id,
      deniedAt,
      status: input.status ?? "OPEN",
      appealDueAt: new Date(deniedAt.getTime() + (await appealLimitDays(claim.payerId)) * DAY),
    },
  });
  if (input.task !== false) {
    const cat = DENIAL_CATEGORIES[category];
    await createTask({
      practiceId: claim.practiceId,
      type: "DENIAL",
      title: `Denied claim ${claimNumber(claim)} — ${patientName(claim.patient)} · ${claim.payerName} · ${formatMoney(data.amountCents)}`,
      body: `${cat.label}: ${data.reason}\n\nSuggested next step: ${cat.fix}\n\nAppeal deadline ${formatDate(denial.appealDueAt!)}.`,
      patientId: claim.patientId,
      assignedRole: "BILLER",
      createdById: input.userId,
      priority: data.amountCents >= 50_000 ? "HIGH" : "NORMAL",
      dueAt: new Date(Date.now() + 3 * DAY),
      link: `/billing/claims/${claim.id}#denial`,
      sourceType: "CLAIM_DENIAL",
      sourceId: denial.id,
    });
  }
  return denial;
}

export async function closeDenialTasks(practiceId: string, denialId: string, userId: string | null) {
  for (const type of ["CLAIM_DENIAL", "APPEAL_DEADLINE", "APPEAL_FOLLOWUP"]) await completeSourceTasks(practiceId, type, denialId, userId);
}

// Closes the claim's unresolved denial(s) once it has been resubmitted, corrected, paid, transferred or written off.
export async function resolveDenials(claimId: string, resolution: string, userId: string | null) {
  const open = await prisma.claimDenial.findMany({ where: { claimId, status: { not: "RESOLVED" } }, include: { appeals: true } });
  for (const d of open) {
    const filed = d.appeals.filter((a) => a.status === "FILED");
    // A payment arriving while an appeal is pending means the payer overturned the denial.
    const overturned = resolution === "PAID" && filed.length > 0;
    await prisma.claimDenial.update({ where: { id: d.id }, data: { status: "RESOLVED", resolution: overturned ? "OVERTURNED" : resolution, resolvedAt: new Date() } });
    for (const a of filed) {
      await prisma.claimAppeal.update({ where: { id: a.id }, data: overturned ? { status: "OVERTURNED", decisionAt: new Date() } : { status: "WITHDRAWN", outcomeNote: DENIAL_RESOLUTION[resolution] ?? resolution } });
    }
    await prisma.claimAppeal.updateMany({ where: { denialId: d.id, status: "DRAFT" }, data: { status: "WITHDRAWN" } });
    await closeDenialTasks(d.practiceId, d.id, userId);
  }
  return open.length;
}

// Insurance money posted after a denial counts as recovered, on this claim or on the corrected claim that replaced it.
export async function creditRecovery(claimId: string, cents: number) {
  if (cents <= 0) return;
  const claim = await prisma.claim.findUnique({ where: { id: claimId }, select: { replacesClaimId: true } });
  const denial = await prisma.claimDenial.findFirst({
    where: { claimId: { in: [claimId, claim?.replacesClaimId ?? claimId] } },
    orderBy: { deniedAt: "desc" },
    include: { appeals: { where: { status: { in: ["FILED", "OVERTURNED", "PARTIAL"] } }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!denial) return;
  // Never more than was denied: anything beyond that is an overpayment, not recovered denial money.
  const recovered = Math.min(denial.recoveredCents + cents, Math.max(denial.amountCents, denial.recoveredCents));
  const added = recovered - denial.recoveredCents;
  if (added <= 0) return;
  await prisma.claimDenial.update({ where: { id: denial.id }, data: { recoveredCents: recovered } });
  const appeal = denial.appeals[0];
  if (appeal) await prisma.claimAppeal.update({ where: { id: appeal.id }, data: { recoveredCents: appeal.recoveredCents + added } });
}

// Denied claims from before this worklist existed (or set by another path) get their denial record here.
export async function ensureDenialRecords(practiceId: string) {
  const missing = await prisma.claim.findMany({
    where: { practiceId, status: { in: ["DENIED", "APPEAL"] }, denials: { none: { status: { not: "RESOLVED" } } } },
    select: { id: true, status: true, denialReason: true, statusNote: true, updatedAt: true },
  });
  for (const c of missing) {
    await recordDenial({
      claimId: c.id,
      source: parseDenialText(c.denialReason).code ? "ERA" : "MANUAL",
      reason: c.denialReason ?? c.statusNote ?? "No reason recorded",
      deniedAt: c.updatedAt,
      status: c.status === "APPEAL" ? "APPEALED" : "OPEN",
      userId: null,
      task: false,
    });
  }
  return missing.length;
}

// ---- Appeals ----

type LetterClaim = {
  payerName: string;
  priorAuthNumber: string | null;
  submittedAt: Date | null;
  billedCents: number;
  lines: { cptCode: string; dosFrom: Date }[];
  diagnoses: { icd10: string }[];
  renderingProvider: { name: string } | null;
};

const OPENING: Record<number, string> = {
  1: "We are writing to request reconsideration of the denial of the claim referenced above.",
  2: "We are writing to request a second-level appeal of the claim referenced above. Our first-level appeal was upheld, and we believe that decision was made in error.",
  3: "We are requesting an external, independent review of the claim referenced above. The plan's internal appeal process has been completed and the denial was upheld.",
};

const ARGUMENT: Record<string, (c: LetterClaim, dos: string) => string> = {
  ELIGIBILITY: (c, dos) =>
    `Our records show the patient's coverage with ${c.payerName} was active on ${dos}. Eligibility was verified before the visit, and a copy of the eligibility response is enclosed. Please reprocess the claim under the patient's active coverage.`,
  COB: () =>
    "The patient has confirmed that your plan is the correct payer for these services in the order billed. The other payer's explanation of benefits, or the patient's coordination of benefits statement, is enclosed. Please update your records and reprocess the claim.",
  AUTHORIZATION: (c) =>
    c.priorAuthNumber
      ? `These services were authorized under authorization number ${c.priorAuthNumber}, which covers the date of service. A copy of the authorization is enclosed. Please reprocess the claim with the authorization on file.`
      : "The services were medically urgent and could not be delayed for prior authorization without risk to the patient. We request a retroactive authorization review; the clinical documentation supporting the need for the services on this date is enclosed.",
  CODING: () =>
    "The procedure and diagnosis codes billed are supported by the enclosed visit documentation. The services were distinct and separately identifiable, and the modifiers reported reflect this. Please review the documentation and reprocess the claim as billed.",
  INFORMATION: () =>
    "The information requested in your denial is enclosed. Please reprocess the claim with this information.",
  DUPLICATE: (c, dos) =>
    `This claim is not a duplicate. The services billed on ${dos} were separate from any other claim on file, as shown in the enclosed documentation. Please reprocess the claim.`,
  TIMELY_FILING: (c) =>
    `The claim was originally submitted${c.submittedAt ? ` on ${formatDate(c.submittedAt)}` : ""}, within your timely filing limit. Proof of timely filing — the clearinghouse acceptance report showing the original submission date — is enclosed. Please waive the timely filing denial and process the claim.`,
  MEDICAL_NECESSITY: (c) =>
    `The services were medically necessary for the treatment of the patient's condition (${c.diagnoses.map((d) => d.icd10).join(", ") || "diagnoses on the claim"}). The enclosed records document the wound history, measurements and photographs, prior conservative treatment and the patient's response, and the treating provider's plan of care. The services meet your published coverage criteria. Please review the clinical documentation and reprocess the claim.`,
  NON_COVERED: () =>
    "We believe these services are a covered benefit under the patient's plan. The services were medically necessary and are described in the enclosed documentation. Please review the plan benefits and reprocess the claim, or provide the specific plan language supporting the exclusion.",
  CREDENTIALING: (c) =>
    `${c.renderingProvider?.name ?? "The rendering provider"} was enrolled and eligible to provide these services on the date of service. Confirmation of the provider's participation is enclosed. Please update your provider records and reprocess the claim.`,
  OTHER: () => "We believe this claim was denied in error. The enclosed documentation supports payment of the services as billed. Please review and reprocess the claim.",
};

const ENCLOSURES: Record<string, string[]> = {
  ELIGIBILITY: ["Eligibility verification for the date of service"],
  COB: ["Other payer's explanation of benefits / coordination of benefits statement"],
  AUTHORIZATION: ["Authorization letter", "Visit notes"],
  CODING: ["Visit notes"],
  INFORMATION: ["Requested information"],
  DUPLICATE: ["Visit notes"],
  TIMELY_FILING: ["Clearinghouse acceptance report (proof of timely filing)"],
  MEDICAL_NECESSITY: ["Visit notes and plan of care", "Wound measurements and photographs"],
  NON_COVERED: ["Visit notes"],
  CREDENTIALING: ["Provider enrollment confirmation"],
  OTHER: ["Visit notes"],
};

export function appealEnclosures(category: string) {
  return ["Copy of the claim (CMS-1500)", "Copy of the remittance advice showing the denial", ...(ENCLOSURES[category] ?? ENCLOSURES.OTHER)];
}

// The editable body of the letter; the header, claim reference block, signature and enclosures are added by the PDF.
export function buildAppealBody(claim: LetterClaim, denial: { category: string; reason: string }, level: number) {
  const dos = claim.lines.length ? formatDate(new Date(Math.min(...claim.lines.map((l) => l.dosFrom.getTime())))) : "the date of service";
  return [
    OPENING[level] ?? OPENING[1],
    `The claim was denied for the following reason: ${denial.reason}.`,
    (ARGUMENT[denial.category] ?? ARGUMENT.OTHER)(claim, dos),
    "If you need anything further to complete this review, please contact our billing office. Thank you for your prompt attention to this appeal.",
  ].join("\n\n");
}

export async function createAppeal(denialId: string, practiceId: string, userId: string) {
  const denial = await prisma.claimDenial.findFirstOrThrow({
    where: { id: denialId, practiceId },
    include: { appeals: true, claim: { include: { lines: true, diagnoses: { orderBy: { sequence: "asc" } }, renderingProvider: true } } },
  });
  const upheld = denial.appeals.filter((a) => a.status === "UPHELD").length;
  const level = Math.min(upheld + 1, 3);
  const appeal = await prisma.claimAppeal.create({
    data: { practiceId, denialId, claimId: denial.claimId, level, letterBody: buildAppealBody(denial.claim, denial, level), dueAt: denial.appealDueAt, createdById: userId },
  });
  await logClaimEvent(denial.claimId, userId, "APPEAL_DRAFTED", { note: APPEAL_LEVELS[level] });
  return appeal;
}

export async function appealLetterPdf(appealId: string, practiceId: string) {
  const appeal = await prisma.claimAppeal.findFirstOrThrow({ where: { id: appealId, practiceId }, include: { denial: true } });
  const claim = await prisma.claim.findUniqueOrThrow({
    where: { id: appeal.claimId },
    include: { patient: true, insurance: true, payer: true, lines: { orderBy: { lineNumber: "asc" } }, billingProvider: true, renderingProvider: true },
  });
  const [head, author, settings] = await Promise.all([
    practiceLetterhead(practiceId, claim.serviceLocationId),
    appeal.createdById ? prisma.user.findUnique({ where: { id: appeal.createdById } }) : null,
    prisma.practiceSettings.findUnique({ where: { practiceId } }),
  ]);
  const { pdf, font, bold } = await newPdf(`Appeal ${claimNumber(claim)}`);
  const f = new Flow(pdf, font, bold);
  letterhead(f, head);
  f.text(formatDate(appeal.filedAt ?? new Date()), { size: 10 });
  f.gap(8);
  f.text(claim.payer?.name ?? claim.payerName, { bold: true });
  f.text("Appeals Department", { size: 10 });
  const p = claim.payer;
  if (p?.addressLine1) f.text([p.addressLine1, p.addressLine2].filter(Boolean).join(", "), { size: 10 });
  if (p?.city) f.text(`${p.city}, ${p.state ?? ""} ${p.zip ?? ""}`.trim(), { size: 10 });
  if (p?.fax) f.text(`Fax ${p.fax}`, { size: 10, color: MUTED });
  f.gap(10);
  f.text(`RE: ${APPEAL_LEVELS[appeal.level] ?? "Appeal"}`, { bold: true });
  const payerClaim = /Payer claim # (\S+)/.exec(claim.statusNote ?? "")?.[1] ?? claim.originalReference;
  const dos = claim.lines.map((l) => l.dosFrom.getTime());
  const facts: [string, string | null | undefined][] = [
    ["Patient", `${patientName(claim.patient)}    DOB ${claim.patient.dob.toISOString().slice(0, 10)}`],
    ["Member ID", claim.insurance?.memberId],
    ["Group number", claim.insurance?.groupNumber],
    ["Our claim number", claimNumber(claim)],
    ["Your claim number", payerClaim],
    ["Date(s) of service", dos.length ? [...new Set([Math.min(...dos), Math.max(...dos)])].map((t) => formatDate(new Date(t))).join(" – ") : null],
    ["Services", claim.lines.map((l) => `${l.cptCode}${l.modifiers ? `-${l.modifiers.replace(/,/g, "-")}` : ""}`).join(", ")],
    ["Billed amount", formatMoney(claim.billedCents)],
    ["Rendering provider", claim.renderingProvider ? `${claim.renderingProvider.name}${claim.renderingProvider.npi ? ` · NPI ${claim.renderingProvider.npi}` : ""}` : null],
    ["Billing provider", claim.billingProvider ? `${claim.billingProvider.name}${claim.billingProvider.npi ? ` · NPI ${claim.billingProvider.npi}` : ""}${claim.billingProvider.taxId ? ` · Tax ID ${claim.billingProvider.taxId}` : ""}` : null],
    ["Denial", `${appeal.denial.code ? `${appeal.denial.groupCode ?? ""}${appeal.denial.groupCode ? "-" : ""}${appeal.denial.code} · ` : ""}${formatDate(appeal.denial.deniedAt)}`],
  ];
  for (const [k, v] of facts) if (v) f.text(`${k}: ${v}`, { size: 10, gap: 3 });
  f.gap(10);
  f.text("To whom it may concern:", { size: 10.5 });
  f.gap(4);
  for (const para of appeal.letterBody.split(/\n\s*\n/)) {
    f.text(para.trim(), { size: 10.5 });
    f.gap(6);
  }
  f.gap(6);
  f.text("Sincerely,", { size: 10.5 });
  f.gap(22);
  f.text(author?.name ?? head.name, { bold: true });
  f.text(`Billing office, ${head.name}`, { size: 10 });
  const phone = settings?.billingPhone ?? head.phone;
  if (phone || head.fax) f.text([phone ? `Phone ${phone}` : "", head.fax ? `Fax ${head.fax}` : ""].filter(Boolean).join(" · "), { size: 10, color: MUTED });
  f.gap(12);
  f.text("Enclosures:", { size: 9.5, bold: true });
  for (const e of appealEnclosures(appeal.denial.category)) f.text(`- ${e}`, { size: 9.5, gap: 2 });
  return Buffer.from(await pdf.save());
}

// ---- Background checks (run with the other automations) ----

// Raises a task before an appeal deadline passes, and when a filed appeal has had no decision for 45 days.
export async function flagAppealDeadlines(practiceId?: string) {
  const scope = practiceId ? { practiceId } : {};
  let n = 0;
  // Each practice sets its own alert window; fetch the widest window, then keep what falls inside each one.
  const windows = new Map((await prisma.practiceSettings.findMany({ where: practiceId ? { practiceId } : {}, select: { practiceId: true, appealAlertDays: true } })).map((s) => [s.practiceId, s.appealAlertDays]));
  const widest = Math.max(APPEAL_ALERT_DAYS, ...windows.values());
  const due = (
    await prisma.claimDenial.findMany({
      where: { ...scope, status: "OPEN", appealDueAt: { lte: new Date(Date.now() + widest * DAY) } },
      include: { claim: { include: { patient: true } } },
    })
  ).filter((d) => (daysUntil(d.appealDueAt) ?? 0) <= (windows.get(d.practiceId) ?? APPEAL_ALERT_DAYS));
  for (const d of due) {
    const days = daysUntil(d.appealDueAt) ?? 0;
    await createTask({
      practiceId: d.practiceId,
      type: "DENIAL",
      title: `Appeal deadline ${days < 0 ? "passed" : `in ${days} day${days === 1 ? "" : "s"}`} — ${claimNumber(d.claim)} · ${patientName(d.claim.patient)} · ${d.claim.payerName}`,
      body: `${DENIAL_CATEGORIES[d.category]?.label ?? "Denial"}: ${d.reason}\nDenied ${formatDate(d.deniedAt)} · ${formatMoney(d.amountCents)} · appeal by ${formatDate(d.appealDueAt!)}.`,
      patientId: d.claim.patientId,
      assignedToId: d.ownerId,
      assignedRole: "BILLER",
      priority: "URGENT",
      dueAt: d.appealDueAt,
      link: `/billing/claims/${d.claimId}#denial`,
      sourceType: "APPEAL_DEADLINE",
      sourceId: d.id,
    });
    n++;
  }
  const waiting = await prisma.claimAppeal.findMany({
    where: { ...scope, status: "FILED", filedAt: { lte: new Date(Date.now() - APPEAL_DECISION_DAYS * DAY) } },
    include: { denial: { include: { claim: { include: { patient: true } } } } },
  });
  for (const a of waiting) {
    const c = a.denial.claim;
    await createTask({
      practiceId: a.practiceId,
      type: "DENIAL",
      title: `No appeal decision yet — ${claimNumber(c)} · ${patientName(c.patient)} · ${c.payerName}`,
      body: `${APPEAL_LEVELS[a.level]} filed ${formatDate(a.filedAt!)}${a.payerReference ? ` (ref ${a.payerReference})` : ""}. Call the payer for the status.`,
      patientId: c.patientId,
      assignedToId: a.denial.ownerId,
      assignedRole: "BILLER",
      priority: "HIGH",
      link: `/billing/claims/${c.id}#denial`,
      sourceType: "APPEAL_FOLLOWUP",
      sourceId: a.denialId,
    });
    n++;
  }
  return n;
}
