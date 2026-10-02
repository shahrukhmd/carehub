import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { formatDate, formatTime } from "@/lib/format";
import { PATIENT_EDIT_ROLES } from "@/lib/gateway";
import {
  amendmentDenialLabel,
  amendmentStatusLabel,
  consentLabel,
  consentMethodLabel,
  disclosureMethodLabel,
  disclosurePurposeLabel,
  emergencyReasonLabel,
} from "@/lib/privacy";
import { PatientShell, loadPatientShell } from "../patient-shell";
import { addAmendment, addDisclosure, decideAmendment, deleteDisclosure, recordDisagreement, saveConsent, setRestricted } from "./actions";

const VIEW_ROLES = [...new Set([...PATIENT_EDIT_ROLES, "CLINICIAN", "BILLER"])];
const DECIDE_ROLES = ["ADMIN", "CLINICIAN"];
const TONE: Record<string, string> = { PENDING: "warn", ACCEPTED: "ok", DENIED: "bad" };
type Search = { error?: string; ok?: string };

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// One patient's privacy record: consent to texts and calls, who their information was released to, their
// requests to amend the record, and whether the chart is restricted to the care team.
export default async function PatientPrivacyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const user = await requireUser(VIEW_ROLES);
  const { id } = await params;
  const sp = await searchParams;
  const shell = await loadPatientShell(id, user);
  const p = shell.patient;
  const canDecide = DECIDE_ROLES.includes(user.role);

  const [disclosures, amendments, accesses] = await Promise.all([
    prisma.disclosure.findMany({ where: { patientId: id, practiceId: user.practiceId }, orderBy: { disclosedAt: "desc" } }),
    prisma.amendmentRequest.findMany({ where: { patientId: id, practiceId: user.practiceId }, orderBy: { requestedAt: "desc" } }),
    prisma.emergencyAccess.findMany({ where: { patientId: id, practiceId: user.practiceId }, orderBy: { grantedAt: "desc" }, take: 20 }),
  ]);
  const staffIds = [...new Set([...disclosures.map((d) => d.createdById), ...amendments.map((a) => a.decidedById), ...accesses.map((a) => a.userId), p.consentRecordedById].filter((v): v is string => Boolean(v)))];
  const staff = new Map((await prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const now = Date.now();

  return (
    <PatientShell data={shell}>
      <p className="pd-back">
        <Link href={`/patients/${id}`}>« Back to dashboard</Link>
      </p>
      <div className="pd-head">
        <h1>Privacy, disclosures &amp; consent</h1>
        <Link className="btn secondary" href={`/patients/${id}/privacy/accounting`}>
          Accounting of disclosures (print)
        </Link>
      </div>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}

      <div className="pv-two">
        {/* ---------------- Consent to texts and calls ---------------- */}
        <section className="panel">
          <div className="gw-section-head">
            <h2>Text &amp; call consent</h2>
            <span className="muted">
              {p.consentRecordedAt ? `Recorded ${formatDate(p.consentRecordedAt)}${p.consentRecordedById ? ` by ${staff.get(p.consentRecordedById) ?? "staff"}` : ""}` : "Not asked yet"}
            </span>
          </div>
          <form action={saveConsent.bind(null, id)} className="form-grid">
            <label>
              Automated text messages (reminders, recalls, surveys)
              <select name="textConsent" defaultValue={p.textConsent ?? ""}>
                <option value="">Not asked yet</option>
                {Object.entries(consentLabel).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Automated or prerecorded calls
              <select name="voiceConsent" defaultValue={p.voiceConsent ?? ""}>
                <option value="">Not asked yet</option>
                {Object.entries(consentLabel).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              How consent was given
              <select name="consentMethod" defaultValue={p.consentMethod ?? ""}>
                <option value="">—</option>
                {Object.entries(consentMethodLabel).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <div className="pv-actions">
              <button className="btn" type="submit">
                Save consent
              </button>
              <span className="muted">Reminder, recall and survey texts are held back until text consent is recorded.</span>
            </div>
          </form>
        </section>

        {/* ---------------- Restricted chart ---------------- */}
        <section className="panel">
          <div className="gw-section-head">
            <h2>Restricted chart</h2>
            <span className={`gw-tag gw-tag-${p.restricted ? "bad" : "muted"}`}>{p.restricted ? "Restricted" : "Not restricted"}</span>
          </div>
          <p className="muted">
            A restricted chart opens only for administrators, the patient&apos;s providers and care team. Anyone else must give a reason first (&ldquo;break the glass&rdquo;), and that access is
            reviewed.
          </p>
          {canDecide ? (
            <form action={setRestricted.bind(null, id)} className="form-grid">
              <label className="cm-check">
                <input type="checkbox" name="restricted" defaultChecked={p.restricted} />
                Restrict this chart to the care team
              </label>
              <label>
                Reason
                <input name="restrictedReason" defaultValue={p.restrictedReason ?? ""} placeholder="e.g. employee, public figure, patient request" maxLength={300} />
              </label>
              <div className="pv-actions">
                <button className="btn" type="submit">
                  Save
                </button>
              </div>
            </form>
          ) : (
            p.restricted && <p>Reason: {p.restrictedReason}</p>
          )}
          {accesses.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Emergency access</th>
                  <th>By</th>
                  <th>Reason</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {accesses.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {formatDate(a.grantedAt)} {formatTime(a.grantedAt)}
                      {a.expiresAt.getTime() > now && <span className="gw-tag gw-tag-warn">Active</span>}
                    </td>
                    <td>{staff.get(a.userId) ?? "—"}</td>
                    <td>
                      {emergencyReasonLabel[a.reason] ?? a.reason}
                      {a.note ? <span className="muted"> · {a.note}</span> : null}
                    </td>
                    <td>{a.reviewedAt ? `Reviewed ${formatDate(a.reviewedAt)}` : <span className="gw-tag gw-tag-warn">Awaiting review</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/* ---------------- Disclosures ---------------- */}
      <section className="panel">
        <div className="gw-section-head">
          <h2>Disclosures of health information</h2>
          <span className="muted">Releases outside treatment, payment and operations — kept for six years</span>
        </div>
        <details className="pv-add">
          <summary className="btn secondary gw-mini">+ Record a disclosure</summary>
          <form action={addDisclosure.bind(null, id)} className="form-grid gw-grid-3">
            <label>
              Date disclosed
              <input type="date" name="disclosedAt" defaultValue={today()} max={today()} required />
            </label>
            <label>
              Released to
              <input name="recipient" required maxLength={160} placeholder="Person or organization" />
            </label>
            <label>
              Recipient address / fax
              <input name="recipientAddress" maxLength={240} />
            </label>
            <label>
              Purpose
              <select name="purpose" required defaultValue="">
                <option value="" disabled>
                  Select…
                </option>
                {Object.entries(disclosurePurposeLabel).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              How it was sent
              <select name="method" defaultValue="">
                <option value="">—</option>
                {Object.entries(disclosureMethodLabel).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              What was disclosed
              <input name="description" required maxLength={600} placeholder="e.g. Visit notes Jan–Jun 2026, wound photos" />
            </label>
            <label className="pv-wide">
              Notes
              <input name="notes" maxLength={600} />
            </label>
            <div className="pv-actions">
              <button className="btn" type="submit">
                Record disclosure
              </button>
            </div>
          </form>
        </details>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Released to</th>
              <th>Purpose</th>
              <th>What was disclosed</th>
              <th>How</th>
              <th>Recorded by</th>
              {user.role === "ADMIN" && <th />}
            </tr>
          </thead>
          <tbody>
            {disclosures.map((d) => (
              <tr key={d.id}>
                <td>{formatDate(d.disclosedAt)}</td>
                <td>
                  {d.recipient}
                  {d.recipientAddress ? <div className="muted">{d.recipientAddress}</div> : null}
                </td>
                <td>{disclosurePurposeLabel[d.purpose] ?? d.purpose}</td>
                <td>
                  {d.description}
                  {d.notes ? <div className="muted">{d.notes}</div> : null}
                </td>
                <td>{d.method ? disclosureMethodLabel[d.method] : "—"}</td>
                <td>{d.createdById ? (staff.get(d.createdById) ?? "—") : "—"}</td>
                {user.role === "ADMIN" && (
                  <td className="num">
                    <form action={deleteDisclosure.bind(null, id, d.id)}>
                      <button className="btn ghost gw-mini" type="submit" title="Remove an entry made by mistake (the removal is kept in the audit log)">
                        Remove
                      </button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
            {disclosures.length === 0 && (
              <tr>
                <td colSpan={user.role === "ADMIN" ? 7 : 6} className="muted">
                  No disclosures recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* ---------------- Amendment requests ---------------- */}
      <section className="panel">
        <div className="gw-section-head">
          <h2>Requests to amend the record</h2>
          <span className="muted">The practice must answer within 60 days</span>
        </div>
        <details className="pv-add">
          <summary className="btn secondary gw-mini">+ Record a request</summary>
          <form action={addAmendment.bind(null, id)} className="form-grid gw-grid-3">
            <label>
              Date received
              <input type="date" name="requestedAt" defaultValue={today()} max={today()} required />
            </label>
            <label>
              Requested by
              <input name="requestedBy" defaultValue="Patient" maxLength={120} />
            </label>
            <label>
              Part of the record
              <input name="section" required maxLength={160} placeholder="e.g. Problem list, visit note 03/02/2026" />
            </label>
            <label className="pv-wide">
              What the patient wants changed
              <textarea name="requestText" rows={2} required maxLength={2000} />
            </label>
            <label className="pv-wide">
              Patient&apos;s reason
              <input name="reason" maxLength={1000} />
            </label>
            <div className="pv-actions">
              <button className="btn" type="submit">
                Record request
              </button>
            </div>
          </form>
        </details>
        {amendments.map((a) => {
          const daysLeft = Math.ceil((a.dueAt.getTime() - now) / 86_400_000);
          return (
            <article key={a.id} className="pv-request">
              <header>
                <strong>{a.section}</strong>
                <span className={`gw-tag gw-tag-${TONE[a.status] ?? "muted"}`}>{amendmentStatusLabel[a.status] ?? a.status}</span>
                {a.status === "PENDING" && (
                  <span className={`gw-tag gw-tag-${daysLeft < 0 ? "bad" : daysLeft <= 14 ? "warn" : "muted"}`}>
                    {daysLeft < 0 ? `Overdue by ${-daysLeft} days` : `Decision due ${formatDate(a.dueAt)} (${daysLeft} days)`}
                  </span>
                )}
                <span className="muted">
                  Received {formatDate(a.requestedAt)} from {a.requestedBy}
                </span>
              </header>
              <p>{a.requestText}</p>
              {a.reason && <p className="muted">Reason given: {a.reason}</p>}
              {a.status !== "PENDING" && (
                <p>
                  <strong>{a.status === "ACCEPTED" ? "Accepted" : "Denied"}</strong> {a.decidedAt ? formatDate(a.decidedAt) : ""}
                  {a.decidedById ? ` by ${staff.get(a.decidedById) ?? "staff"}` : ""}
                  {a.denialReason ? ` — ${amendmentDenialLabel[a.denialReason] ?? a.denialReason}` : ""}
                  {a.decisionNote ? `. ${a.decisionNote}` : ""}
                  {a.patientNotifiedAt ? ` Patient notified ${formatDate(a.patientNotifiedAt)}.` : " Patient not yet notified."}
                </p>
              )}
              {a.disagreement && <p className="pv-quote">Patient&apos;s statement of disagreement: {a.disagreement}</p>}
              {a.status === "PENDING" && canDecide && (
                <form action={decideAmendment.bind(null, id, a.id)} className="form-grid gw-grid-3">
                  <label>
                    Decision
                    <select name="decision" required defaultValue="">
                      <option value="" disabled>
                        Select…
                      </option>
                      <option value="ACCEPTED">Accept — the record was amended</option>
                      <option value="DENIED">Deny</option>
                    </select>
                  </label>
                  <label>
                    Reason, if denied
                    <select name="denialReason" defaultValue="">
                      <option value="">—</option>
                      {Object.entries(amendmentDenialLabel).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Patient notified on
                    <input type="date" name="patientNotifiedAt" max={today()} />
                  </label>
                  <label className="pv-wide">
                    Note (what was changed and who else was informed, or the explanation given)
                    <input name="decisionNote" maxLength={1000} />
                  </label>
                  <div className="pv-actions">
                    <button className="btn" type="submit">
                      Save decision
                    </button>
                  </div>
                </form>
              )}
              {a.status === "DENIED" && !a.disagreement && (
                <details className="pv-add">
                  <summary className="btn ghost gw-mini">File the patient&apos;s statement of disagreement</summary>
                  <form action={recordDisagreement.bind(null, id, a.id)} className="form-grid">
                    <label className="pv-wide">
                      Statement
                      <textarea name="disagreement" rows={2} required maxLength={2000} />
                    </label>
                    <div className="pv-actions">
                      <button className="btn" type="submit">
                        File statement
                      </button>
                    </div>
                  </form>
                </details>
              )}
            </article>
          );
        })}
        {amendments.length === 0 && <p className="muted">No amendment requests.</p>}
      </section>
    </PatientShell>
  );
}
