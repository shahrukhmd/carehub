import "server-only";
import { prisma } from "@/lib/prisma";

// Quality measures worked out from what is already in the chart. They follow the intent of the named MIPS
// measures but are simplified (no value-set lookups, no exclusions beyond those noted), so they are for the
// practice's own improvement work and gap lists — not a certified eCQM calculation or a submission file.

export type MeasurePatient = { id: string; name: string; mrn: string; detail: string; restricted: boolean };
export type MeasureResult = {
  key: string;
  title: string;
  basedOn: string;
  description: string;
  // What one unit of the denominator is.
  unit: "patients" | "visits" | "wounds";
  denominator: number;
  numerator: number;
  // Higher is better for every measure here.
  rate: number | null;
  notMet: MeasurePatient[];
};

const BILLING_ONLY = "BILLING_ONLY";
const DAY = 86_400_000;

function ageOn(dob: Date, on: Date) {
  let age = on.getFullYear() - dob.getFullYear();
  if (on.getMonth() < dob.getMonth() || (on.getMonth() === dob.getMonth() && on.getDate() < dob.getDate())) age--;
  return age;
}

export function measureYears(now = new Date()) {
  return [0, 1, 2].map((n) => now.getFullYear() - n);
}

export async function qualityMeasures(practiceId: string, year: number): Promise<MeasureResult[]> {
  const from = new Date(year, 0, 1);
  const to = new Date(year, 11, 31, 23, 59, 59);
  const end = to.getTime() > Date.now() ? new Date() : to;

  const [patients, wounds] = await Promise.all([
    // Everyone seen in the year (billing-only claims are not visits).
    prisma.patient.findMany({
      where: { practiceId, encounters: { some: { date: { gte: from, lte: to }, type: { not: BILLING_ONLY } } } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        mrn: true,
        restricted: true,
        dob: true,
        smokingStatus: true,
        problems: { where: { status: "ACTIVE" }, select: { icd10: true } },
        encounters: {
          where: { date: { gte: from, lte: to }, type: { not: BILLING_ONLY } },
          select: { id: true, date: true, medsReconciledAt: true, vitals: true, diagnoses: { select: { icd10: true } } },
          orderBy: { date: "desc" },
        },
        immunizations: { where: { administeredAt: { gte: from, lte: to } }, select: { vaccine: true, source: true } },
        sdohScreenings: { where: { screenedAt: { gte: from, lte: to } }, select: { id: true } },
      },
    }),
    // Wounds first seen early enough in the year to have had 12 weeks to heal.
    prisma.wound.findMany({
      where: { practiceId, createdAt: { gte: from, lte: new Date(end.getTime() - 84 * DAY) } },
      select: { id: true, label: true, location: true, status: true, createdAt: true, healedDate: true, patient: { select: { id: true, firstName: true, lastName: true, mrn: true, restricted: true } } },
    }),
  ]);

  const who = (p: { id: string; firstName: string; lastName: string; mrn: string; restricted: boolean }, detail: string): MeasurePatient => ({
    id: p.id,
    name: `${p.lastName}, ${p.firstName}`,
    mrn: p.mrn,
    detail,
    restricted: p.restricted,
  });
  const adults = patients.filter((p) => ageOn(p.dob, end) >= 18);
  const out: MeasureResult[] = [];
  const add = (m: Omit<MeasureResult, "rate" | "numerator"> & { numerator?: number }) => {
    const numerator = m.numerator ?? m.denominator - m.notMet.length;
    out.push({ ...m, numerator, rate: m.denominator ? Math.round((numerator / m.denominator) * 1000) / 10 : null, notMet: m.notMet.sort((a, b) => a.name.localeCompare(b.name)) });
  };

  add({
    key: "tobacco",
    title: "Tobacco use screening",
    basedOn: "MIPS 226 / CMS138",
    description: "Adults seen in the year whose tobacco use status is recorded.",
    unit: "patients",
    denominator: adults.length,
    notMet: adults.filter((p) => !p.smokingStatus).map((p) => who(p, "Tobacco status not recorded")),
  });

  add({
    key: "bmi",
    title: "Height and weight (BMI) documented",
    basedOn: "MIPS 128 / CMS69",
    description: "Adults seen in the year with a height and weight recorded at a visit. The follow-up plan for an abnormal BMI is not checked.",
    unit: "patients",
    denominator: adults.length,
    notMet: adults.filter((p) => !p.encounters.some((e) => e.vitals?.heightCm && e.vitals?.weightKg)).map((p) => who(p, "No height and weight at a visit this year")),
  });

  add({
    key: "bp_screen",
    title: "Blood pressure screening",
    basedOn: "MIPS 317 / CMS22",
    description: "Adults seen in the year with a blood pressure recorded at a visit.",
    unit: "patients",
    denominator: adults.length,
    notMet: adults.filter((p) => !p.encounters.some((e) => e.vitals?.bpSystolic && e.vitals?.bpDiastolic)).map((p) => who(p, "No blood pressure recorded this year")),
  });

  const hypertensive = patients.filter((p) => {
    const age = ageOn(p.dob, end);
    const codes = [...p.problems.map((x) => x.icd10), ...p.encounters.flatMap((e) => e.diagnoses.map((d) => d.icd10))];
    return age >= 18 && age <= 85 && codes.some((c) => c.toUpperCase().startsWith("I10"));
  });
  add({
    key: "bp_control",
    title: "Controlling high blood pressure",
    basedOn: "MIPS 236 / CMS165",
    description: "Patients 18–85 with hypertension (I10) whose most recent blood pressure in the year was below 140/90.",
    unit: "patients",
    denominator: hypertensive.length,
    notMet: hypertensive.flatMap((p) => {
      const last = p.encounters.find((e) => e.vitals?.bpSystolic && e.vitals?.bpDiastolic)?.vitals;
      if (!last) return [who(p, "No blood pressure recorded this year")];
      return last.bpSystolic! < 140 && last.bpDiastolic! < 90 ? [] : [who(p, `Last reading ${last.bpSystolic}/${last.bpDiastolic}`)];
    }),
  });

  const visits = adults.flatMap((p) => p.encounters.map((e) => ({ p, e })));
  add({
    key: "med_rec",
    title: "Current medications documented at the visit",
    basedOn: "MIPS 130 / CMS68",
    description: "Visits by adults where the medication list was marked reconciled.",
    unit: "visits",
    denominator: visits.length,
    notMet: visits.filter((v) => !v.e.medsReconciledAt).map((v) => who(v.p, `Visit ${v.e.date.toISOString().slice(0, 10)} — medications not reconciled`)),
  });

  add({
    key: "flu",
    title: "Influenza immunization",
    basedOn: "MIPS 110 / CMS147",
    description: "Patients seen in the year with an influenza vaccine given, reported or declined in the year.",
    unit: "patients",
    denominator: patients.length,
    notMet: patients.filter((p) => !p.immunizations.some((i) => /influenza|flu/i.test(i.vaccine))).map((p) => who(p, "No influenza vaccine recorded this year")),
  });

  add({
    key: "sdoh",
    title: "Screening for social needs",
    basedOn: "MIPS 487",
    description: "Adults seen in the year who were screened for social needs (or declined) during the year.",
    unit: "patients",
    denominator: adults.length,
    notMet: adults.filter((p) => p.sdohScreenings.length === 0).map((p) => who(p, "Not screened this year")),
  });

  add({
    key: "wound_healing",
    title: "Wounds healed within 12 weeks",
    basedOn: "Practice measure",
    description: "Wounds first assessed in the year (at least 12 weeks ago) that were healed within 12 weeks of the first assessment.",
    unit: "wounds",
    denominator: wounds.length,
    notMet: wounds
      .filter((w) => !(w.healedDate && w.healedDate.getTime() - w.createdAt.getTime() <= 84 * DAY))
      .map((w) => who(w.patient, `${w.label} (${w.location}) — ${w.healedDate ? `healed after ${Math.round((w.healedDate.getTime() - w.createdAt.getTime()) / (7 * DAY))} weeks` : "not healed"}`)),
  });

  return out;
}
