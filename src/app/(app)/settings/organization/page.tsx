import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { rolesFor } from "@/lib/permissions";
import { ONBOARDING_STEPS, ORG_STATUSES, organizationForPractice, parseOnboarding } from "@/lib/organization";
import { StatusBadge } from "@/components/StatusBadge";
import { SettingsNav } from "../settings-nav";
import { addPractice, createOrganization, saveLoginPolicy, saveOnboarding, saveOrganization } from "./actions";

// The client organization: account, status and terms, onboarding, its practices, and the sign-in policy.
export default async function OrganizationPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const user = await requireUser(rolesFor("settings.admin"));
  const sp = await searchParams;
  const org = await organizationForPractice(user.practiceId);
  const practices = org
    ? await prisma.practice.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" }, include: { _count: { select: { users: true, memberships: true, locations: true } } } })
    : [];
  const done = parseOnboarding(org?.onboarding);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link>
          </p>
          <h1>Organization</h1>
        </div>
        {org && <StatusBadge value={org.status} label={ORG_STATUSES[org.status] ?? org.status} />}
      </div>
      <SettingsNav current="organization" />
      {sp.saved && <p className="notice-ok">Saved.</p>}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {!org ? (
        <form className="panel stack" action={createOrganization}>
          <p className="muted">This practice is not under a client organization yet. Create one for it (named after the practice; rename it afterwards).</p>
          <button className="btn" type="submit">
            Create the client organization
          </button>
        </form>
      ) : (
        <div className="two-col">
          <div className="stack">
            <form className="panel stack" action={saveOrganization}>
              <h2>Account</h2>
              <div className="form-grid gw-grid-3">
                <label>
                  Client name
                  <input name="name" defaultValue={org.name} required />
                </label>
                <label>
                  Legal name
                  <input name="legalName" defaultValue={org.legalName ?? ""} />
                </label>
                <label>
                  Tax ID
                  <input name="taxId" defaultValue={org.taxId ?? ""} />
                </label>
                <label>
                  Contact
                  <input name="contactName" defaultValue={org.contactName ?? ""} />
                </label>
                <label>
                  Contact email
                  <input name="contactEmail" type="email" defaultValue={org.contactEmail ?? ""} />
                </label>
                <label>
                  Contact phone
                  <input name="contactPhone" defaultValue={org.contactPhone ?? ""} />
                </label>
                <label>
                  Account manager
                  <input name="accountManager" defaultValue={org.accountManager ?? ""} placeholder="Who at the billing company owns this client" />
                </label>
                <label>
                  Status
                  <select name="status" defaultValue={org.status}>
                    {Object.entries(ORG_STATUSES).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Status reason (hold or termination)
                  <input name="statusReason" defaultValue={org.statusReason ?? ""} />
                </label>
                <label>
                  Terminated on
                  <input name="terminatedAt" type="date" defaultValue={org.terminatedAt ? org.terminatedAt.toISOString().slice(0, 10) : ""} />
                </label>
              </div>
              <p className="muted cn-small">
                On hold stops claim release and statements for every practice and shows a banner. Terminated refuses sign-in from the date and keeps the data read-only.
              </p>
              <h3>Commercial terms</h3>
              <div className="form-grid gw-grid-3">
                <label>
                  Fee (% of collections)
                  <input name="feePercent" inputMode="decimal" defaultValue={org.feePercent ?? ""} />
                </label>
                <label>
                  Minimum monthly fee ($)
                  <input name="minimumMonthly" inputMode="decimal" defaultValue={org.minimumMonthlyCents === null ? "" : (org.minimumMonthlyCents / 100).toFixed(2)} />
                </label>
                <label>
                  Invoice day of month
                  <input name="invoiceDay" type="number" min={1} max={28} defaultValue={org.invoiceDay} />
                </label>
              </div>
              <label>
                Notes
                <textarea name="notes" rows={3} defaultValue={org.notes ?? ""} />
              </label>
              <button className="btn" type="submit">
                Save account
              </button>
            </form>

            <form className="panel stack" action={saveOnboarding}>
              <h2>Onboarding checklist</h2>
              <p className="muted">
                {done.size} of {ONBOARDING_STEPS.length} done. The account becomes Active by itself when every step is ticked.
              </p>
              <div className="st-checks">
                {ONBOARDING_STEPS.map(([k, label]) => (
                  <label key={k} className="checkbox-inline">
                    <input type="checkbox" name={`step:${k}`} defaultChecked={done.has(k)} /> {label}
                  </label>
                ))}
              </div>
              <button className="btn secondary" type="submit">
                Save checklist
              </button>
            </form>

            <form className="panel stack" action={saveLoginPolicy}>
              <h2>Sign-in policy</h2>
              <p className="muted">Applies to every user in this organization&apos;s practices.</p>
              <div className="form-grid gw-grid-3">
                <label>
                  Lock after failed attempts
                  <input name="maxFailedLogins" type="number" min={3} max={20} defaultValue={org.maxFailedLogins} />
                </label>
                <label>
                  Lockout (minutes)
                  <input name="lockoutMinutes" type="number" min={1} max={1440} defaultValue={org.lockoutMinutes} />
                </label>
                <label>
                  Password expires after (days, 0 = never)
                  <input name="passwordMaxAgeDays" type="number" min={0} max={365} defaultValue={org.passwordMaxAgeDays} />
                </label>
                <label>
                  Idle timeout (minutes, 0 = none)
                  <input name="idleTimeoutMinutes" type="number" min={0} max={720} defaultValue={org.idleTimeoutMinutes} />
                </label>
              </div>
              <label className="checkbox-inline">
                <input type="checkbox" name="twoFactorRequired" defaultChecked={org.twoFactorRequired} /> Require a sign-in code by email for everyone
                <span className="muted"> — users can also turn it on for themselves under Users &amp; roles</span>
              </label>
              <label>
                Office IP allow-list (addresses or CIDR blocks, one per line or comma-separated; empty = no restriction)
                <textarea name="ipAllowlist" rows={2} defaultValue={org.ipAllowlist ?? ""} placeholder="203.0.113.10, 198.51.100.0/24" />
              </label>
              <label>
                Emails exempt from the allow-list (remote staff)
                <textarea name="ipAllowlistExempt" rows={2} defaultValue={org.ipAllowlistExempt ?? ""} />
              </label>
              <button className="btn secondary" type="submit">
                Save policy
              </button>
            </form>
          </div>

          <div className="stack">
            <section className="panel">
              <h2>Practices</h2>
              <table>
                <thead>
                  <tr>
                    <th>Practice</th>
                    <th>Sites</th>
                    <th>Staff</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {practices.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.name}
                        {p.id === user.practiceId && <span className="muted"> · current</span>}
                        <div className="muted cn-small">{p.state ?? ""}</div>
                      </td>
                      <td>{p._count.locations}</td>
                      <td>{p._count.memberships}</td>
                      <td>{user.memberships.some((m) => m.practiceId === p.id) ? <span className="muted cn-small">you have access</span> : <span className="muted cn-small">no access</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <form className="panel stack" action={addPractice}>
              <h2>Add a practice</h2>
              <p className="muted">A new billing entity under this client. You get administrator access to it; switch to it from the top bar to set it up.</p>
              <label>
                Practice name
                <input name="name" required />
              </label>
              <div className="form-grid gw-grid-3">
                <label>
                  State
                  <input name="state" maxLength={2} placeholder="TX" />
                </label>
                <label>
                  First site name
                  <input name="locationName" placeholder="Main office" />
                </label>
                <label>
                  City
                  <input name="city" />
                </label>
              </div>
              <button className="btn secondary" type="submit">
                Add practice
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
