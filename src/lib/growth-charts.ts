// Pediatric growth charts: CDC 2000 LMS reference tables (public domain, cdc.gov/growthcharts) for
// weight, length/stature, head circumference and BMI by age and sex. Percentiles and z-scores use the LMS method:
//   z = ((x / M) ^ L - 1) / (L * S)       (L ≠ 0)
//   z = ln(x / M) / S                     (L = 0)
// Infant tables (0–36 months) are the CDC ones; CDC itself recommends the WHO standard under 2 years — swap the
// table in src/data/growth when the practice wants WHO curves.
import tables from "@/data/growth/cdc-lms.json";

type Row = [ageMonths: number, L: number, M: number, S: number];
type Table = { M: Row[]; F: Row[] };
const DATA = tables as unknown as Record<GrowthMeasure, Table>;

export type GrowthMeasure = "weight_inf" | "length_inf" | "head_inf" | "weight" | "stature" | "bmi";

export const MEASURES: Record<GrowthMeasure, { label: string; unit: string; ageMin: number; ageMax: number }> = {
  weight_inf: { label: "Weight for age (0–36 months)", unit: "kg", ageMin: 0, ageMax: 36 },
  length_inf: { label: "Length for age (0–36 months)", unit: "cm", ageMin: 0, ageMax: 36 },
  head_inf: { label: "Head circumference for age (0–36 months)", unit: "cm", ageMin: 0, ageMax: 36 },
  weight: { label: "Weight for age (2–20 years)", unit: "kg", ageMin: 24, ageMax: 240 },
  stature: { label: "Stature for age (2–20 years)", unit: "cm", ageMin: 24, ageMax: 240 },
  bmi: { label: "BMI for age (2–20 years)", unit: "kg/m²", ageMin: 24, ageMax: 240 },
};

export const PERCENTILE_LINES = [3, 5, 10, 25, 50, 75, 90, 95, 97];

export function ageInMonths(dob: Date, at: Date) {
  return (at.getTime() - dob.getTime()) / (365.25 * 86_400_000) * 12;
}

// LMS parameters at an exact age, interpolated between the table's rows.
function lmsAt(measure: GrowthMeasure, sex: "M" | "F", ageMonths: number): { L: number; M: number; S: number } | null {
  const rows = DATA[measure]?.[sex];
  if (!rows?.length) return null;
  if (ageMonths < rows[0][0] || ageMonths > rows[rows.length - 1][0]) return null;
  let i = rows.findIndex((r) => r[0] >= ageMonths);
  if (i <= 0) return { L: rows[0][1], M: rows[0][2], S: rows[0][3] };
  const a = rows[i - 1];
  const b = rows[i];
  const t = b[0] === a[0] ? 0 : (ageMonths - a[0]) / (b[0] - a[0]);
  return { L: a[1] + (b[1] - a[1]) * t, M: a[2] + (b[2] - a[2]) * t, S: a[3] + (b[3] - a[3]) * t };
}

// Standard normal CDF / inverse (Abramowitz–Stegun and Acklam approximations — plenty for percentiles).
function cdf(z: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
function inv(p: number) {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function zScore(measure: GrowthMeasure, sex: "M" | "F", ageMonths: number, value: number) {
  const p = lmsAt(measure, sex, ageMonths);
  if (!p || value <= 0) return null;
  const z = p.L === 0 ? Math.log(value / p.M) / p.S : (Math.pow(value / p.M, p.L) - 1) / (p.L * p.S);
  return Number.isFinite(z) ? z : null;
}

export function percentile(measure: GrowthMeasure, sex: "M" | "F", ageMonths: number, value: number) {
  const z = zScore(measure, sex, ageMonths, value);
  return z === null ? null : Math.round(cdf(z) * 1000) / 10;
}

// The value on a given percentile line at an age (for drawing the curves).
export function valueAtPercentile(measure: GrowthMeasure, sex: "M" | "F", ageMonths: number, pct: number) {
  const p = lmsAt(measure, sex, ageMonths);
  if (!p) return null;
  const z = inv(pct / 100);
  return p.L === 0 ? p.M * Math.exp(p.S * z) : p.M * Math.pow(1 + p.L * p.S * z, 1 / p.L);
}

export const percentileText = (p: number | null) => (p === null ? "—" : p < 1 ? "<1st" : p > 99 ? ">99th" : `${Math.round(p)}${["th", "st", "nd", "rd"][Math.round(p) % 10 > 3 || [11, 12, 13].includes(Math.round(p) % 100) ? 0 : Math.round(p) % 10]}`);

// Which charts apply to a patient: infant tables under 3 (36 months), child tables from 2 to 20.
export function chartsFor(ageMonths: number): GrowthMeasure[] {
  const out: GrowthMeasure[] = [];
  if (ageMonths <= 36) out.push("weight_inf", "length_inf", "head_inf");
  if (ageMonths >= 24 && ageMonths <= 240) out.push("weight", "stature", "bmi");
  return out;
}

export type GrowthPoint = { at: Date; ageMonths: number; value: number; percentile: number | null; z: number | null };

// Curve data for one chart: the percentile lines across the age range plus the patient's points.
export function chartSeries(measure: GrowthMeasure, sex: "M" | "F", points: { at: Date; ageMonths: number; value: number }[]) {
  const m = MEASURES[measure];
  const step = m.ageMax <= 36 ? 1 : 6;
  const ages: number[] = [];
  for (let a = m.ageMin; a <= m.ageMax; a += step) ages.push(a);
  const lines = PERCENTILE_LINES.map((pct) => ({ pct, values: ages.map((a) => valueAtPercentile(measure, sex, a, pct) ?? 0) }));
  const pts: GrowthPoint[] = points
    .filter((p) => p.ageMonths >= m.ageMin && p.ageMonths <= m.ageMax)
    .map((p) => ({ ...p, percentile: percentile(measure, sex, p.ageMonths, p.value), z: zScore(measure, sex, p.ageMonths, p.value) }));
  return { ages, lines, points: pts, measure: m };
}
