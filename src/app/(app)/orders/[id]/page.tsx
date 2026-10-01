import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, formatTime, patientName } from "@/lib/format";
import { ORDER_ROLES, ORDER_STATUS, ORDER_WRITE_ROLES, RESULT_FLAGS, SEND_METHODS } from "@/lib/orders";
import { cancelOrder, enterResults, recordCollection, reviewResults, sendOrder, signOrder } from "../actions";

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await requireUser(ORDER_ROLES);
  const { id } = await params;
  const sp = await searchParams;
  const o = await prisma.clinicalOrder.findFirst({ where: { id, practiceId: user.practiceId }, include: { patient: true, items: true, provider: true, results: { orderBy: { resultedAt: "asc" } } } });
  if (!o) notFound();
  const [orderer, docs, reviewers] = await Promise.all([
    prisma.user.findUnique({ where: { id: o.orderedById } }),
    prisma.patientDocument.findMany({ where: { patientId: o.patientId, practiceId: user.practiceId }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.user.findMany({ where: { id: { in: o.results.map((r) => r.reviewedById).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } }),
  ]);
  const reviewerName = new Map(reviewers.map((r) => [r.id, r.name]));
  const [label, tone] = ORDER_STATUS[o.status] ?? [o.status, "info"];
  const canWrite = ORDER_WRITE_ROLES.includes(user.role);
  const open = !["CANCELLED", "REVIEWED"].includes(o.status) || o.items.some((i) => i.status === "ORDERED");
  const unreviewed = o.results.filter((r) => !r.reviewedAt);
  const pending = o.items.filter((i) => i.status === "ORDERED");

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/orders">Lab &amp; imaging orders</Link> · <Link href={`/patients/${o.patientId}`}>{patientName(o.patient)}</Link>
          </p>
          <h1>
            {o.kind === "LAB" ? "Lab order" : "Imaging order"} {o.requisition}
          </h1>
          <p className="muted" style={{ margin: 0 }}>
            Ordered {formatDate(o.createdAt)} by {orderer?.name ?? "—"} · {o.priority.toLowerCase()} {o.fasting ? "· fasting" : ""}
          </p>
        </div>
        <div className="cn-actions">
          <span className={`gw-tag gw-tag-${tone}`}>{label}</span>
          <a className="btn secondary" href={`/api/orders/${o.id}/requisition`} target="_blank" rel="noreferrer">
            Requisition PDF
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
        <div className="stack">
          <section className="panel">
            <h2>{o.kind === "LAB" ? "Tests" : "Studies"}</h2>
            <ul className="pd-list">
              {o.items.map((it) => (
                <li key={it.id}>
                  <span>
                    {it.name} <span className="muted cn-small">{it.code}</span>
                  </span>
                  <span className="muted">{it.specimen ?? ""}</span>
                  <span className={`gw-tag gw-tag-${it.status === "RESULTED" ? "ok" : it.status === "CANCELLED" ? "bad" : "info"}`}>{it.status.toLowerCase()}</span>
                </li>
              ))}
            </ul>
            <p className="cn-small">
              <strong>Diagnosis:</strong> {o.diagnosisCodes ?? "—"}
              {o.clinicalNotes && (
                <>
                  <br />
                  <strong>Clinical info:</strong> {o.clinicalNotes}
                </>
              )}
              {o.scheduledFor && (
                <>
                  <br />
                  <strong>{o.kind === "LAB" ? "Collect by" : "Scheduled"}:</strong> {formatDate(o.scheduledFor)}
                </>
              )}
              {o.collectedAt && (
                <>
                  <br />
                  <strong>Collected:</strong> {formatDate(o.collectedAt)} {formatTime(o.collectedAt)} {o.collectedBy ? `by ${o.collectedBy}` : ""}
                </>
              )}
            </p>
          </section>
          <section className="panel">
            <h2>Results</h2>
            {o.results.length === 0 ? (
              <p className="muted">No results yet.</p>
            ) : (
              <table className="cn-table">
                <thead>
                  <tr>
                    <th>Test</th>
                    <th>Result</th>
                    <th>Range</th>
                    <th>Flag</th>
                    <th>Reviewed</th>
                  </tr>
                </thead>
                <tbody>
                  {o.results.map((r) => (
                    <tr key={r.id} className={r.flag !== "NORMAL" ? "or-abn" : ""}>
                      <td>
                        {r.name}
                        <div className="muted cn-small">
                          {formatDate(r.resultedAt)} · {r.source.toLowerCase()}
                        </div>
                      </td>
                      <td>
                        {r.value ? `${r.value} ${r.unit ?? ""}` : ""}
                        {r.reportText && <div className="or-report">{r.reportText}</div>}
                        {r.documentId && (
                          <Link className="cn-small" href={`/gateway/documents/${r.documentId}`}>
                            Open report
                          </Link>
                        )}
                      </td>
                      <td className="cn-small">{r.referenceRange ?? ""}</td>
                      <td>
                        <span className={`cn-status ${r.flag === "NORMAL" ? "cn-completed" : "cn-cancelled"}`}>{RESULT_FLAGS[r.flag] ?? r.flag}</span>
                      </td>
                      <td className="cn-small">{r.reviewedAt ? `${reviewerName.get(r.reviewedById ?? "") ?? ""} ${formatDate(r.reviewedAt)}${r.reviewNote ? ` — ${r.reviewNote}` : ""}` : <span className="gw-missing">Not reviewed</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {unreviewed.length > 0 && canWrite && (
              <form action={reviewResults.bind(null, o.id)} className="cn-inline" style={{ marginTop: "0.7rem" }}>
                <input name="note" placeholder="Review note / plan (optional)" style={{ flex: "1 1 18rem" }} />
                <label className="checkbox-inline">
                  <input type="checkbox" name="notify" /> Ask front desk to call the patient
                </label>
                <button className="btn" type="submit">
                  Sign off {unreviewed.length} result{unreviewed.length === 1 ? "" : "s"}
                </button>
              </form>
            )}
          </section>
        </div>
        <div className="stack">
          {o.status === "DRAFT" && canWrite && (
            <section className="panel">
              <h2>Sign</h2>
              <form action={signOrder.bind(null, o.id)}>
                <button className="btn" type="submit">
                  Sign order
                </button>
              </form>
            </section>
          )}
          {["SIGNED", "SENT"].includes(o.status) && (
            <section className="panel">
              <h2>{o.status === "SENT" ? "Resend" : "Send"}</h2>
              <form action={sendOrder.bind(null, o.id)} className="stack">
                <label>
                  How
                  <select name="method" defaultValue={o.provider?.sendMethod ?? "PRINT"}>
                    {Object.entries(SEND_METHODS).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Fax to
                  <input name="fax" defaultValue={o.provider?.fax ?? ""} placeholder="Lab fax number" />
                </label>
                <button className="btn secondary" type="submit">
                  {o.status === "SENT" ? "Send again" : "Send order"}
                </button>
              </form>
              <p className="muted cn-small">{o.sentAt ? `Sent ${formatDate(o.sentAt)} by ${o.sentVia?.toLowerCase()}.` : "A copy of the requisition is saved to the patient's documents."}</p>
            </section>
          )}
          {o.kind === "LAB" && open && o.status !== "CANCELLED" && (
            <section className="panel">
              <h2>Specimen</h2>
              <form action={recordCollection.bind(null, o.id)} className="form-grid">
                <label>
                  Collected at
                  <input type="datetime-local" name="collectedAt" />
                </label>
                <label>
                  Collected by
                  <input name="collectedBy" defaultValue={user.name} />
                </label>
                <button className="btn ghost gw-mini" type="submit">
                  Record collection
                </button>
              </form>
            </section>
          )}
          {o.status !== "CANCELLED" && (
            <section className="panel">
              <h2>Enter results</h2>
              <form action={enterResults.bind(null, o.id)} className="stack">
                {pending.map((it) => (
                  <fieldset key={it.id} className="or-result">
                    <legend>{it.name}</legend>
                    {o.kind === "LAB" ? (
                      <div className="form-grid gw-grid-3">
                        <label>
                          Value
                          <input name={`value_${it.id}`} />
                        </label>
                        <label>
                          Unit
                          <input name={`unit_${it.id}`} />
                        </label>
                        <label>
                          Range
                          <input name={`range_${it.id}`} />
                        </label>
                      </div>
                    ) : null}
                    <label>
                      {o.kind === "LAB" ? "Comment / narrative (cultures, pathology)" : "Report / impression"}
                      <textarea name={`report_${it.id}`} rows={2} />
                    </label>
                    <label>
                      Flag
                      <select name={`flag_${it.id}`} defaultValue="NORMAL">
                        {Object.entries(RESULT_FLAGS).map(([k, l]) => (
                          <option key={k} value={k}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </label>
                  </fieldset>
                ))}
                <label>
                  Or attach the scanned/faxed report
                  <select name="documentId" defaultValue="">
                    <option value="">—</option>
                    {docs.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Report flag
                  <select name="docFlag" defaultValue="NORMAL">
                    <option value="NORMAL">Normal</option>
                    <option value="ABNORMAL">Abnormal</option>
                  </select>
                </label>
                <button className="btn secondary" type="submit">
                  File results
                </button>
              </form>
            </section>
          )}
          {open && canWrite && o.status !== "CANCELLED" && (
            <section className="panel">
              <form action={cancelOrder.bind(null, o.id)} className="cn-inline">
                <input name="reason" placeholder="Reason" aria-label="Cancel reason" />
                <button className="btn ghost gw-mini" type="submit">
                  Cancel order
                </button>
              </form>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
