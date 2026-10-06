// Immunization forecast: the CDC/ACIP routine schedule (child, adolescent, adult) reduced to series rules, applied
// to the vaccines on the patient's record. Each series gives the dose that is next, when it is due, when it
// becomes overdue, and whether the series is complete. A rule engine, not a CDS vendor: catch-up intervals,
// risk-based vaccines and contraindications are simplified and the clinician decides.

export type ForecastStatus = "COMPLETE" | "UP_TO_DATE" | "DUE" | "OVERDUE" | "NOT_YET" | "AGED_OUT";

export type Forecast = {
  key: string;
  name: string;
  status: ForecastStatus;
  dosesGiven: number;
  dosesTotal: number | null; // null = recurring (yearly / every 10 years)
  nextDose: number | null;
  dueAt: Date | null;
  overdueAt: Date | null;
  lastGiven: Date | null;
  note?: string;
};

type Dose = { minAgeMonths: number; recMinAgeMonths?: number; minIntervalDays?: number; recIntervalDays?: number; overdueAgeMonths?: number };
type Series = {
  key: string;
  name: string;
  // CVX codes and name fragments that count as a dose of this series.
  cvx: string[];
  match: RegExp;
  doses?: Dose[];
  // Recurring: every N days after the last dose, from an age.
  every?: { days: number; fromAgeMonths: number; label: string };
  ageMaxMonths?: number; // not forecast past this age
  ageMinMonths?: number;
  note?: string;
};

const M = (y: number, m = 0) => y * 12 + m;
const D = (d: number) => d;
const W = (w: number) => w * 7;

// Routine schedule. Dose rows: minimum age, recommended age, minimum interval from the previous dose, and the age
// at which a missing dose is overdue (defaults to the next recommended window's end).
const SERIES: Series[] = [
  {
    key: "hepb",
    name: "Hepatitis B",
    cvx: ["08", "43", "44", "45", "51", "189", "220"],
    match: /hep\s*b|hepatitis b/i,
    doses: [
      { minAgeMonths: 0, overdueAgeMonths: 2 },
      { minAgeMonths: 1, recMinAgeMonths: 1, minIntervalDays: W(4), overdueAgeMonths: 4 },
      { minAgeMonths: 6, minIntervalDays: W(8), overdueAgeMonths: 19 },
    ],
    note: "Adults 19–59 not previously vaccinated: 2- or 3-dose series.",
  },
  {
    key: "rota",
    name: "Rotavirus",
    cvx: ["116", "119", "122"],
    match: /rota/i,
    doses: [
      { minAgeMonths: 1.5, recMinAgeMonths: 2, overdueAgeMonths: 3.5 },
      { minAgeMonths: 2.5, minIntervalDays: W(4), overdueAgeMonths: 5 },
      { minAgeMonths: 3.5, minIntervalDays: W(4), overdueAgeMonths: 8 },
    ],
    ageMaxMonths: 8,
    note: "Not started after 15 weeks; no dose after 8 months.",
  },
  {
    key: "dtap",
    name: "DTaP (under 7)",
    cvx: ["20", "106", "107", "110", "120", "146", "50", "130"],
    match: /dtap|diphtheria.*(pertussis|acellular)|pentacel|pediarix|vaxelis|kinrix|quadracel/i,
    doses: [
      { minAgeMonths: 1.5, recMinAgeMonths: 2, overdueAgeMonths: 3 },
      { minAgeMonths: 2.5, minIntervalDays: W(4), overdueAgeMonths: 5 },
      { minAgeMonths: 3.5, minIntervalDays: W(4), overdueAgeMonths: 7 },
      { minAgeMonths: 12, recMinAgeMonths: 15, minIntervalDays: D(183), overdueAgeMonths: 19 },
      { minAgeMonths: 48, minIntervalDays: D(183), overdueAgeMonths: 84 },
    ],
    ageMaxMonths: 84,
  },
  {
    key: "tdap",
    name: "Tdap / Td (7+)",
    cvx: ["115", "113", "139", "112", "09", "138"],
    match: /tdap|\btd\b|tetanus/i,
    ageMinMonths: M(7),
    doses: [{ minAgeMonths: M(7), recMinAgeMonths: M(11), overdueAgeMonths: M(13) }],
    every: { days: 3652, fromAgeMonths: M(7), label: "Td or Tdap booster every 10 years" },
  },
  {
    key: "hib",
    name: "Hib",
    cvx: ["17", "46", "47", "48", "49", "50", "51", "120", "146", "148"],
    match: /\bhib\b|haemophilus/i,
    doses: [
      { minAgeMonths: 1.5, recMinAgeMonths: 2, overdueAgeMonths: 3 },
      { minAgeMonths: 2.5, minIntervalDays: W(4), overdueAgeMonths: 5 },
      { minAgeMonths: 3.5, minIntervalDays: W(4), overdueAgeMonths: 7 },
      { minAgeMonths: 12, recMinAgeMonths: 12, minIntervalDays: W(8), overdueAgeMonths: 19 },
    ],
    ageMaxMonths: 60,
  },
  {
    key: "pcv",
    name: "Pneumococcal conjugate (child)",
    cvx: ["133", "152", "215", "216"],
    match: /pcv|pneumococcal conjugate|prevnar|vaxneuvance/i,
    doses: [
      { minAgeMonths: 1.5, recMinAgeMonths: 2, overdueAgeMonths: 3 },
      { minAgeMonths: 2.5, minIntervalDays: W(4), overdueAgeMonths: 5 },
      { minAgeMonths: 3.5, minIntervalDays: W(4), overdueAgeMonths: 7 },
      { minAgeMonths: 12, minIntervalDays: W(8), overdueAgeMonths: 19 },
    ],
    ageMaxMonths: 60,
  },
  {
    key: "pneumo_adult",
    name: "Pneumococcal (65+)",
    cvx: ["133", "152", "215", "216", "33", "109"],
    match: /pneumo|pcv|ppsv/i,
    ageMinMonths: M(65),
    doses: [{ minAgeMonths: M(65), overdueAgeMonths: M(66) }],
    note: "PCV20 once, or PCV15 followed by PPSV23 a year later. Earlier for risk conditions.",
  },
  {
    key: "ipv",
    name: "Polio (IPV)",
    cvx: ["10", "89", "110", "120", "146", "130", "132"],
    match: /ipv|polio/i,
    doses: [
      { minAgeMonths: 1.5, recMinAgeMonths: 2, overdueAgeMonths: 3 },
      { minAgeMonths: 2.5, minIntervalDays: W(4), overdueAgeMonths: 5 },
      { minAgeMonths: 6, minIntervalDays: W(4), overdueAgeMonths: 19 },
      { minAgeMonths: 48, minIntervalDays: D(183), overdueAgeMonths: 84 },
    ],
    ageMaxMonths: M(18),
  },
  {
    key: "mmr",
    name: "MMR",
    cvx: ["03", "94"],
    match: /mmr|measles/i,
    doses: [
      { minAgeMonths: 12, overdueAgeMonths: 16 },
      { minAgeMonths: 13, recMinAgeMonths: 48, minIntervalDays: W(4), overdueAgeMonths: 84 },
    ],
    ageMaxMonths: M(60),
  },
  {
    key: "var",
    name: "Varicella",
    cvx: ["21", "94"],
    match: /varicella|chickenpox/i,
    doses: [
      { minAgeMonths: 12, overdueAgeMonths: 16 },
      { minAgeMonths: 15, recMinAgeMonths: 48, minIntervalDays: W(12), overdueAgeMonths: 84 },
    ],
    ageMaxMonths: M(50),
    note: "Skip if the patient has had chickenpox or has immunity on record.",
  },
  {
    key: "hepa",
    name: "Hepatitis A",
    cvx: ["83", "84", "85", "31", "104"],
    match: /hep\s*a\b|hepatitis a/i,
    doses: [
      { minAgeMonths: 12, overdueAgeMonths: 24 },
      { minAgeMonths: 18, minIntervalDays: D(183), overdueAgeMonths: 41 },
    ],
    ageMaxMonths: M(19),
  },
  {
    key: "hpv",
    name: "HPV",
    cvx: ["62", "118", "137", "165"],
    match: /hpv|papilloma|gardasil/i,
    doses: [
      { minAgeMonths: M(9), recMinAgeMonths: M(11), overdueAgeMonths: M(13) },
      { minAgeMonths: M(9, 6), minIntervalDays: D(150), overdueAgeMonths: M(13, 6) },
    ],
    ageMaxMonths: M(27),
    note: "2 doses if started before 15; 3 doses (0, 1–2, 6 months) if started at 15 or older or immunocompromised.",
  },
  {
    key: "menacwy",
    name: "Meningococcal ACWY",
    cvx: ["114", "136", "147", "167", "203"],
    match: /menacwy|meningococcal (acwy|conjugate)|menveo|menquadfi|menactra/i,
    doses: [
      { minAgeMonths: M(11), overdueAgeMonths: M(13) },
      { minAgeMonths: M(16), minIntervalDays: W(8), overdueAgeMonths: M(17) },
    ],
    ageMaxMonths: M(22),
  },
  {
    key: "flu",
    name: "Influenza (yearly)",
    cvx: ["88", "140", "141", "150", "153", "155", "158", "161", "166", "168", "171", "185", "186", "197", "205", "231"],
    match: /influenza|\bflu\b/i,
    every: { days: 365, fromAgeMonths: 6, label: "Every season (Sept–Mar)" },
    ageMinMonths: 6,
  },
  {
    key: "covid",
    name: "COVID-19",
    cvx: ["207", "208", "210", "211", "212", "213", "217", "218", "219", "229", "230", "300", "301", "302", "308", "309", "310", "311", "312", "313"],
    match: /covid|sars-cov/i,
    every: { days: 365, fromAgeMonths: 6, label: "Current-season dose" },
    ageMinMonths: 6,
  },
  {
    key: "zoster",
    name: "Shingles (RZV, Shingrix)",
    cvx: ["187"],
    match: /zoster|shingrix|shingles/i,
    ageMinMonths: M(50),
    doses: [
      { minAgeMonths: M(50), overdueAgeMonths: M(51) },
      { minAgeMonths: M(50, 2), minIntervalDays: W(8), recIntervalDays: W(8), overdueAgeMonths: M(51) },
    ],
  },
  {
    key: "rsv_adult",
    name: "RSV (75+, or 60–74 at risk)",
    cvx: ["303", "304", "305"],
    match: /rsv|respiratory syncytial/i,
    ageMinMonths: M(75),
    doses: [{ minAgeMonths: M(60), overdueAgeMonths: M(76) }],
    note: "Single dose; 60–74 with risk conditions by shared decision.",
  },
];

export const FORECAST_STATUS: Record<ForecastStatus, [string, string]> = {
  OVERDUE: ["Overdue", "bad"],
  DUE: ["Due now", "warn"],
  NOT_YET: ["Not yet due", "muted"],
  UP_TO_DATE: ["Up to date", "ok"],
  COMPLETE: ["Series complete", "ok"],
  AGED_OUT: ["Past the age for this series", "muted"],
};

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const atAge = (dob: Date, months: number) => new Date(dob.getFullYear(), dob.getMonth() + Math.floor(months), dob.getDate() + Math.round((months % 1) * 30));

export function immunizationForecast(dob: Date, sex: string | null, records: { vaccine: string; cvxCode: string | null; administeredAt: Date; source?: string }[], now = new Date()): Forecast[] {
  const ageMonths = (now.getTime() - dob.getTime()) / (365.25 * 86_400_000) * 12;
  const given = records.filter((r) => r.source !== "REFUSED");
  const out: Forecast[] = [];
  for (const s of SERIES) {
    if (s.key === "hpv" && sex === null) {
      // HPV applies to all; nothing sex-specific here.
    }
    const doses = given
      .filter((r) => (r.cvxCode && s.cvx.includes(r.cvxCode)) || s.match.test(r.vaccine))
      .sort((a, b) => a.administeredAt.getTime() - b.administeredAt.getTime());
    const lastGiven = doses[doses.length - 1]?.administeredAt ?? null;
    const base: Forecast = { key: s.key, name: s.name, status: "NOT_YET", dosesGiven: doses.length, dosesTotal: s.doses?.length ?? null, nextDose: null, dueAt: null, overdueAt: null, lastGiven, note: s.note };

    if (s.ageMinMonths !== undefined && ageMonths < s.ageMinMonths) {
      if (doses.length === 0) continue; // nothing to show before the series starts (keeps the list short)
    }
    if (s.ageMaxMonths !== undefined && ageMonths > s.ageMaxMonths) {
      if (s.doses && doses.length >= s.doses.length) out.push({ ...base, status: "COMPLETE" });
      else if (doses.length > 0 || s.ageMaxMonths >= 12) out.push({ ...base, status: "AGED_OUT" });
      continue;
    }

    // Primary series.
    if (s.doses && doses.length < s.doses.length) {
      const next = s.doses[doses.length];
      const earliestByAge = atAge(dob, next.recMinAgeMonths ?? next.minAgeMonths);
      const earliestByInterval = lastGiven && next.minIntervalDays ? addDays(lastGiven, next.recIntervalDays ?? next.minIntervalDays) : null;
      const dueAt = earliestByInterval && earliestByInterval > earliestByAge ? earliestByInterval : earliestByAge;
      const overdueAt = next.overdueAgeMonths !== undefined ? atAge(dob, next.overdueAgeMonths) : addDays(dueAt, 60);
      const status: ForecastStatus = now >= overdueAt ? "OVERDUE" : now >= dueAt ? "DUE" : "NOT_YET";
      out.push({ ...base, status, nextDose: doses.length + 1, dueAt, overdueAt });
      continue;
    }
    // Recurring doses (flu, COVID, Td boosters).
    if (s.every) {
      const start = atAge(dob, s.every.fromAgeMonths);
      const dueAt = lastGiven ? addDays(lastGiven, s.every.days) : start;
      const overdueAt = addDays(dueAt, s.every.days >= 3000 ? 365 : 90);
      const status: ForecastStatus = now < start ? "NOT_YET" : now >= overdueAt ? "OVERDUE" : now >= dueAt ? "DUE" : "UP_TO_DATE";
      out.push({ ...base, status, nextDose: doses.length + 1, dueAt, overdueAt, note: s.every.label });
      continue;
    }
    out.push({ ...base, status: "COMPLETE" });
  }
  const rank: Record<ForecastStatus, number> = { OVERDUE: 0, DUE: 1, NOT_YET: 2, UP_TO_DATE: 3, COMPLETE: 4, AGED_OUT: 5 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0));
}
