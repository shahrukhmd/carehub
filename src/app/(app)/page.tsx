import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/StatusBadge";
import { requireUser } from "@/lib/auth";
import { formatMoney, formatTime, patientName } from "@/lib/format";

export default async function DashboardPage() {
  const user = await requireUser();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const [todayAppts, patientCount, openCharts, claims] = await Promise.all([
    prisma.appointment.findMany({
      where: { practiceId: user.practiceId, startsAt: { gte: start, lt: end } },
      include: { patient: true, provider: true },
      orderBy: { startsAt: "asc" },
    }),
    prisma.patient.count({ where: { practiceId: user.practiceId } }),
    prisma.encounter.count({ where: { practiceId: user.practiceId, status: { not: "SIGNED" } } }),
    prisma.claim.findMany({ where: { charge: { practiceId: user.practiceId } } }),
  ]);

  const billed = claims.reduce((s, c) => s + c.billedCents, 0);
  const paid = claims.reduce((s, c) => s + c.paidCents, 0);
  const aging = claims.filter((c) => c.status === "SUBMITTED").length;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Today</p>
          <h1>Command center</h1>
        </div>
        <Link className="btn" href="/patients/new">
          Register patient
        </Link>
      </div>

      <section className="grid-stats">
        <div className="stat">
          <span>Today&apos;s visits</span>
          <strong>{todayAppts.length}</strong>
        </div>
        <div className="stat">
          <span>Active patients</span>
          <strong>{patientCount}</strong>
        </div>
        <div className="stat">
          <span>Unsigned charts</span>
          <strong>{openCharts}</strong>
        </div>
        <div className="stat">
          <span>AR (billed / paid)</span>
          <strong>
            {formatMoney(billed)} / {formatMoney(paid)}
          </strong>
        </div>
      </section>

      <div className="two-col">
        <section className="panel">
          <h2>Front-desk board</h2>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Patient</th>
                <th>Provider</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {todayAppts.map((appt) => (
                <tr key={appt.id}>
                  <td>{formatTime(appt.startsAt)}</td>
                  <td>
                    <Link href={`/patients/${appt.patientId}`}>{patientName(appt.patient)}</Link>
                    <div className="muted">{appt.reason}</div>
                  </td>
                  <td>{appt.provider.name}</td>
                  <td>
                    <StatusBadge value={appt.status} />
                  </td>
                </tr>
              ))}
              {todayAppts.length === 0 && (
                <tr>
                  <td colSpan={4}>No visits on the board. Book from Schedule.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
        <section className="panel">
          <h2>Work queues</h2>
          <p>
            <Link href="/encounters">{openCharts} charts waiting to sign</Link>
          </p>
          <p>
            <Link href="/billing">{aging} claims in submitted / not paid</Link>
          </p>
          <p className="muted">
            CareHub ties registration, the appointment book, the encounter, and the claim on one patient record so front
            office, clinicians, and billing share the same source of truth.
          </p>
        </section>
      </div>
    </>
  );
}
