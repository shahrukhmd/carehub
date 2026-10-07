import { rolesFor } from "@/lib/permissions";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getConnectSettings } from "@/lib/connect/core";
import { formatDate, formatTime, patientName, roleLabel } from "@/lib/format";
import { disclosurePurposeLabel, emergencyReasonLabel } from "@/lib/privacy";
import { SettingsNav } from "../settings-nav";
import { reviewEmergencyAccess, saveConsentRule } from "./actions";

type Search = { error?: string; ok?: string };

// The privacy officer's view across the practice: what is waiting for a decision or a review.
export default async function PrivacySettingsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(rolesFor("settings.admin"));
  const sp = await searchParams;
  const practiceId = user.practiceId;
  const patient = { select: { id: true, firstName: true, lastName: true, mrn: true } };

  const [settings, amendments, accesses, disclosures, restricted, consent] = await Promise.all([
    getConnectSettings(practiceId),
    prisma.amendmentRequest.findMany({ where: { practiceId, status: "PENDING" }, include: { patient }, orderBy: { dueAt: "asc" } }),
    prisma.emergencyAccess.findMany({ where: { practiceId }, include: { patient }, orderBy: { grantedAt: "desc" }, take: 100 }),
    prisma.disclosure.findMany({ where: { practiceId }, include: { patient }, orderBy: { disclosedAt: "desc" }, take: 25 }),
    prisma.patient.findMany({ where: { practiceId, restricted: true }, select: { id: true, firstName: true, lastName: true, mrn: true, restrictedReason: true }, orderBy: { lastName: "asc" } }),
    prisma.patient.groupBy({ by: ["textConsent"], where: { practiceId, status: { not: "INACTIVE" } }, _count: { _all: true } }),
  ]);
  const staff = new Map(
    (await prisma.user.findMany({ where: { id: { in: [...new Set(accesses.flatMap((a) => [a.userId, a.reviewedById]).filter((v): v is string => Boolean(v)))] } }, select: { id: true, name: true, role: true } })).map((u) => [
      u.id,
      u,
    ])
  );
  const now = Date.now();
  const waiting = accesses.filter((a) => !a.reviewedAt);
  const count = (v: string | null) => consent.find((c) => c.textConsent === v)?._count._all ?? 0;

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link>
          </p>
          <h1>Privacy &amp; compliance</h1>
        </div>
      </div>
      <SettingsNav current="privacy" role={user.role} />
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}

      <section className="grid-stats cd-tiles cm-tiles">
        <div className="stat">
          <span>Amendment requests waiting</span>
          <strong className={amendments.some((a) => a.dueAt.getTime() < now) ? "cd-bad" : amendments.length ? "cd-warn" : undefined}>{amendments.length}</strong>
        </div>
        <div className="stat">
          <span>Emergency access to review</span>
          <strong className={waiting.length ? "cd-warn" : undefined}>{waiting.length}</strong>
        </div>
        <div className="stat">
          <span>Restricted charts</span>
          <strong>{restricted.length}</strong>
        </div>
        <div className="stat">
          <span>Text consent: yes · declined · not asked</span>
          <strong>
            {count("YES")} · {count("NO")} · {count(null)}
          </strong>
        </div>
      </section>

      <section className="panel">
        <div className="gw-section-head">
          <h2>Emergency access (&ldquo;break the glass&rdquo;)</h2>
          <span className="muted">Every time someone outside the care team opened a restricted chart</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Staff member</th>
              <th>Patient</th>
              <th>Reason given</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {accesses.map((a) => {
              const who = staff.get(a.userId);
              return (
                <tr key={a.id}>
                  <td>
                    {formatDate(a.grantedAt)} {formatTime(a.grantedAt)}
                    {a.expiresAt.getTime() > now && <span className="gw-tag gw-tag-warn">Active</span>}
                  </td>
                  <td>
                    {who?.name ?? "—"}
                    {who ? <span className="muted"> · {roleLabel[who.role] ?? who.role}</span> : null}
                  </td>
                  <td>
                    <Link href={`/patients/${a.patient.id}/privacy`}>{patientName(a.patient)}</Link> <span className="muted">{a.patient.mrn}</span>
                  </td>
                  <td>
                    {emergencyReasonLabel[a.reason] ?? a.reason}
                    {a.note ? <div className="muted">{a.note}</div> : null}
                  </td>
                  <td>
                    {a.reviewedAt ? (
                      <>
                        Reviewed {formatDate(a.reviewedAt)} by {staff.get(a.reviewedById ?? "")?.name ?? "—"}
                        {a.reviewNote ? <div className="muted">{a.reviewNote}</div> : null}
                      </>
                    ) : (
                      <form action={reviewEmergencyAccess.bind(null, a.id)} className="pv-inline">
                        <input name="reviewNote" placeholder="Review note (optional)" maxLength={500} aria-label="Review note" />
                        <button className="btn secondary gw-mini" type="submit">
                          Mark reviewed
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
            {accesses.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No one has used emergency access.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="pv-two">
        <section className="panel">
          <div className="gw-section-head">
            <h2>Amendment requests waiting for a decision</h2>
          </div>
          <table>
            <thead>
              <tr>
                <th>Patient</th>
                <th>Part of the record</th>
                <th>Received</th>
                <th>Decision due</th>
              </tr>
            </thead>
            <tbody>
              {amendments.map((a) => {
                const days = Math.ceil((a.dueAt.getTime() - now) / 86_400_000);
                return (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/patients/${a.patient.id}/privacy`}>{patientName(a.patient)}</Link>
                    </td>
                    <td>{a.section}</td>
                    <td>{formatDate(a.requestedAt)}</td>
                    <td>
                      {formatDate(a.dueAt)} <span className={`gw-tag gw-tag-${days < 0 ? "bad" : days <= 14 ? "warn" : "muted"}`}>{days < 0 ? `${-days} days overdue` : `${days} days left`}</span>
                    </td>
                  </tr>
                );
              })}
              {amendments.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    Nothing waiting.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <div className="gw-section-head">
            <h2>Restricted charts</h2>
          </div>
          <table>
            <thead>
              <tr>
                <th>Patient</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {restricted.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/patients/${p.id}/privacy`}>{patientName(p)}</Link> <span className="muted">{p.mrn}</span>
                  </td>
                  <td>{p.restrictedReason ?? "—"}</td>
                </tr>
              ))}
              {restricted.length === 0 && (
                <tr>
                  <td colSpan={2} className="muted">
                    No chart is restricted. Restrict one from the patient&apos;s Privacy page.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>

      <section className="panel">
        <div className="gw-section-head">
          <h2>Recent disclosures</h2>
          <span className="muted">Latest 25 across the practice</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Patient</th>
              <th>Released to</th>
              <th>Purpose</th>
              <th>What was disclosed</th>
            </tr>
          </thead>
          <tbody>
            {disclosures.map((d) => (
              <tr key={d.id}>
                <td>{formatDate(d.disclosedAt)}</td>
                <td>
                  <Link href={`/patients/${d.patient.id}/privacy`}>{patientName(d.patient)}</Link>
                </td>
                <td>{d.recipient}</td>
                <td>{disclosurePurposeLabel[d.purpose] ?? d.purpose}</td>
                <td>{d.description}</td>
              </tr>
            ))}
            {disclosures.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No disclosures recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="gw-section-head">
          <h2>Text message consent rule</h2>
        </div>
        <form action={saveConsentRule} className="pv-inline">
          <label className="cm-check">
            <input type="checkbox" name="requireTextConsent" defaultChecked={settings.requireTextConsent} />
            Only send reminder, recall and survey texts to patients whose consent is recorded as &ldquo;Consented&rdquo;
          </label>
          <button className="btn" type="submit">
            Save
          </button>
        </form>
        <p className="muted">When unticked, texts go to everyone except patients who declined. Forms and payment links a staff member sends on request are not affected.</p>
      </section>
    </div>
  );
}
