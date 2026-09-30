import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { credentialingPracticeIds } from "@/lib/scope";
import { StatusBadge } from "@/components/StatusBadge";
import {
  MONTHLY_SCREENING_SOURCES,
  formatDate,
  providerDocumentTypeLabel,
  verificationResultLabel,
  verificationSourceLabel,
} from "@/lib/format";
import { daysBetween } from "@/lib/credentialing";
import {
  reactivateProvider,
  recordVerificationCheck,
  runNppesCheck,
  termProvider,
  uploadProviderDocument,
} from "../../actions";

export default async function ProviderFilePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["ADMIN", "CREDENTIALING"]);
  const { id } = await params;

  const provider = await prisma.renderingProvider.findFirst({
    where: { id, practiceId: { in: credentialingPracticeIds(user) } },
    include: {
      supervisingProvider: true,
      supervisees: true,
      user: true,
      documents: { include: { uploadedBy: true }, orderBy: { createdAt: "desc" } },
      verificationChecks: { include: { checkedBy: true }, orderBy: { checkedAt: "desc" } },
      enrollments: {
        where: { status: { not: "NOT_APPLICABLE" } },
        include: { groupPayerEnrollment: { include: { payer: true, billingProvider: true } } },
        orderBy: { groupPayerEnrollment: { payer: { name: "asc" } } },
      },
    },
  });
  if (!provider) notFound();

  const now = new Date();
  const current = provider.documents.filter((d) => !d.supersededAt);
  const history = provider.documents.filter((d) => d.supersededAt);
  const missingTypes = ["STATE_LICENSE", "DEA", "BOARD_CERT", "MALPRACTICE_COI", "W9", "CAQH_ATTESTATION"].filter(
    (t) => !current.some((d) => d.type === t)
  );
  if (provider.supervisingProviderId && !current.some((d) => d.type === "SUPERVISION_AGREEMENT")) {
    missingTypes.push("SUPERVISION_AGREEMENT");
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Provider credentialing file</p>
          <h1>
            {provider.name}
            {provider.credential ? `, ${provider.credential}` : ""}
          </h1>
          <p className="chart-meta">
            <span>NPI {provider.npi ?? "—"}</span>
            <span>
              License {provider.licenseNumber ?? "—"}
              {provider.licenseState ? ` (${provider.licenseState})` : ""}
            </span>
            <span>CAQH {provider.caqhId ?? "—"}</span>
            <StatusBadge value={provider.status} />
            {provider.termDate && <span>Termed {formatDate(provider.termDate)}</span>}
          </p>
        </div>
        <div className="stack" style={{ gridAutoFlow: "column", gap: "0.5rem" }}>
          <Link className="btn secondary" href={`/settings/directories/providers/${provider.id}`}>
            Edit profile
          </Link>
          <Link className="btn secondary" href="/credentialing?tab=providers">
            All providers
          </Link>
        </div>
      </div>

      <div className="two-col">
        <div className="stack">
          <section className="panel">
            <h2>Document hub</h2>
            {missingTypes.length > 0 && (
              <p className="login-error">
                Missing: {missingTypes.map((t) => providerDocumentTypeLabel[t]).join(", ")}
              </p>
            )}
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
                        <td>{providerDocumentTypeLabel[d.type] ?? d.type}</td>
                        <td>
                          <a href={`/api/files/document/${d.id}`} target="_blank" rel="noreferrer">
                            {d.fileName}
                          </a>
                          <div className="muted">
                            Uploaded {formatDate(d.createdAt)} by {d.uploadedBy?.name ?? "—"}
                          </div>
                        </td>
                        <td>{d.issueDate ? formatDate(d.issueDate) : "—"}</td>
                        <td>
                          {d.expiryDate ? formatDate(d.expiryDate) : "—"}
                          {days !== null && days <= 90 && (
                            <div>
                              <span className={`badge ${days <= 30 ? "badge-denied" : "badge-submitted"}`}>
                                {days < 0 ? "Expired" : `${days} days`}
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {current.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted">
                        No documents on file.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="panel-section">
              <h3>Upload or renew a document</h3>
              <form className="form-grid" action={uploadProviderDocument.bind(null, provider.id)}>
                <label>
                  Type
                  <select name="type" defaultValue="" required>
                    <option value="" disabled>
                      Choose type
                    </option>
                    {Object.entries(providerDocumentTypeLabel).map(([v, l]) => (
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
                  Uploading a renewed document replaces the current one; the prior version stays in history. For
                  CAQH, set the expiry to 120 days after the attestation date.
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
                      {providerDocumentTypeLabel[d.type]} —{" "}
                      <a href={`/api/files/document/${d.id}`} target="_blank" rel="noreferrer">
                        {d.fileName}
                      </a>{" "}
                      <span className="muted">
                        (expired {d.expiryDate ? formatDate(d.expiryDate) : "—"}, replaced {formatDate(d.supersededAt!)})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="panel">
            <h2>Payer enrollments</h2>
            <table>
              <thead>
                <tr>
                  <th>Payer</th>
                  <th>Group / state</th>
                  <th>Status</th>
                  <th>Provider #</th>
                  <th>Effective</th>
                </tr>
              </thead>
              <tbody>
                {provider.enrollments.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link href={`/credentialing/enrollments/${e.id}`}>{e.groupPayerEnrollment.payer.name}</Link>
                    </td>
                    <td>
                      {e.groupPayerEnrollment.billingProvider.name}
                      {e.state ? ` · ${e.state}` : ""}
                    </td>
                    <td>
                      <StatusBadge value={e.status} />
                    </td>
                    <td>{e.payerProviderId ?? "—"}</td>
                    <td>{e.effectiveDate ? formatDate(e.effectiveDate) : "—"}</td>
                  </tr>
                ))}
                {provider.enrollments.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No payer lines yet — add them under Credentialing → Groups.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </div>

        <div className="stack">
          <section className="panel">
            <h2>Primary source verification</h2>
            <p className="muted">
              OIG and SAM.gov exclusion checks are due every 30 days (NCQA). Every check is kept as an audit trail.
            </p>
            <div className="panel-section">
              <h3>Screening status</h3>
              <ul>
                {MONTHLY_SCREENING_SOURCES.map((s) => {
                  const latest = provider.verificationChecks.find((c) => c.source === s);
                  const age = latest ? daysBetween(latest.checkedAt, now) : null;
                  return (
                    <li key={s}>
                      {verificationSourceLabel[s]}:{" "}
                      {latest ? (
                        <>
                          <StatusBadge value={latest.result} /> {formatDate(latest.checkedAt)}{" "}
                          {age! > 30 && <span className="badge badge-denied">Overdue</span>}
                        </>
                      ) : (
                        <span className="badge badge-denied">Never screened</span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <form action={runNppesCheck.bind(null, provider.id)} style={{ marginTop: "0.6rem" }}>
                <button className="btn secondary" type="submit" disabled={!provider.npi}>
                  Run NPPES check now
                </button>
              </form>
            </div>
            <div className="panel-section">
              <h3>Record a check</h3>
              <form className="stack" action={recordVerificationCheck.bind(null, provider.id)}>
                <label>
                  Source
                  <select name="source" defaultValue="OIG_LEIE">
                    {Object.entries(verificationSourceLabel).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Result
                  <select name="result" defaultValue="CLEAR">
                    {Object.entries(verificationResultLabel).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Notes / confirmation
                  <input name="notes" placeholder="Search ID, board confirmation #…" />
                </label>
                <button className="btn secondary" type="submit">
                  Save check
                </button>
              </form>
            </div>
            <div className="panel-section">
              <h3>History</h3>
              {provider.verificationChecks.length === 0 && <p className="muted">No checks recorded.</p>}
              <ul>
                {provider.verificationChecks.map((c) => (
                  <li key={c.id}>
                    <strong>{verificationSourceLabel[c.source] ?? c.source}</strong> <StatusBadge value={c.result} />{" "}
                    <span className="muted">
                      {formatDate(c.checkedAt)} · {c.checkedBy?.name ?? "—"}
                    </span>
                    {c.notes && <div className="muted">{c.notes}</div>}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="panel">
            <h2>Profile</h2>
            <p>
              <span className="muted">Taxonomy</span>
              <br />
              {provider.taxonomy ?? "—"}
            </p>
            <p>
              <span className="muted">Supervising / collaborating physician</span>
              <br />
              {provider.supervisingProvider ? (
                <Link href={`/credentialing/providers/${provider.supervisingProvider.id}`}>
                  {provider.supervisingProvider.name}
                </Link>
              ) : (
                "—"
              )}
            </p>
            {provider.supervisees.length > 0 && (
              <p>
                <span className="muted">Supervises</span>
                <br />
                {provider.supervisees.map((s) => s.name).join(", ")}
              </p>
            )}
            <p className="muted">{provider.user ? `Linked to CareHub login ${provider.user.email}` : "No CareHub login"}</p>

            <div className="panel-section">
              {provider.status === "ACTIVE" ? (
                <>
                  <h3>Term provider</h3>
                  <form className="stack" action={termProvider.bind(null, provider.id)}>
                    <label>
                      Term date
                      <input name="termDate" type="date" required />
                    </label>
                    <label>
                      Reason
                      <input name="reason" placeholder="Resigned, contract ended…" />
                    </label>
                    <p className="muted">Closes every open and approved enrollment and logs it on each record.</p>
                    <button className="btn secondary" type="submit">
                      Term provider
                    </button>
                  </form>
                </>
              ) : (
                <form action={reactivateProvider.bind(null, provider.id)}>
                  <button className="btn secondary" type="submit">
                    Reactivate provider
                  </button>
                </form>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
