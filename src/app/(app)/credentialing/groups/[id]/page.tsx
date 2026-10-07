import { rolesFor } from "@/lib/permissions";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { credentialingPracticeIds } from "@/lib/scope";
import { StatusBadge } from "@/components/StatusBadge";
import { connectionStatusLabel, credentialingStatusLabel, formatDate, groupDocumentTypeLabel, planSegmentLabel } from "@/lib/format";
import { daysBetween } from "@/lib/credentialing";
import { saveGroupNumbers, uploadGroupDocument } from "../../actions";

// The group's own credentialing file: its documents and the number each payer assigned to the group.
export default async function GroupFilePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(rolesFor("credentialing.work"));
  const { id } = await params;
  const group = await prisma.billingProvider.findFirst({
    where: { id, practiceId: { in: credentialingPracticeIds(user) } },
    include: {
      practice: true,
      documents: { orderBy: { createdAt: "desc" } },
      payerEnrollments: { include: { payer: true, providerEnrollments: { select: { status: true } } }, orderBy: [{ payer: { name: "asc" } }, { planSegment: "asc" }] },
    },
  });
  if (!group) notFound();

  const uploaders = new Map(
    (await prisma.user.findMany({ where: { id: { in: group.documents.map((d) => d.uploadedById).filter((v): v is string => Boolean(v)) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])
  );
  const now = new Date();
  const current = group.documents.filter((d) => !d.supersededAt);
  const history = group.documents.filter((d) => d.supersededAt);
  const missing = ["W9", "IRS_LETTER", "LIABILITY_COI"].filter((t) => !current.some((d) => d.type === t));

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Group credentialing file</p>
          <h1>{group.name}</h1>
          <p className="chart-meta">
            <span>Group NPI {group.npi ?? "—"}</span>
            <span>Tax ID {group.taxId ?? "—"}</span>
            {group.practice.name !== group.name && <span>{group.practice.name}</span>}
            <StatusBadge value={group.active ? "ACTIVE" : "INACTIVE"} />
          </p>
        </div>
        <div className="stack" style={{ gridAutoFlow: "column", gap: "0.5rem" }}>
          <Link className="btn secondary" href={`/credentialing?tab=grid&group=${group.id}`}>
            Enrollment status
          </Link>
          <Link className="btn secondary" href="/credentialing?tab=board&view=setup">
            Payer lines setup
          </Link>
        </div>
      </div>

      <div className="two-col">
        <section className="panel">
          <h2>Group documents</h2>
          {missing.length > 0 && <p className="login-error">Missing: {missing.map((t) => groupDocumentTypeLabel[t]).join(", ")}</p>}
          <div className="panel-section">
            <h3>Current documents</h3>
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>File</th>
                  <th>Issued</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {current.map((d) => {
                  const days = d.expiryDate ? daysBetween(now, d.expiryDate) : null;
                  return (
                    <tr key={d.id}>
                      <td>{groupDocumentTypeLabel[d.type] ?? d.type}</td>
                      <td>
                        <a href={`/api/files/groupdoc/${d.id}`} target="_blank" rel="noreferrer">
                          {d.fileName}
                        </a>
                        <div className="muted">
                          Uploaded {formatDate(d.createdAt)} by {d.uploadedById ? (uploaders.get(d.uploadedById) ?? "—") : "—"}
                        </div>
                      </td>
                      <td>{d.issueDate ? formatDate(d.issueDate) : "—"}</td>
                      <td>
                        {d.expiryDate ? formatDate(d.expiryDate) : "—"}
                        {days !== null && days < 0 && <div className="badge badge-denied">Expired</div>}
                        {days !== null && days >= 0 && days <= 90 && <div className="muted">in {days} days</div>}
                      </td>
                    </tr>
                  );
                })}
                {current.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No documents on file for this group.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="panel-section">
            <h3>Upload a document</h3>
            <form className="form-grid" action={uploadGroupDocument.bind(null, group.id)}>
              <label>
                Document type
                <select name="type" required defaultValue="">
                  <option value="" disabled>
                    Choose type
                  </option>
                  {Object.entries(groupDocumentTypeLabel).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                File (PDF, image, Word — 10 MB max)
                <input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" required />
              </label>
              <label>
                Issue date
                <input name="issueDate" type="date" />
              </label>
              <label>
                Expiry date
                <input name="expiryDate" type="date" />
              </label>
              <p className="muted" style={{ gridColumn: "1 / -1" }}>
                Uploading a renewed document replaces the current one; the prior version stays in history.
              </p>
              <button className="btn secondary" type="submit" style={{ gridColumn: "1 / -1" }}>
                Upload
              </button>
            </form>
          </div>
          {history.length > 0 && (
            <div className="panel-section">
              <h3>Version history</h3>
              <ul>
                {history.map((d) => (
                  <li key={d.id}>
                    {groupDocumentTypeLabel[d.type] ?? d.type} —{" "}
                    <a href={`/api/files/groupdoc/${d.id}`} target="_blank" rel="noreferrer">
                      {d.fileName}
                    </a>{" "}
                    <span className="muted">(replaced {formatDate(d.supersededAt!)})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Insurances &amp; group numbers</h2>
          <p className="muted">The number each payer assigned to the group. Change a status from Enrollment status.</p>
          <form action={saveGroupNumbers.bind(null, group.id)}>
            <table>
              <thead>
                <tr>
                  <th>Insurance</th>
                  <th>Payer ID</th>
                  <th>Group status</th>
                  <th>EDI · EFT</th>
                  <th>Group number</th>
                  <th>Effective</th>
                </tr>
              </thead>
              <tbody>
                {group.payerEnrollments.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.payer.name}
                      <div className="muted">{planSegmentLabel[l.planSegment] ?? l.planSegment}</div>
                    </td>
                    <td>{l.payer.payerCode ?? "—"}</td>
                    <td>{credentialingStatusLabel[l.groupStatus] ?? l.groupStatus}</td>
                    <td>
                      {connectionStatusLabel[l.ediStatus] ?? l.ediStatus} · {connectionStatusLabel[l.eftStatus] ?? l.eftStatus}
                    </td>
                    <td>
                      <input name={`num_${l.id}`} defaultValue={l.payerGroupId ?? ""} maxLength={60} placeholder="Not captured" aria-label={`${l.payer.name} group number`} />
                    </td>
                    <td>{l.effectiveDate ? formatDate(l.effectiveDate) : "—"}</td>
                  </tr>
                ))}
                {group.payerEnrollments.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No payer lines yet — add them under Credentialing → Work queue → Payer lines setup.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {group.payerEnrollments.length > 0 && (
              <button className="btn secondary" type="submit" style={{ marginTop: "0.6rem" }}>
                Save group numbers
              </button>
            )}
          </form>
        </section>
      </div>
    </>
  );
}
