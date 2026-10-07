import { Fragment } from "react";
import Link from "next/link";
import { PERMISSIONS, PERMISSION_GROUPS, ROLES as ALL_ROLES, can, parseOverrides, type PermissionKey, rolesFor } from "@/lib/permissions";
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
  savePermissionOverrides,
  toggleStaffActive,
  updateStaffRole,
} from "./actions";

const ROLES = ["ADMIN", "FRONT_DESK", "CLINICIAN", "BILLER", "CREDENTIALING", "INTAKE", "VERIFICATION", "SCHEDULER", "CDS", "CODER"];

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ perms?: string }> }) {
  const me = await requireUser(rolesFor("settings.admin"));
  const sp = await searchParams;
  const memberships = await prisma.membership.findMany({
    where: { practiceId: me.practiceId },
    include: { user: true },
    orderBy: { user: { name: "asc" } },
  });
  // The member whose permissions are being edited (never the signed-in admin's own).
  const editing = memberships.find((m) => m.id === sp.perms && m.userId !== me.id) ?? null;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link>
          </p>
          <h1>Users &amp; roles</h1>
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
                <th>Permissions</th>
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
                      <span className={m.permissions ? undefined : "muted"}>{overrideSummary(m.permissions)}</span>
                      {u.id !== me.id && (
                        <div>
                          <Link href={`/settings/users?perms=${m.id}#permissions-editor`}>{sp.perms === m.id ? "Editing below" : "Edit"}</Link>
                        </div>
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

      {editing && (
        <section className="panel" id="permissions-editor">
          <h2>
            Permissions for {editing.user.name} <span className="muted">· {roleLabel[editing.role] ?? editing.role}</span>
          </h2>
          <PermissionEditor membershipId={editing.id} role={editing.role} json={editing.permissions} />
        </section>
      )}

      <section className="panel" id="permissions">
        <h2>What each role can do</h2>
        <p className="muted">
          The permission map every screen and the side menu check. These are the defaults for each role; the Permissions column above
          changes them for one person in this practice without changing their role.
        </p>
        <div className="table-scroll">
          <table className="cn-table pm-table">
            <thead>
              <tr>
                <th>Permission</th>
                {ALL_ROLES.map((r) => (
                  <th key={r} title={roleLabel[r] ?? r}>
                    {(roleLabel[r] ?? r).replace("Gateway · ", "").replace("CDS · Documentation review", "CDS")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_GROUPS.map((g) => (
                <Fragment key={g}>
                  <tr className="pm-group">
                    <td colSpan={ALL_ROLES.length + 1}>{g}</td>
                  </tr>
                  {Object.entries(PERMISSIONS)
                    .filter(([, p]) => p.group === g)
                    .map(([k, p]) => (
                      <tr key={k}>
                        <td>
                          {p.label}
                          {"about" in p && p.about && <div className="muted cn-small">{p.about}</div>}
                        </td>
                        {ALL_ROLES.map((r) => (
                          <td key={r} className="pm-cell">
                            {can(r, k as keyof typeof PERMISSIONS) ? "●" : ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// "By role" until the admin allows or denies a single permission for this person in this practice.
function overrideSummary(json: string | null) {
  const overrides = parseOverrides(json) ?? {};
  const keys = Object.keys(overrides) as PermissionKey[];
  if (keys.length === 0) return "By role";
  const allows = keys.filter((k) => overrides[k] === true).length;
  const denies = keys.length - allows;
  return [allows ? `+${allows} allowed` : "", denies ? `−${denies} denied` : ""].filter(Boolean).join(" · ");
}

// Every permission with the role's default marked, and a Default / Allow / Deny choice per row. Only the rows
// that differ from the role are stored.
function PermissionEditor({ membershipId, role, json }: { membershipId: string; role: string; json: string | null }) {
  const overrides = parseOverrides(json) ?? {};
  const changed = Object.keys(overrides).length;
  return (
    <form className="stack pm-overrides" action={savePermissionOverrides.bind(null, membershipId)}>
      <p className="muted">
        Default follows the {roleLabel[role] ?? role} role (● = allowed by role, — = not). Allow or deny changes only this person, only in this practice.
      </p>
      <div className="pm-columns">
        {PERMISSION_GROUPS.map((g) => (
          <table key={g} className="cn-table pm-table pm-edit">
            <thead>
              <tr>
                <th>{g}</th>
                <th>Default</th>
                <th>Allow</th>
                <th>Deny</th>
              </tr>
            </thead>
            <tbody>
              {(Object.entries(PERMISSIONS) as [PermissionKey, { label: string; group: string }][])
                .filter(([, p]) => p.group === g)
                .map(([k, p]) => {
                  const byRole = can(role, k);
                  const value = overrides[k] === undefined ? "default" : overrides[k] ? "allow" : "deny";
                  return (
                    <tr key={k} className={value !== "default" ? "pm-changed" : undefined}>
                      <td>{p.label}</td>
                      <td className="pm-cell">
                        <label title={byRole ? "Allowed by role" : "Not allowed by role"}>
                          <input type="radio" name={`perm:${k}`} value="default" defaultChecked={value === "default"} /> {byRole ? "●" : "—"}
                        </label>
                      </td>
                      <td className="pm-cell">
                        <input type="radio" name={`perm:${k}`} value="allow" defaultChecked={value === "allow"} aria-label="Allow" />
                      </td>
                      <td className="pm-cell">
                        <input type="radio" name={`perm:${k}`} value="deny" defaultChecked={value === "deny"} aria-label="Deny" />
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        ))}
      </div>
      <div className="pm-actions">
        <button className="btn" type="submit">
          Save permissions
        </button>
        {changed > 0 && (
          <button className="btn ghost" type="submit" name="intent" value="reset">
            Back to role defaults
          </button>
        )}
        <Link className="btn ghost" href="/settings/users">
          Close
        </Link>
      </div>
    </form>
  );
}
