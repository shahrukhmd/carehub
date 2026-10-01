import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, patientName } from "@/lib/format";
import { REFERRAL_ROLES, REFERRAL_STATUS } from "@/lib/referrals";
import { sendReferral, updateReferral } from "../actions";

export default async function ReferralPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await requireUser(REFERRAL_ROLES);
  const { id } = await params;
  const sp = await searchParams;
  const r = await prisma.outgoingReferral.findFirst({ where: { id, practiceId: user.practiceId }, include: { patient: true } });
  if (!r) notFound();
  const docs = await prisma.patientDocument.findMany({ where: { patientId: r.patientId, practiceId: user.practiceId }, orderBy: { createdAt: "desc" }, take: 40 });
  const [label, tone] = REFERRAL_STATUS[r.status] ?? [r.status, "info"];
  const open = !["CLOSED", "CANCELLED"].includes(r.status);
  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/referrals">Outgoing referrals</Link> · <Link href={`/patients/${r.patientId}`}>{patientName(r.patient)}</Link>
          </p>
          <h1>Referral to {r.toName}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {r.toSpecialty ?? ""} {r.urgency === "URGENT" ? "· urgent" : ""} · created {formatDate(r.createdAt)}
          </p>
        </div>
        <div className="cn-actions">
          <span className={`gw-tag gw-tag-${tone}`}>{label}</span>
          <a className="btn secondary" href={`/api/referrals/${r.id}/letter`} target="_blank" rel="noreferrer">
            Referral letter PDF
          </a>
        </div>
      </div>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}
      <div className="two-col">
        <section className="panel">
          <h2>Details</h2>
          <p>
            <strong>Reason:</strong> {r.reason}
          </p>
          <p className="cn-small">
            Diagnosis: {r.diagnosisCodes ?? "—"} · Auth #: {r.authNumber ?? "—"} · Fax: {r.toFax ?? "—"} · Phone: {r.toPhone ?? "—"}
          </p>
          {r.notes && <p className="cn-small">{r.notes}</p>}
          <ul className="pd-list">
            {r.sentAt && (
              <li>
                <span>Sent {formatDate(r.sentAt)}</span>
                <span className="muted">{r.sentVia?.toLowerCase()}</span>
                {r.letterDocumentId && <Link href={`/gateway/documents/${r.letterDocumentId}`}>Letter</Link>}
              </li>
            )}
            {r.appointmentAt && (
              <li>
                <span>Specialist appointment</span>
                <span>{formatDate(r.appointmentAt)}</span>
              </li>
            )}
            {r.consultDocumentId && (
              <li>
                <span>Consult note received {r.consultReceivedAt ? formatDate(r.consultReceivedAt) : ""}</span>
                <Link href={`/gateway/documents/${r.consultDocumentId}`}>Open</Link>
              </li>
            )}
            {r.closedReason && (
              <li>
                <span>Closed: {r.closedReason}</span>
              </li>
            )}
          </ul>
        </section>
        <div className="stack">
          {open && (
            <section className="panel">
              <h2>{r.sentAt ? "Send again" : "Send"}</h2>
              <form action={sendReferral.bind(null, r.id)} className="cn-inline">
                <select name="method" defaultValue="FAX" aria-label="Send by">
                  <option value="FAX">Fax</option>
                  <option value="PRINT">Print / give to patient</option>
                </select>
                <input name="fax" defaultValue={r.toFax ?? ""} placeholder="Fax number" aria-label="Fax" />
                <button className="btn" type="submit">
                  Send referral
                </button>
              </form>
            </section>
          )}
          {open && r.status !== "DRAFT" && (
            <section className="panel stack">
              <h2>Track</h2>
              <form action={updateReferral.bind(null, r.id)} className="cn-inline">
                <input type="hidden" name="step" value="scheduled" />
                <label className="checkbox-inline">
                  Appointment on <input type="date" name="appointmentAt" />
                </label>
                <button className="btn ghost gw-mini" type="submit">
                  Mark scheduled
                </button>
              </form>
              <form action={updateReferral.bind(null, r.id)} className="cn-inline">
                <input type="hidden" name="step" value="consult" />
                <select name="documentId" required defaultValue="" aria-label="Consult note">
                  <option value="">Consult note from documents…</option>
                  {docs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <button className="btn secondary gw-mini" type="submit">
                  Consult received
                </button>
              </form>
            </section>
          )}
          {open && (
            <section className="panel">
              <form action={updateReferral.bind(null, r.id)} className="cn-inline">
                <select name="step" defaultValue="close" aria-label="Close or cancel">
                  <option value="close">Close (completed)</option>
                  <option value="cancel">Cancel referral</option>
                </select>
                <input name="reason" placeholder="Reason / outcome" aria-label="Reason" />
                <button className="btn ghost gw-mini" type="submit">
                  Save
                </button>
              </form>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
