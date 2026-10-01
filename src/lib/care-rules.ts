import "server-only";
import { prisma } from "@/lib/prisma";

// Clinical decision support: care-gap rules (who a rule applies to, what satisfies it, how often).

export type CareCriteria = {
  ageMin?: number;
  ageMax?: number;
  sex?: "F" | "M";
  // ICD-10 prefixes on the problem list or recent visit diagnoses (e.g. "E11", "L97").
  icd10?: string[];
  // Only while the patient has an active wound (optionally of these etiologies).
  activeWound?: boolean;
  etiologies?: string[];
};

export const SATISFIER_KINDS: Record<string, string> = {
  LAB: "A lab result whose name contains…",
  DOCUMENT: "A completed chart form",
  VITALS_BP: "Blood pressure recorded",
  VITALS_WEIGHT: "Weight recorded",
  SMOKING_STATUS: "Smoking status recorded",
  IMMUNIZATION: "An immunization whose name contains…",
};

export type StandardRule = { key: string; name: string; description: string; criteria: CareCriteria; satisfiedBy: string; intervalDays: number; message: string; source: string; severity?: string };

export const STANDARD_CARE_RULES: StandardRule[] = [
  {
    key: "dm_a1c",
    name: "Diabetes: hemoglobin A1C",
    description: "Glycemic control affects wound healing; A1C every 3 months while a diabetic wound is open.",
    criteria: { icd10: ["E08", "E09", "E10", "E11", "E13"] },
    satisfiedBy: "LAB:A1C",
    intervalDays: 90,
    message: "A1C due — order or record the latest result.",
    source: "ADA Standards of Care",
  },
  {
    key: "dm_foot_exam",
    name: "Diabetes: comprehensive foot exam",
    description: "Annual diabetic foot exam with monofilament and pulses.",
    criteria: { icd10: ["E08", "E09", "E10", "E11", "E13"] },
    satisfiedBy: "DOCUMENT:diabetic_foot_exam",
    intervalDays: 365,
    message: "Diabetic foot exam due this year.",
    source: "ADA / CMS quality measure 126",
  },
  {
    key: "braden",
    name: "Pressure injury risk (Braden)",
    description: "Braden scale for patients with pressure injuries, reassessed monthly.",
    criteria: { activeWound: true, etiologies: ["PRESSURE"] },
    satisfiedBy: "DOCUMENT:braden",
    intervalDays: 30,
    message: "Braden risk assessment due.",
    source: "NPIAP guideline",
  },
  {
    key: "nutrition",
    name: "Nutrition screening (MNA-SF)",
    description: "Nutrition risk screen for patients with chronic wounds, every 90 days.",
    criteria: { activeWound: true },
    satisfiedBy: "DOCUMENT:nutrition_risk",
    intervalDays: 90,
    message: "Nutrition screening due.",
    source: "WOCN / NPIAP",
  },
  {
    key: "vascular_abi",
    name: "Lower-extremity vascular study (ABI)",
    description: "ABI or vascular assessment for leg and foot ulcers before compression, then yearly.",
    criteria: { activeWound: true, etiologies: ["VENOUS", "ARTERIAL", "DIABETIC_NEUROPATHIC"] },
    satisfiedBy: "DOCUMENT:lower_extremity",
    intervalDays: 365,
    message: "Lower-extremity / ABI assessment due before compression therapy.",
    source: "SVS / AVF venous ulcer guideline",
  },
  {
    key: "pain",
    name: "Pain assessment",
    description: "Pain reassessed at least monthly while a wound is open.",
    criteria: { activeWound: true },
    satisfiedBy: "DOCUMENT:pain_assessment",
    intervalDays: 30,
    message: "Pain assessment due.",
    source: "Wound care best practice",
    severity: "INFO",
  },
  {
    key: "fall_risk",
    name: "Fall risk (65+)",
    description: "Annual fall-risk screening for patients 65 and older.",
    criteria: { ageMin: 65 },
    satisfiedBy: "DOCUMENT:fall_risk",
    intervalDays: 365,
    message: "Annual fall-risk screening due.",
    source: "CMS quality measure 155",
    severity: "INFO",
  },
  {
    key: "tobacco",
    name: "Tobacco use assessment",
    description: "Smoking status on file — smoking impairs healing.",
    criteria: { ageMin: 18 },
    satisfiedBy: "SMOKING_STATUS",
    intervalDays: 365,
    message: "Record tobacco use (and offer cessation help).",
    source: "CMS quality measure 226",
  },
  {
    key: "bp",
    name: "Blood pressure measurement",
    description: "Blood pressure at least yearly for adults.",
    criteria: { ageMin: 18 },
    satisfiedBy: "VITALS_BP",
    intervalDays: 365,
    message: "Blood pressure not recorded in the last year.",
    source: "USPSTF",
    severity: "INFO",
  },
  {
    key: "weight",
    name: "Weight / BMI",
    description: "Weight recorded at least every 90 days for chronic wound patients.",
    criteria: { activeWound: true },
    satisfiedBy: "VITALS_WEIGHT",
    intervalDays: 90,
    message: "Weight not recorded recently.",
    source: "CMS quality measure 69",
    severity: "INFO",
  },
  {
    key: "tetanus",
    name: "Tetanus immunization",
    description: "Td/Tdap within 10 years for patients with open wounds.",
    criteria: { activeWound: true },
    satisfiedBy: "IMMUNIZATION:TETANUS|TDAP|TD ",
    intervalDays: 3650,
    message: "No tetanus (Td/Tdap) in the last 10 years.",
    source: "CDC / ACIP",
  },
  {
    key: "influenza",
    name: "Influenza vaccine (65+)",
    description: "Seasonal flu vaccine yearly.",
    criteria: { ageMin: 65 },
    satisfiedBy: "IMMUNIZATION:INFLUENZA|FLU",
    intervalDays: 365,
    message: "Seasonal flu vaccine not recorded.",
    source: "CDC / ACIP",
    severity: "INFO",
  },
];

const setups = new Map<string, Promise<void>>();
export function ensureCareRules(practiceId: string) {
  let run = setups.get(practiceId);
  if (!run) {
    run = (async () => {
      const have = new Set((await prisma.careRule.findMany({ where: { practiceId }, select: { key: true } })).map((r) => r.key));
      const missing = STANDARD_CARE_RULES.filter((r) => !have.has(r.key));
      if (missing.length)
        await prisma.careRule.createMany({
          data: missing.map((r) => ({ practiceId, key: r.key, name: r.name, description: r.description, criteria: JSON.stringify(r.criteria), satisfiedBy: r.satisfiedBy, intervalDays: r.intervalDays, message: r.message, source: r.source, severity: r.severity ?? "ALERT", standard: true })),
        });
    })().catch((err) => {
      setups.delete(practiceId);
      throw err;
    });
    setups.set(practiceId, run);
  }
  return run;
}

export function parseCriteria(json: string): CareCriteria {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export type CareGap = {
  ruleId: string;
  key: string;
  name: string;
  message: string;
  severity: string;
  status: "DUE" | "MET" | "OVERRIDDEN";
  lastDone: Date | null;
  dueDate: Date | null;
  override?: { status: string; note: string | null; until: Date | null };
};

type PatientFacts = Awaited<ReturnType<typeof loadFacts>>;

async function loadFacts(patientIds: string[]) {
  const yearAgo = new Date(Date.now() - 400 * 86_400_000);
  const patients = await prisma.patient.findMany({
    where: { id: { in: patientIds } },
    include: {
      problems: { where: { status: "ACTIVE" }, select: { icd10: true } },
      wounds: { where: { status: "ACTIVE" }, select: { etiology: true } },
      immunizations: { where: { source: { not: "REFUSED" } }, select: { vaccine: true, administeredAt: true } },
      labOrders: { include: { result: true } },
      clinicalOrders: { where: { status: { not: "CANCELLED" } }, select: { kind: true, results: { select: { name: true, code: true, resultedAt: true } }, items: { select: { name: true } } } },
      careOverrides: { orderBy: { createdAt: "desc" } },
      encounters: {
        select: {
          date: true,
          diagnoses: { where: { createdAt: { gte: yearAgo } }, select: { icd10: true } },
          vitals: { select: { bpSystolic: true, weightKg: true, recordedAt: true } },
          documents: { where: { status: "COMPLETE" }, select: { completedAt: true, updatedAt: true, template: { select: { key: true } } } },
        },
      },
    },
  });
  return patients;
}

const ageOf = (dob: Date) => {
  const n = new Date();
  let a = n.getFullYear() - dob.getFullYear();
  if (n.getMonth() < dob.getMonth() || (n.getMonth() === dob.getMonth() && n.getDate() < dob.getDate())) a--;
  return a;
};

function applies(c: CareCriteria, p: PatientFacts[number]) {
  const age = ageOf(p.dob);
  if (c.ageMin !== undefined && age < c.ageMin) return false;
  if (c.ageMax !== undefined && age > c.ageMax) return false;
  if (c.sex && p.sex !== c.sex) return false;
  if (c.icd10?.length) {
    const codes = [...p.problems.map((x) => x.icd10), ...p.encounters.flatMap((e) => e.diagnoses.map((d) => d.icd10))].map((x) => x.toUpperCase().replace(".", ""));
    if (!codes.some((code) => c.icd10!.some((pre) => code.startsWith(pre.toUpperCase().replace(".", ""))))) return false;
  }
  if (c.activeWound || c.etiologies?.length) {
    if (p.wounds.length === 0) return false;
    if (c.etiologies?.length && !p.wounds.some((w) => c.etiologies!.includes(w.etiology))) return false;
  }
  return true;
}

function lastSatisfied(satisfiedBy: string, p: PatientFacts[number]): Date | null {
  const cut = satisfiedBy.indexOf(":");
  const kind = cut < 0 ? satisfiedBy : satisfiedBy.slice(0, cut);
  const arg = cut < 0 ? "" : satisfiedBy.slice(cut + 1);
  const latest = (ds: (Date | null | undefined)[]) => ds.filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const any = (text: string) => arg.split("|").some((t) => t.trim() && text.toUpperCase().includes(t.toUpperCase()));
  switch (kind) {
    case "LAB":
      return latest([
        ...p.labOrders.filter((o) => o.result && any(o.testName)).map((o) => o.result!.resultedAt),
        ...p.clinicalOrders.flatMap((o) => o.results.filter((r) => any(r.name) || any(r.code ?? "")).map((r) => r.resultedAt)),
      ]);
    case "DOCUMENT":
      return latest(p.encounters.flatMap((e) => e.documents.filter((d) => d.template.key === arg).map((d) => d.completedAt ?? d.updatedAt)));
    case "VITALS_BP":
      return latest(p.encounters.filter((e) => e.vitals?.bpSystolic).map((e) => e.vitals!.recordedAt));
    case "VITALS_WEIGHT":
      return latest(p.encounters.filter((e) => e.vitals?.weightKg).map((e) => e.vitals!.recordedAt));
    case "SMOKING_STATUS":
      return p.smokingStatus ? p.updatedAt : null;
    case "IMMUNIZATION":
      return latest(p.immunizations.filter((i) => any(i.vaccine)).map((i) => i.administeredAt));
  }
  return null;
}

export async function careGapsFor(practiceId: string, patientIds: string[]) {
  await ensureCareRules(practiceId);
  const [rules, facts] = await Promise.all([prisma.careRule.findMany({ where: { practiceId, active: true }, orderBy: { name: "asc" } }), loadFacts(patientIds)]);
  const now = Date.now();
  const out = new Map<string, CareGap[]>();
  for (const p of facts) {
    const gaps: CareGap[] = [];
    for (const r of rules) {
      if (!applies(parseCriteria(r.criteria), p)) continue;
      const last = lastSatisfied(r.satisfiedBy, p);
      const due = last ? new Date(last.getTime() + r.intervalDays * 86_400_000) : null;
      const ov = p.careOverrides.find((o) => o.ruleId === r.id && (!o.until || o.until.getTime() > now));
      const met = Boolean(due && due.getTime() > now);
      gaps.push({
        ruleId: r.id,
        key: r.key,
        name: r.name,
        message: r.message,
        severity: r.severity,
        status: met ? "MET" : ov ? "OVERRIDDEN" : "DUE",
        lastDone: last,
        dueDate: due,
        override: ov ? { status: ov.status, note: ov.note, until: ov.until } : undefined,
      });
    }
    out.set(p.id, gaps);
  }
  return out;
}
