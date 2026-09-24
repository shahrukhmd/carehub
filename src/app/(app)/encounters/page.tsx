import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, patientName } from "@/lib/format";
import { requireUser } from "@/lib/auth";

export default async function EncountersPage() {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  const encounters = await prisma.encounter.findMany({
    where: { practiceId: user.practiceId },
    include: { patient: true, provider: true },
    orderBy: { date: "desc" },
  });

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Clinical</p>
          <h1>Encounter worklist</h1>
        </div>
      </div>
      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Patient</th>
              <th>Provider</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {encounters.map((e) => (
              <tr key={e.id}>
                <td>{formatDate(e.date)}</td>
                <td>
                  <Link href={`/encounters/${e.id}`}>{patientName(e.patient)}</Link>
                </td>
                <td>{e.provider.name}</td>
                <td>
                  <StatusBadge value={e.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
