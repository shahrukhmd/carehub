import "server-only";
import type { EligibilityCheck, Insurance, IntakeCase, Patient, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney, planSegmentLabel } from "@/lib/format";
import type { EligibilityBenefits } from "@/lib/clearinghouse/types";

// Reads a clearinghouse eligibility response back into the chart: what the payer returned is compared with
// what was entered, empty fields are filled, and fields that differ are offered for a one-click correction.

type Kind = "text" | "date" | "money" | "percent" | "yesno" | "segment";

export type BenefitField = {
  key: string;
  label: string;
  // Display values; "" when nothing is on file.
  current: string;
  payer: string;
  // FILL: nothing entered yet. MISMATCH: entered value differs from the payer's. MATCH: same.
  state: "FILL" | "MISMATCH" | "MATCH";
};

type Ctx = { patient: Patient; insurance: Insurance; intakeCase: IntakeCase | null };
type Writes = {
  insurance?: Prisma.InsuranceUncheckedUpdateInput;
  intakeCase?: Prisma.IntakeCaseUncheckedUpdateInput;
  patient?: Prisma.PatientUncheckedUpdateInput;
};
type Spec = {
  key: string;
  label: string;
  kind: Kind;
  // Normalised values: ISO date, cents, whole percent, YES / NO, or plain text.
  payer: (b: EligibilityBenefits, check: EligibilityCheck) => string | null;
  current: (ctx: Ctx) => string | null;
  write: (v: string, ctx: Ctx) => Writes;
  // Only tracked on the gateway case.
  caseOnly?: boolean;
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const num = (n: number | null | undefined) => (n === null || n === undefined ? null : String(n));
const txt = (s: string | null | undefined) => s?.trim() || null;
const yn = (b: boolean | undefined) => (b === undefined ? null : b ? "YES" : "NO");
const known = (v: string | null | undefined) => (v === "YES" || v === "NO" ? v : null);
const noon = (v: string) => new Date(`${v}T12:00:00`);
const self = (ctx: Ctx) => ctx.insurance.relationshipToInsured === "18";

const SPECS: Spec[] = [
  {
    key: "planName",
    label: "Plan name",
    kind: "text",
    payer: (b, c) => txt(b.plan?.name) ?? txt(c.planName),
    current: ({ insurance }) => txt(insurance.planName),
    write: (v) => ({ insurance: { planName: v } }),
  },
  {
    key: "planSegment",
    label: "Plan segment",
    kind: "segment",
    caseOnly: true,
    payer: (b) => (b.plan?.segment && b.plan.segment in planSegmentLabel ? b.plan.segment : null),
    current: ({ intakeCase }) => txt(intakeCase?.planSegment),
    write: (v) => ({ intakeCase: { planSegment: v } }),
  },
  {
    key: "groupNumber",
    label: "Group number",
    kind: "text",
    payer: (b) => txt(b.plan?.groupNumber),
    current: ({ insurance }) => txt(insurance.groupNumber),
    write: (v) => ({ insurance: { groupNumber: v } }),
  },
  {
    key: "groupName",
    label: "Group name",
    kind: "text",
    payer: (b) => txt(b.plan?.groupName),
    current: ({ insurance }) => txt(insurance.groupName),
    write: (v) => ({ insurance: { groupName: v } }),
  },
  {
    key: "effectiveDate",
    label: "Coverage effective date",
    kind: "date",
    payer: (b) => txt(b.plan?.effectiveDate),
    current: ({ insurance }) => iso(insurance.effectiveDate),
    write: (v) => ({ insurance: { effectiveDate: noon(v) }, intakeCase: { coverageEffectiveDate: noon(v) } }),
  },
  {
    key: "terminationDate",
    label: "Coverage termination date",
    kind: "date",
    payer: (b) => txt(b.plan?.terminationDate),
    current: ({ insurance }) => iso(insurance.terminationDate),
    write: (v) => ({ insurance: { terminationDate: noon(v) }, intakeCase: { coverageTermDate: noon(v) } }),
  },
  {
    key: "copay",
    label: "Office visit copay",
    kind: "money",
    payer: (_b, c) => num(c.copayCents),
    current: ({ insurance }) => num(insurance.copayCents),
    write: (v) => ({ insurance: { copayCents: Number(v) }, intakeCase: { copayCents: Number(v) } }),
  },
  {
    key: "deductible",
    label: "Deductible",
    kind: "money",
    payer: (b) => num(b.deductible?.totalCents),
    current: ({ insurance }) => num(insurance.deductibleCents),
    write: (v) => ({ insurance: { deductibleCents: Number(v) }, intakeCase: { deductibleCents: Number(v) } }),
  },
  {
    key: "deductibleMet",
    label: "Deductible met",
    kind: "money",
    payer: (b) => num(b.deductible?.metCents),
    current: ({ insurance }) => num(insurance.deductibleMetCents),
    write: (v) => ({ insurance: { deductibleMetCents: Number(v) }, intakeCase: { deductibleMetCents: Number(v) } }),
  },
  {
    key: "coinsurance",
    label: "Coinsurance (patient pays)",
    kind: "percent",
    payer: (_b, c) => num(c.coinsurancePercent),
    current: ({ insurance }) => (insurance.coveragePercent === null ? null : String(100 - insurance.coveragePercent)),
    write: (v) => ({ insurance: { coveragePercent: 100 - Number(v) }, intakeCase: { coinsurancePercent: Number(v) } }),
  },
  {
    key: "outOfPocketRemaining",
    label: "Out-of-pocket remaining",
    kind: "money",
    caseOnly: true,
    payer: (b, c) => num(b.outOfPocket?.remainingCents ?? c.outOfPocketRemainingCents),
    current: ({ intakeCase }) => num(intakeCase?.outOfPocketRemainingCents),
    write: (v) => ({ intakeCase: { outOfPocketRemainingCents: Number(v) } }),
  },
  {
    key: "authRequired",
    label: "Prior authorization required (debridement)",
    kind: "yesno",
    payer: (b) => yn(b.services?.find((s) => s.code === "2")?.authRequired),
    current: ({ insurance, intakeCase }) => (intakeCase ? known(intakeCase.authRequired) : known(insurance.priorAuthRequired)),
    write: (v, { intakeCase }) => ({
      insurance: { priorAuthRequired: v },
      // Keep the tracking status consistent with the requirement.
      intakeCase: { authRequired: v, authStatus: v === "YES" ? (intakeCase?.authStatus === "NOT_REQUIRED" ? "TO_SUBMIT" : intakeCase?.authStatus) : "NOT_REQUIRED" },
    }),
  },
  {
    key: "referralRequired",
    label: "PCP referral required",
    kind: "yesno",
    caseOnly: true,
    payer: (b) => yn(b.referralRequired),
    current: ({ intakeCase }) => known(intakeCase?.referralRequired),
    write: (v, { intakeCase }) => ({
      intakeCase: { referralRequired: v, referralStatus: v === "YES" ? (intakeCase?.referralStatus === "NOT_REQUIRED" ? "TO_SEND" : intakeCase?.referralStatus) : "NOT_REQUIRED" },
    }),
  },
  {
    key: "pcpName",
    label: "Primary care physician (PCP)",
    kind: "text",
    caseOnly: true,
    payer: (b) => txt(b.pcp?.name),
    current: ({ intakeCase }) => txt(intakeCase?.pcpName),
    write: (v) => ({ intakeCase: { pcpName: v } }),
  },
  {
    key: "pcpPhone",
    label: "PCP phone",
    kind: "text",
    caseOnly: true,
    payer: (b) => txt(b.pcp?.phone),
    current: ({ intakeCase }) => txt(intakeCase?.pcpPhone),
    write: (v) => ({ intakeCase: { pcpPhone: v } }),
  },
  {
    key: "subscriberFirstName",
    label: "Subscriber first name",
    kind: "text",
    payer: (b) => txt(b.subscriber?.firstName),
    current: (ctx) => txt(self(ctx) ? ctx.patient.firstName : ctx.insurance.insuredFirstName),
    write: (v, ctx) => (self(ctx) ? { patient: { firstName: titleCase(v) } } : { insurance: { insuredFirstName: titleCase(v) } }),
  },
  {
    key: "subscriberLastName",
    label: "Subscriber last name",
    kind: "text",
    payer: (b) => txt(b.subscriber?.lastName),
    current: (ctx) => txt(self(ctx) ? ctx.patient.lastName : ctx.insurance.insuredLastName),
    write: (v, ctx) => (self(ctx) ? { patient: { lastName: titleCase(v) } } : { insurance: { insuredLastName: titleCase(v) } }),
  },
  {
    key: "subscriberDob",
    label: "Subscriber date of birth",
    kind: "date",
    payer: (b) => txt(b.subscriber?.dob),
    current: (ctx) => iso(self(ctx) ? ctx.patient.dob : ctx.insurance.insuredDob),
    // Patient dates of birth are stored as UTC midnight.
    write: (v, ctx) => (self(ctx) ? { patient: { dob: new Date(`${v}T00:00:00Z`) } } : { insurance: { insuredDob: noon(v) } }),
  },
  {
    key: "addressLine1",
    label: "Subscriber street address",
    kind: "text",
    payer: (b) => txt(b.subscriber?.addressLine1),
    current: (ctx) => txt(self(ctx) ? ctx.patient.addressLine1 : ctx.insurance.insuredAddressLine1),
    write: (v, ctx) => (self(ctx) ? { patient: { addressLine1: v } } : { insurance: { insuredAddressLine1: v } }),
  },
  {
    key: "city",
    label: "Subscriber city",
    kind: "text",
    payer: (b) => txt(b.subscriber?.city),
    current: (ctx) => txt(self(ctx) ? ctx.patient.city : ctx.insurance.insuredCity),
    write: (v, ctx) => (self(ctx) ? { patient: { city: v } } : { insurance: { insuredCity: v } }),
  },
  {
    key: "state",
    label: "Subscriber state",
    kind: "text",
    payer: (b) => txt(b.subscriber?.state),
    current: (ctx) => txt(self(ctx) ? ctx.patient.state : ctx.insurance.insuredState),
    write: (v, ctx) => (self(ctx) ? { patient: { state: v } } : { insurance: { insuredState: v } }),
  },
  {
    key: "zip",
    label: "Subscriber ZIP",
    kind: "text",
    payer: (b) => txt(b.subscriber?.zip),
    current: (ctx) => txt(self(ctx) ? ctx.patient.zip : ctx.insurance.insuredZip),
    write: (v, ctx) => (self(ctx) ? { patient: { zip: v } } : { insurance: { insuredZip: v } }),
  },
];

// Payers return names in capitals.
function titleCase(v: string) {
  return v === v.toUpperCase() ? v.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase()) : v;
}

function same(kind: Kind, a: string, b: string) {
  if (kind !== "text") return a === b;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(a) === norm(b);
}

function show(kind: Kind, v: string | null) {
  if (!v) return "";
  if (kind === "money") return formatMoney(Number(v));
  if (kind === "percent") return `${v}%`;
  if (kind === "date") return formatDate(noon(v));
  if (kind === "yesno") return v === "YES" ? "Yes" : "No";
  if (kind === "segment") return planSegmentLabel[v] ?? v;
  return v;
}

export function parseBenefits(json: string | null | undefined): EligibilityBenefits {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" ? (v as EligibilityBenefits) : {};
  } catch {
    return {};
  }
}

function specsFor(ctx: Ctx) {
  return SPECS.filter((s) => !s.caseOnly || ctx.intakeCase);
}

// Every field the payer returned, against what is on file.
export function compareBenefits(ctx: Ctx, check: EligibilityCheck): BenefitField[] {
  const b = parseBenefits(check.benefits);
  const out: BenefitField[] = [];
  for (const s of specsFor(ctx)) {
    const payer = s.payer(b, check);
    if (!payer) continue;
    const current = s.current(ctx);
    out.push({
      key: s.key,
      label: s.label,
      current: show(s.kind, current),
      payer: show(s.kind, s.kind === "text" && /Name$/.test(s.key) && s.key.startsWith("subscriber") ? titleCase(payer) : payer),
      state: !current ? "FILL" : same(s.kind, current, payer) ? "MATCH" : "MISMATCH",
    });
  }
  return out;
}

export async function loadBenefitContext(checkId: string, practiceId: string) {
  const check = await prisma.eligibilityCheck.findFirst({ where: { id: checkId, practiceId } });
  if (!check?.insuranceId) return null;
  const [insurance, patient, intakeCase] = await Promise.all([
    prisma.insurance.findFirst({ where: { id: check.insuranceId, patientId: check.patientId } }),
    prisma.patient.findUnique({ where: { id: check.patientId } }),
    check.intakeCaseId ? prisma.intakeCase.findFirst({ where: { id: check.intakeCaseId, practiceId } }) : null,
  ]);
  if (!insurance || !patient) return null;
  return { check, ctx: { patient, insurance, intakeCase } satisfies Ctx };
}

// Writes the payer's values into the chart. "AUTO" fills what is empty (and mirrors agreed values onto the case);
// a key list overwrites exactly those fields, which is how a mismatch is corrected.
export async function applyBenefits(checkId: string, practiceId: string, keys: string[] | "AUTO") {
  const loaded = await loadBenefitContext(checkId, practiceId);
  if (!loaded || loaded.check.status !== "ACTIVE") return [];
  const { check, ctx } = loaded;
  const b = parseBenefits(check.benefits);
  const fields = compareBenefits(ctx, check);
  const chosen = fields.filter((f) => (keys === "AUTO" ? f.state !== "MISMATCH" : keys.includes(f.key) && f.state !== "MATCH"));

  const writes: Required<Writes> = { insurance: {}, intakeCase: {}, patient: {} };
  for (const f of chosen) {
    const spec = SPECS.find((s) => s.key === f.key)!;
    const w = spec.write(spec.payer(b, check)!, ctx);
    Object.assign(writes.intakeCase, w.intakeCase);
    // A value that already agrees is left as it was typed; only its copy on the case is brought in line.
    if (f.state === "MATCH") continue;
    Object.assign(writes.insurance, w.insurance);
    Object.assign(writes.patient, w.patient);
  }
  await prisma.$transaction([
    prisma.insurance.update({ where: { id: ctx.insurance.id }, data: { ...writes.insurance, verifiedAt: check.checkedAt, verifiedWith: "Clearinghouse eligibility (271)" } }),
    ...(ctx.intakeCase && Object.keys(writes.intakeCase).length ? [prisma.intakeCase.update({ where: { id: ctx.intakeCase.id }, data: writes.intakeCase })] : []),
    ...(Object.keys(writes.patient).length ? [prisma.patient.update({ where: { id: ctx.patient.id }, data: writes.patient })] : []),
  ]);
  // Only what actually changed on the chart is reported back.
  return chosen.filter((f) => f.state !== "MATCH");
}
