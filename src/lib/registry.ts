import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sdohDomainLabel } from "@/lib/care-plan";
import { parseCustomValues, showCustomValue } from "@/lib/custom-fields";
import type { Table } from "@/lib/financial-reports";
import { etiologyLabel } from "@/lib/wound";

// Patient registry: a list of patients built from clinical and demographic criteria (for example every active
// patient with diabetes and an open wound who has not been seen in 60 days).

export type RegistryCriteria = {
  status?: string;
  ageMin?: string;
  ageMax?: string;
  sex?: string;
  dx?: string;
  med?: string;
  wound?: string;
  payer?: string;
  provider?: string;
  seenFrom?: string;
  seenTo?: string;
  notSeenDays?: string;
  need?: string;
  consent?: string;
  cf?: string;
  cfv?: string;
};

export const REGISTRY_KEYS: (keyof RegistryCriteria)[] = ["status", "ageMin", "ageMax", "sex", "dx", "med", "wound", "payer", "provider", "seenFrom", "seenTo", "notSeenDays", "need", "consent", "cf", "cfv"];
export const REGISTRY_LIMIT = 2000;
const DAY = 86_400_000;

const num = (v: string | undefined) => (v && /^\d{1,3}$/.test(v) ? Number(v) : null);
const day = (v: string | undefined, end = false) => {
  const d = v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T${end ? "23:59:59" : "00:00:00"}`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};
// Several codes or names separated by commas: any of them matches.
const terms = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 10);

export function hasCriteria(c: RegistryCriteria) {
  return REGISTRY_KEYS.some((k) => Boolean(c[k]) && !(k === "status" && c.status === "ACTIVE") && !(k === "cf" && !c.cfv));
}

export async function runRegistry(practiceId: string, c: RegistryCriteria, opts: { includeRestricted?: boolean } = {}) {
  const now = new Date();
  const dobBefore = (years: number) => new Date(now.getFullYear() - years, now.getMonth(), now.getDate());
  const ageMin = num(c.ageMin);
  const ageMax = num(c.ageMax);
  const dx = terms(c.dx).map((t) => t.toUpperCase());
  const meds = terms(c.med);
  const and: Prisma.PatientWhereInput[] = [];

  if (dx.length) {
    and.push({
      OR: dx.flatMap((code) => [
        { problems: { some: { status: "ACTIVE", icd10: { startsWith: code, mode: "insensitive" } } } },
        { encounters: { some: { diagnoses: { some: { icd10: { startsWith: code, mode: "insensitive" } } } } } },
      ]),
    });
  }
  if (meds.length) and.push({ OR: meds.map((name) => ({ medications: { some: { status: "ACTIVE", name: { contains: name, mode: "insensitive" } } } })) });
  if (c.wound === "ANY") and.push({ wounds: { some: { status: "ACTIVE" } } });
  else if (c.wound === "NONE") and.push({ wounds: { none: { status: "ACTIVE" } } });
  else if (c.wound && c.wound in etiologyLabel) and.push({ wounds: { some: { status: "ACTIVE", etiology: c.wound } } });
  if (c.payer) and.push({ insurances: { some: { active: true, payerId: c.payer } } });
  if (c.provider) and.push({ OR: [{ woundCarePhysicianId: c.provider }, { primaryCarePhysicianId: c.provider }, { referringPhysicianId: c.provider }] });
  if (c.need && c.need in sdohDomainLabel) and.push({ sdohScreenings: { some: { needs: { contains: c.need, mode: "insensitive" } } } });
  if (c.consent === "YES" || c.consent === "NO") and.push({ textConsent: c.consent });
  if (c.consent === "NONE") and.push({ textConsent: null });

  const where: Prisma.PatientWhereInput = {
    practiceId,
    ...(opts.includeRestricted ? {} : { restricted: false }),
    ...(c.status === "ALL" ? {} : { status: c.status && c.status !== "ACTIVE" ? c.status : "ACTIVE" }),
    ...(c.sex ? { sex: c.sex } : {}),
    ...(ageMin !== null || ageMax !== null
      ? { dob: { ...(ageMin !== null ? { lte: dobBefore(ageMin) } : {}), ...(ageMax !== null ? { gt: dobBefore(ageMax + 1) } : {}) } }
      : {}),
    ...(and.length ? { AND: and } : {}),
  };

  const [found, field] = await Promise.all([
    prisma.patient.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        mrn: true,
        dob: true,
        sex: true,
        phone: true,
        email: true,
        status: true,
        textConsent: true,
        customFields: true,
        problems: { where: { status: "ACTIVE" }, select: { icd10: true, description: true } },
        medications: { where: { status: "ACTIVE" }, select: { name: true } },
        wounds: { where: { status: "ACTIVE" }, select: { label: true, location: true, etiology: true } },
        insurances: { where: { active: true, rank: "PRIMARY" }, select: { payer: { select: { name: true } } }, take: 1 },
        encounters: { where: { type: { not: "BILLING_ONLY" } }, select: { date: true }, orderBy: { date: "desc" }, take: 1 },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: REGISTRY_LIMIT + 1,
    }),
    c.cf && c.cfv ? prisma.customField.findFirst({ where: { practiceId, key: c.cf } }) : null,
  ]);

  // Criteria that depend on the latest visit or on a stored custom answer are applied to the rows.
  const seenFrom = day(c.seenFrom);
  const seenTo = day(c.seenTo, true);
  const notSeen = num(c.notSeenDays);
  const wanted = c.cfv?.trim().toLowerCase();
  const rows = found
    .map((p) => ({ ...p, lastVisit: p.encounters[0]?.date ?? null, custom: field ? showCustomValue(field, parseCustomValues(p.customFields)[field.key]) : "" }))
    .filter((p) => {
      if (seenFrom && !(p.lastVisit && p.lastVisit >= seenFrom)) return false;
      if (seenTo && !(p.lastVisit && p.lastVisit <= seenTo)) return false;
      if (notSeen !== null && p.lastVisit && now.getTime() - p.lastVisit.getTime() < notSeen * DAY) return false;
      if (field && wanted && !p.custom.toLowerCase().includes(wanted)) return false;
      return true;
    });
  return { rows: rows.slice(0, REGISTRY_LIMIT), truncated: found.length > REGISTRY_LIMIT, customLabel: field?.label ?? null };
}

export type RegistryRow = Awaited<ReturnType<typeof runRegistry>>["rows"][number];

export function ageOf(dob: Date) {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  if (now.getMonth() < dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate())) age--;
  return age;
}

export function registryTable(result: Awaited<ReturnType<typeof runRegistry>>): Table {
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  return {
    columns: ["Last name", "First name", "MRN", "Date of birth", "Age", "Sex", "Phone", "Email", "Text consent", "Primary insurance", "Last visit", "Active problems", "Active medications", "Active wounds", ...(result.customLabel ? [result.customLabel] : [])],
    rows: result.rows.map((p) => [
      p.lastName,
      p.firstName,
      p.mrn,
      iso(p.dob),
      ageOf(p.dob),
      p.sex,
      p.phone ?? "",
      p.email ?? "",
      p.textConsent === "YES" ? "Yes" : p.textConsent === "NO" ? "Declined" : "Not asked",
      p.insurances[0]?.payer.name ?? "",
      iso(p.lastVisit),
      p.problems.map((x) => `${x.icd10} ${x.description}`).join("; "),
      p.medications.map((m) => m.name).join("; "),
      p.wounds.map((w) => `${w.label} ${w.location}`).join("; "),
      ...(result.customLabel ? [p.custom] : []),
    ]),
  };
}
