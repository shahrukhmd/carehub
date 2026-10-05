import Link from "next/link";
import { SettingsNav } from "../settings-nav";
import { prisma } from "@/lib/prisma";
import { roleLabel } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { requireUser } from "@/lib/auth";
import {
  addPracticeMember,
  createStaff,
  removeMembership,
  resetStaffPassword,
  toggleStaffActive,
  updateStaffRole,
} from "./actions";

const ROLES = ["ADMIN", "FRONT_DESK", "CLINICIAN", "BILLER", "CREDENTIALING", "INTAKE", "VERIFICATION", "SCHEDULER", "CDS", "CODER"];

export default async function StaffPage() {
  const me = await requireUser(["ADMIN"]);
  const memberships = await prisma.membership.findMany({
    where: { practiceId: me.practiceId },
    include: { user: true },
    orderBy: { user: { name: "asc" } },
  });

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link>
          </p>
          <h1>User Access Manager</h1>
        </div>
      </div>
      <SettingsNav current="users" />

      <div className="two-col">
        <section className="panel">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role here</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {memberships.map((m) => {
                const u = m.user;
                const isHome = u.practiceId === me.practiceId;
                return (
                  <tr key={m.id}>
                    <td>
                      {u.name}
                      <div className="muted">{u.email}</div>
                      {(u.npi || u.specialty) && (
                        <div className="muted">
                          {u.npi ?? "—"}
                          {u.specialty ? ` · ${u.specialty}` : ""}
                        </div>
                      )}
                      {!isHome && <div className="muted">Guest access (home practice elsewhere)</div>}
                    </td>
                    <td>
                      {u.id === me.id ? (
                        roleLabel[m.role] ?? m.role
                      ) : (
                        <form className="stack" action={updateStaffRole.bind(null, u.id)}>
                          <select name="role" defaultValue={m.role}>
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {roleLabel[r] ?? r}
                              </option>
                            ))}
                          </select>
                          <button className="btn secondary" type="submit">
                            Update role
                          </button>
                        </form>
                      )}
                    </td>
                    <td>
                      <StatusBadge value={u.active ? "ACTIVE" : "INACTIVE"} />
                    </td>
                    <td>
                      <div className="stack">
                        {isHome ? (
                          <>
                            {u.id !== me.id && (
                              <form action={toggleStaffActive.bind(null, u.id)}>
                                <button className="btn ghost" type="submit">
                                  {u.active ? "Deactivate" : "Reactivate"}
                                </button>
                              </form>
                            )}
                            <form className="stack" action={resetStaffPassword.bind(null, u.id)}>
                              <input name="password" type="password" placeholder="New password" required />
                              <button className="btn ghost" type="submit">
                                Reset password
                              </button>
                            </form>
                          </>
                        ) : (
                          <form action={removeMembership.bind(null, m.id)}>
                            <button className="btn ghost" type="submit">
                              Revoke access
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <div className="stack">
          <form className="panel stack" action={createStaff}>
            <h2>Add staff</h2>
            <label>
              Name
              <input name="name" required />
            </label>
            <label>
              Email
              <input name="email" type="email" required />
            </label>
            <label>
              Role
              <select name="role" defaultValue="FRONT_DESK">
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel[r] ?? r}
                  </option>
                ))}
              </select>
            </label>
            <label>
              NPI (clinicians)
              <input name="npi" />
            </label>
            <label>
              Specialty (clinicians)
              <input name="specialty" />
            </label>
            <label>
              Initial password
              <input name="password" type="password" required />
            </label>
            <button className="btn" type="submit">
              Create account
            </button>
          </form>

          <form className="panel stack" action={addPracticeMember}>
            <h2>Grant access to an existing user</h2>
            <p className="muted">
              For staff or consultants who already have a CareHub account at another practice and need
              access here too. They&apos;ll be able to switch between practices after signing in.
            </p>
            <label>
              Their email
              <input name="email" type="email" required />
            </label>
            <label>
              Role here
              <select name="role" defaultValue="CLINICIAN">
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel[r] ?? r}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn secondary" type="submit">
              Grant access
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
