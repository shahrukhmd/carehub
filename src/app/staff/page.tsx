import { prisma } from "@/lib/prisma";
import { roleLabel } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";

export default async function StaffPage() {
  const users = await prisma.user.findMany({ orderBy: { name: "asc" } });

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Administration</p>
          <h1>Staff &amp; roles</h1>
        </div>
      </div>
      <section className="panel">
        <p className="muted">
          Roles in this first pass: Administrator, Front desk, Clinician, Billing. Login and permission gates come next;
          the seed users are for workflow demos.
        </p>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>NPI / specialty</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{roleLabel[u.role] ?? u.role}</td>
                <td>
                  {u.npi ?? "—"}
                  {u.specialty ? ` · ${u.specialty}` : ""}
                </td>
                <td>
                  <StatusBadge value={u.active ? "ACTIVE" : "INACTIVE"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
