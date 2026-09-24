import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ageFromDob, patientName } from "@/lib/format";
import { requireUser } from "@/lib/auth";

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "CLINICIAN"]);
  const { q } = await searchParams;
  const query = q?.trim();

  const patients = await prisma.patient.findMany({
    where: {
      practiceId: user.practiceId,
      ...(query
        ? {
            OR: [
              { firstName: { contains: query } },
              { lastName: { contains: query } },
              { mrn: { contains: query } },
            ],
          }
        : {}),
    },
    include: { insurances: { include: { payer: true } } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Practice management</p>
          <h1>Patient registry</h1>
        </div>
        <Link className="btn" href="/patients/new">
          New patient
        </Link>
      </div>

      <form className="panel" action="/patients" method="get" style={{ marginBottom: "1rem" }}>
        <label>
          Search name or MRN
          <input name="q" defaultValue={query} placeholder="Vasquez or CH-100241" />
        </label>
      </form>

      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>MRN</th>
              <th>Name</th>
              <th>Age / sex</th>
              <th>Payer</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {patients.map((p) => (
              <tr key={p.id}>
                <td>{p.mrn}</td>
                <td>
                  <Link href={`/patients/${p.id}`}>{patientName(p)}</Link>
                </td>
                <td>
                  {ageFromDob(p.dob)} / {p.sex}
                </td>
                <td>{p.insurances.find((i) => i.isPrimary)?.payer.name ?? "Self-pay"}</td>
                <td>{p.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
