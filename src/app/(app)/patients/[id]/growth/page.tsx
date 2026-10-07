import { rolesFor } from "@/lib/permissions";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";
import { GrowthChart } from "@/components/GrowthChart";
import { MEASURES, ageInMonths, chartsFor, percentile, percentileText, type GrowthMeasure } from "@/lib/growth-charts";
import { PatientShell, loadPatientShell } from "../patient-shell";

const CHART_ROLES = rolesFor("chart.view");

// The patient's growth measurements against the CDC curves (under 20), with percentiles per visit.
export default async function GrowthPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(CHART_ROLES);
  const { id } = await params;
  const shell = await loadPatientShell(id, user);
  const data = await loadGrowth(id);

  return (
    <PatientShell data={shell}>
      <p className="pd-back no-print">
        <Link href={`/patients/${id}`}>« Back to dashboard</Link>
      </p>
      <div className="pd-head">
        <h1>Growth charts</h1>
        <PrintButton label="Print charts" className="btn secondary no-print" />
      </div>
      {!data.pediatric ? (
        <p className="muted">Growth charts cover patients from birth to 20 years. This patient is {Math.floor(data.ageMonths / 12)}.</p>
      ) : data.rows.length === 0 ? (
        <p className="muted">No height, weight or head circumference recorded yet — they come from the vitals on each visit.</p>
      ) : (
        <>
          <section className="panel">
            <h2>Measurements</h2>
            <table className="cn-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Age</th>
                  <th>Weight</th>
                  <th>Length / height</th>
                  <th>Head circ.</th>
                  <th>BMI</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.at.toISOString()}>
                    <td>{formatDate(r.at)}</td>
                    <td>{r.ageMonths < 36 ? `${Math.floor(r.ageMonths)} mo` : `${Math.floor(r.ageMonths / 12)} y ${Math.floor(r.ageMonths % 12)} mo`}</td>
                    <td>{cell(r.weight, r.pct.weight, "kg")}</td>
                    <td>{cell(r.height, r.pct.height, "cm")}</td>
                    <td>{cell(r.head, r.pct.head, "cm")}</td>
                    <td>{cell(r.bmi, r.pct.bmi, "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.flags.length > 0 && (
              <p className="gw-missing" style={{ marginTop: "0.5rem" }}>
                {data.flags.join(" · ")}
              </p>
            )}
          </section>
          <div className="gc-grid">
            {data.charts.map((m) => (
              <section className="panel" key={m}>
                <GrowthChart measure={m} sex={data.sex} points={data.pointsFor(m)} />
              </section>
            ))}
          </div>
        </>
      )}
    </PatientShell>
  );
}

const cell = (v: number | null, p: number | null, unit: string) => (v === null ? "—" : `${v}${unit ? ` ${unit}` : ""} · ${percentileText(p)}`);

export async function loadGrowth(patientId: string) {
  const patient = await prisma.patient.findUniqueOrThrow({ where: { id: patientId }, select: { dob: true, sex: true } });
  const sex: "M" | "F" = patient.sex === "F" ? "F" : "M";
  const now = new Date();
  const ageNow = ageInMonths(patient.dob, now);
  const vitals = await prisma.vitals.findMany({
    where: { encounter: { patientId }, OR: [{ weightKg: { not: null } }, { heightCm: { not: null } }, { headCircumferenceCm: { not: null } }] },
    orderBy: { recordedAt: "asc" },
    select: { recordedAt: true, weightKg: true, heightCm: true, headCircumferenceCm: true, encounter: { select: { date: true } } },
  });
  const rows = vitals.map((v) => {
    const at = v.encounter.date;
    const age = ageInMonths(patient.dob, at);
    const infant = age <= 36;
    const bmi = v.weightKg && v.heightCm ? Math.round((v.weightKg / Math.pow(v.heightCm / 100, 2)) * 10) / 10 : null;
    return {
      at,
      ageMonths: age,
      weight: v.weightKg,
      height: v.heightCm,
      head: v.headCircumferenceCm,
      bmi,
      pct: {
        weight: v.weightKg ? percentile(infant ? "weight_inf" : "weight", sex, age, v.weightKg) : null,
        height: v.heightCm ? percentile(infant ? "length_inf" : "stature", sex, age, v.heightCm) : null,
        head: v.headCircumferenceCm && infant ? percentile("head_inf", sex, age, v.headCircumferenceCm) : null,
        bmi: bmi && age >= 24 ? percentile("bmi", sex, age, bmi) : null,
      },
    };
  });
  const latest = rows[rows.length - 1];
  const flags: string[] = [];
  if (latest) {
    if (latest.pct.bmi !== null && latest.pct.bmi >= 95) flags.push("BMI at or above the 95th percentile (obesity range)");
    else if (latest.pct.bmi !== null && latest.pct.bmi >= 85) flags.push("BMI 85th–94th percentile (overweight range)");
    if (latest.pct.bmi !== null && latest.pct.bmi < 5) flags.push("BMI under the 5th percentile (underweight range)");
    if (latest.pct.weight !== null && latest.pct.weight < 3) flags.push("Weight under the 3rd percentile");
    if (latest.pct.height !== null && latest.pct.height < 3) flags.push("Length/height under the 3rd percentile");
    if (latest.pct.head !== null && (latest.pct.head < 3 || latest.pct.head > 97)) flags.push("Head circumference outside the 3rd–97th percentile");
    // Crossing two major percentile lines downward on weight between consecutive measurements.
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1].pct.weight;
      const b = rows[i].pct.weight;
      if (a !== null && b !== null && a - b >= 25 && !flags.some((f) => f.startsWith("Weight percentile fell"))) flags.push(`Weight percentile fell from ${percentileText(a)} to ${percentileText(b)} (${formatDate(rows[i].at)})`);
    }
  }
  const charts = chartsFor(ageNow);
  const pointsFor = (m: GrowthMeasure) =>
    rows
      .map((r) => ({ at: r.at, ageMonths: r.ageMonths, value: (m === "weight_inf" || m === "weight" ? r.weight : m === "length_inf" || m === "stature" ? r.height : m === "head_inf" ? r.head : r.bmi) ?? 0 }))
      .filter((p) => p.value > 0 && p.ageMonths >= MEASURES[m].ageMin && p.ageMonths <= MEASURES[m].ageMax);
  return { pediatric: ageNow <= 240, ageMonths: ageNow, sex, rows, charts, pointsFor, flags, latest };
}
