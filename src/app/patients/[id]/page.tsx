import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/StatusBadge";
import { ageFromDob, formatDate, formatTime, patientName } from "@/lib/format";

export default async function PatientChartPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const patient = await prisma.patient.findUnique({
    where: { id },
    include: {
      insurances: true,
      allergies: true,
      problems: true,
      medications: true,
      appointments: { include: { provider: true }, orderBy: { startsAt: "desc" }, take: 8 },
      encounters: { include: { provider: true }, orderBy: { date: "desc" }, take: 8 },
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
                  <strong>{m.name}</strong> — {m.sig}
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
