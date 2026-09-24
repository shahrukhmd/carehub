import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/StatusBadge";
import { ageFromDob, calcBmi, formatDate, formatTime, patientName } from "@/lib/format";
import { requireUser } from "@/lib/auth";
import { etiologyLabel } from "@/lib/wound";

export default async function PatientChartPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "CLINICIAN"]);
  const { id } = await params;
  const patient = await prisma.patient.findFirst({
    where: { id, practiceId: user.practiceId },
    include: {
      insurances: true,
      allergies: true,
      problems: true,
      medications: { orderBy: { startDate: "desc" } },
      appointments: { include: { provider: true }, orderBy: { startsAt: "desc" }, take: 8 },
      encounters: {
        include: { provider: true, vitals: true },
        orderBy: { date: "desc" },
        take: 8,
      },
      labOrders: {
        include: { result: true },
        orderBy: { orderedAt: "desc" },
        take: 8,
      },
      wounds: {
        include: { assessments: { orderBy: { assessedAt: "desc" }, take: 1 } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!patient) notFound();

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">{patient.mrn}</p>
          <h1>{patientName(patient)}</h1>
          <p className="chart-meta">
            <span>
              {ageFromDob(patient.dob)}y {patient.sex} · DOB {formatDate(patient.dob)}
            </span>
            <span>{patient.phone ?? "No phone"}</span>
            <span>{patient.insurances.find((i) => i.isPrimary)?.payerName ?? "Self-pay"}</span>
          </p>
        </div>
        <Link className="btn" href="/schedule">
          Book visit
        </Link>
      </div>

      <div className="two-col">
        <div className="stack">
          <section className="panel">
            <h2>Problem list</h2>
            {patient.problems.length === 0 && <p className="muted">No active problems.</p>}
            <ul>
              {patient.problems.map((p) => (
                <li key={p.id}>
                  <strong>{p.icd10}</strong> {p.description} <StatusBadge value={p.status} />
                </li>
              ))}
            </ul>
          </section>
          <section className="panel">
            <h2>Medications</h2>
            {patient.medications.length === 0 && <p className="muted">No medications on file.</p>}
            <ul>
              {patient.medications.map((m) => (
                <li key={m.id}>
                  <strong>{m.name}</strong> — {m.sig} <StatusBadge value={m.status} />
                </li>
              ))}
            </ul>
          </section>
          <section className="panel">
            <h2>Vitals trend</h2>
            {patient.encounters.filter((e) => e.vitals).length === 0 && (
              <p className="muted">No vitals recorded yet.</p>
            )}
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>BP</th>
                  <th>HR</th>
                  <th>SpO2</th>
                  <th>BMI</th>
                </tr>
              </thead>
              <tbody>
                {patient.encounters
                  .filter((e) => e.vitals)
                  .map((e) => {
                    const bmi = calcBmi(e.vitals!.heightCm, e.vitals!.weightKg);
                    return (
                      <tr key={e.id}>
                        <td>{formatDate(e.date)}</td>
                        <td>
                          {e.vitals!.bpSystolic ?? "—"}/{e.vitals!.bpDiastolic ?? "—"}
                        </td>
                        <td>{e.vitals!.heartRate ?? "—"}</td>
                        <td>{e.vitals!.spo2 ?? "—"}</td>
                        <td>{bmi ? bmi.toFixed(1) : "—"}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </section>
          <section className="panel">
            <h2>Wounds</h2>
            {patient.wounds.length === 0 && <p className="muted">No wounds on file.</p>}
            <ul>
              {patient.wounds.map((w) => {
                const latest = w.assessments[0];
                const recentEncounterId = patient.encounters[0]?.id;
                const label = (
                  <>
                    <strong>{w.label}</strong> <StatusBadge value={w.status} />
                    <div className="muted">
                      {w.location} · {etiologyLabel[w.etiology] ?? w.etiology}
                      {latest?.areaCm2 ? ` · Last area ${latest.areaCm2.toFixed(1)} cm²` : ""}
                    </div>
                  </>
                );
                return (
                  <li key={w.id}>
                    {recentEncounterId ? (
                      <Link href={`/encounters/${recentEncounterId}/wounds/${w.id}`}>{label}</Link>
                    ) : (
                      label
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="panel">
            <h2>Labs</h2>
            {patient.labOrders.length === 0 && <p className="muted">No labs ordered.</p>}
            <ul>
              {patient.labOrders.map((o) => (
                <li key={o.id}>
                  <strong>{o.testName}</strong> <StatusBadge value={o.status} />
                  {o.result && (
                    <span className="muted">
                      {" "}
                      — {o.result.value} {o.result.unit ?? ""} <StatusBadge value={o.result.flag} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section className="panel">
            <h2>Allergies</h2>
            {patient.allergies.length === 0 && <p className="muted">NKDA</p>}
            <ul>
              {patient.allergies.map((a) => (
                <li key={a.id}>
                  {a.allergen} ({a.reaction}) <StatusBadge value={a.severity} />
                </li>
              ))}
            </ul>
          </section>
        </div>
        <div className="stack">
          <section className="panel">
            <h2>Coverage</h2>
            <p>
              <Link href={`/patients/${patient.id}/statement`}>View patient statement</Link>
            </p>
            {patient.insurances.map((i) => (
              <p key={i.id}>
                {i.payerName}
                <br />
                <span className="muted">
                  {i.planName} · {i.memberId}
                </span>
              </p>
            ))}
          </section>
          <section className="panel">
            <h2>Visits</h2>
            <table>
              <tbody>
                {patient.appointments.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {formatDate(a.startsAt)} {formatTime(a.startsAt)}
                    </td>
                    <td>{a.provider.name}</td>
                    <td>
                      <StatusBadge value={a.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="panel">
            <h2>Encounters</h2>
            {patient.encounters.map((e) => (
              <p key={e.id}>
                <Link href={`/encounters/${e.id}`}>
                  {formatDate(e.date)} · {e.provider.name}
                </Link>
              </p>
            ))}
          </section>
        </div>
      </div>
    </>
  );
}
