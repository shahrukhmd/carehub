import Link from "next/link";
import { createAppointment, startEncounter, updateAppointmentStatus } from "@/app/actions";
import { StatusBadge } from "@/components/StatusBadge";
import { prisma } from "@/lib/prisma";
import { formatDate, formatTime, patientName, visitTypeLabel } from "@/lib/format";

export default async function SchedulePage() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  const [appointments, patients, providers] = await Promise.all([
    prisma.appointment.findMany({
      where: { startsAt: { gte: start, lt: end } },
      include: { patient: true, provider: true, encounter: true },
      orderBy: { startsAt: "asc" },
    }),
    prisma.patient.findMany({ orderBy: { lastName: "asc" } }),
    prisma.user.findMany({ where: { role: "CLINICIAN" }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Practice management</p>
          <h1>Schedule</h1>
        </div>
      </div>

      <div className="two-col">
        <section className="panel">
          <h2>Next 7 days</h2>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Patient</th>
                <th>Type</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((appt) => (
                <tr key={appt.id}>
                  <td>
                    {formatDate(appt.startsAt)}
                    <div className="muted">
                      {formatTime(appt.startsAt)} · {appt.provider.name}
                    </div>
                  </td>
                  <td>
                    <Link href={`/patients/${appt.patientId}`}>{patientName(appt.patient)}</Link>
                    <div className="muted">{appt.reason}</div>
                  </td>
                  <td>{visitTypeLabel[appt.visitType] ?? appt.visitType}</td>
                  <td>
                    <StatusBadge value={appt.status} />
                  </td>
                  <td>
                    <div className="stack">
                      {appt.status === "SCHEDULED" && (
                        <form action={updateAppointmentStatus.bind(null, appt.id, "CHECKED_IN")}>
                          <button className="btn secondary" type="submit">
                            Check in
                          </button>
                        </form>
                      )}
                      {appt.status !== "COMPLETED" && appt.status !== "CANCELLED" && (
                        <form action={startEncounter.bind(null, appt.id)}>
                          <button className="btn" type="submit">
                            {appt.encounter ? "Open chart" : "Start encounter"}
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <form className="panel stack" action={createAppointment}>
          <h2>Book appointment</h2>
          <label>
            Patient
            <select name="patientId" required>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {patientName(p)} ({p.mrn})
                </option>
              ))}
            </select>
          </label>
          <label>
            Provider
            <select name="providerId" required>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Start
            <input name="startsAt" type="datetime-local" required />
          </label>
          <label>
            Visit type
            <select name="visitType" defaultValue="FOLLOW_UP">
              <option value="NEW">New patient</option>
              <option value="FOLLOW_UP">Follow-up</option>
              <option value="SICK">Sick visit</option>
              <option value="WELL">Wellness</option>
              <option value="TELE">Telehealth</option>
            </select>
          </label>
          <label>
            Reason
            <input name="reason" />
          </label>
          <button className="btn" type="submit">
            Save to book
          </button>
        </form>
      </div>
    </>
  );
}
