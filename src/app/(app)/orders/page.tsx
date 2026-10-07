import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, patientName } from "@/lib/format";
import { ORDER_ROLES, ORDER_STATUS, ensureOrderCatalog } from "@/lib/orders";
import { discardInterfaceMessage, importResultsFile, linkInterfaceMessage, replayInterfaceMessage } from "./actions";
import { MESSAGE_STATUS, inboxCounts, parseHl7Header, suggestOrders } from "@/lib/interfaces";
import { formatTime } from "@/lib/format";

type Search = { view?: string; kind?: string; error?: string; ok?: string; q?: string; all?: string };

const VIEWS: [string, string][] = [
  ["review", "Results to review"],
  ["pending", "Awaiting results"],
  ["unsent", "Drafts & unsent"],
  ["all", "All orders"],
  ["import", "Import results (HL7)"],
  ["inbox", "Interface inbox"],
];

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(ORDER_ROLES);
  const sp = await searchParams;
  const view = VIEWS.some(([k]) => k === sp.view) ? sp.view! : "review";
  await ensureOrderCatalog(user.practiceId);
  const kind = sp.kind === "LAB" || sp.kind === "IMAGING" ? sp.kind : undefined;
  const q = sp.q?.trim();
  const patientWhere: Prisma.ClinicalOrderWhereInput = q ? { patient: { OR: [{ lastName: { contains: q, mode: "insensitive" } }, { firstName: { contains: q, mode: "insensitive" } }, { mrn: { contains: q, mode: "insensitive" } }] } } : {};
  const statusWhere: Prisma.ClinicalOrderWhereInput =
    view === "review" ? { status: { in: ["RESULTED", "PARTIAL"] }, results: { some: { reviewedAt: null } } } : view === "pending" ? { status: { in: ["SENT", "PARTIAL"] } } : view === "unsent" ? { status: { in: ["DRAFT", "SIGNED"] } } : {};
  const [orders, counts] = await Promise.all([
    view === "import" || view === "inbox"
      ? Promise.resolve([])
      : prisma.clinicalOrder.findMany({
          where: { practiceId: user.practiceId, ...(kind ? { kind } : {}), ...statusWhere, ...patientWhere },
          include: { patient: true, items: true, provider: true, results: true },
          orderBy: { createdAt: "desc" },
          take: 300,
        }),
    Promise.all([
      prisma.clinicalOrder.count({ where: { practiceId: user.practiceId, status: { in: ["RESULTED", "PARTIAL"] }, results: { some: { reviewedAt: null } } } }),
      prisma.clinicalOrder.count({ where: { practiceId: user.practiceId, status: { in: ["SENT", "PARTIAL"] } } }),
      prisma.clinicalOrder.count({ where: { practiceId: user.practiceId, status: { in: ["DRAFT", "SIGNED"] } } }),
      0,
      0,
      inboxCounts(user.practiceId),
    ]),
  ]);
  const messages = view === "inbox" ? await prisma.interfaceMessage.findMany({ where: { practiceId: user.practiceId, ...(sp.all ? {} : { status: { in: ["RECEIVED", "UNMATCHED", "PARTIAL", "FAILED"] } }) }, orderBy: { receivedAt: "desc" }, take: 200 }) : [];
  const suggestions = new Map<string, Awaited<ReturnType<typeof suggestOrders>>>();
  for (const m of messages) if (m.status === "UNMATCHED" || m.status === "PARTIAL" || m.status === "FAILED") suggestions.set(m.id, await suggestOrders(user.practiceId, parseHl7Header(m.raw)));
  const linkedOrders = new Map((await prisma.clinicalOrder.findMany({ where: { id: { in: messages.map((m) => m.orderId).filter((x): x is string => Boolean(x)) } }, select: { id: true, requisition: true, patient: { select: { firstName: true, lastName: true } } } })).map((o) => [o.id, o]));
  const ordering = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(orders.map((o) => o.orderedById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const now = Date.now();

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">Clinical</p>
          <h1>Lab &amp; imaging orders</h1>
        </div>
        <div className="cn-actions">
          <Link className="btn" href="/orders/new?kind=LAB">
            New lab order
          </Link>
          <Link className="btn secondary" href="/orders/new?kind=IMAGING">
            New imaging order
          </Link>
          {user.role === "ADMIN" && (
            <Link className="btn ghost" href="/settings/orders">
              Labs &amp; catalog
            </Link>
          )}
        </div>
      </div>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}
      <nav className="view-tabs" style={{ width: "fit-content", flexWrap: "wrap" }}>
        {VIEWS.map(([k, l], i) => (
          <Link key={k} href={`/orders?view=${k}${kind ? `&kind=${kind}` : ""}`} className={`view-tab${view === k ? " active" : ""}`}>
            {l}
            {i !== 3 && i !== 4 && counts[i] > 0 ? <span className="tk-count">{counts[i]}</span> : null}
          </Link>
        ))}
      </nav>
      <form method="get" className="cn-inline" style={{ margin: "0.4rem 0" }}>
        <input type="hidden" name="view" value={view} />
        {kind && <input type="hidden" name="kind" value={kind} />}
        <input name="q" defaultValue={q ?? ""} placeholder="Patient name or MRN" aria-label="Patient" />
        <button className="btn secondary gw-mini" type="submit">
          Search
        </button>
        {q && (
          <Link className="btn ghost gw-mini" href={`/orders?view=${view}${kind ? `&kind=${kind}` : ""}`}>
            Clear
          </Link>
        )}
      </form>
      {view === "inbox" ? (
        <section className="panel">
          <div className="cn-head">
            <h2>Interface inbox</h2>
            <Link className="btn ghost gw-mini" href={sp.all ? "/orders?view=inbox" : "/orders?view=inbox&all=1"}>
              {sp.all ? "Needs attention only" : "Show all messages"}
            </Link>
          </div>
          <p className="muted">
            Result messages from connected labs and imaging centers (HL7 over the interface, FHIR, or uploaded files). Messages whose requisition number
            matched an order were filed automatically; the rest wait here to be linked to the right order and replayed. Nothing is deleted.
          </p>
          {messages.length === 0 ? (
            <p className="muted">{sp.all ? "No messages received yet." : "Nothing needs attention."}</p>
          ) : (
            <table className="cn-table">
              <thead>
                <tr>
                  <th>Received</th>
                  <th>From</th>
                  <th>Patient in message</th>
                  <th>Requisition</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => {
                  const [label, tone] = MESSAGE_STATUS[m.status] ?? [m.status, "info"];
                  const open = m.status === "UNMATCHED" || m.status === "PARTIAL" || m.status === "FAILED" || m.status === "RECEIVED";
                  const linked = m.orderId ? linkedOrders.get(m.orderId) : null;
                  const sugg = suggestions.get(m.id) ?? [];
                  return (
                    <tr key={m.id}>
                      <td>
                        {formatDate(m.receivedAt)} {formatTime(m.receivedAt)}
                        <div className="muted cn-small">
                          {m.channel === "FILE" ? "Uploaded file" : m.channel} · {m.messageType ?? "?"}
                          {m.controlId ? ` · ${m.controlId}` : ""}
                        </div>
                      </td>
                      <td className="cn-small">{m.sender ?? "—"}</td>
                      <td className="cn-small">{m.patientHint ?? "—"}</td>
                      <td className="cn-small">
                        {m.requisition ?? "—"}
                        {linked && (
                          <div>
                            <Link href={`/orders/${linked.id}`}>
                              {linked.requisition} · {patientName(linked.patient)}
                            </Link>
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`gw-tag gw-tag-${tone}`}>{label}</span>
                        {m.detail && <div className="muted cn-small">{m.detail}</div>}
                        <details className="cn-small">
                          <summary className="muted">Message</summary>
                          <pre style={{ whiteSpace: "pre-wrap", maxHeight: "16rem", overflow: "auto", fontSize: "var(--text-xs)" }}>{m.raw.replace(/\r/g, "\n").slice(0, 6000)}</pre>
                        </details>
                      </td>
                      <td>
                        {open && (
                          <div className="stack" style={{ gap: "0.3rem" }}>
                            <form action={linkInterfaceMessage.bind(null, m.id)} className="cn-inline">
                              {sugg.length > 0 ? (
                                <select name="orderId" aria-label="Order" defaultValue={sugg[0].id}>
                                  {sugg.map((o) => (
                                    <option key={o.id} value={o.id}>
                                      {o.requisition} · {formatDate(o.createdAt)} · {o.items.map((i) => i.name).join(", ").slice(0, 60)}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input name="requisition" placeholder="Requisition #" aria-label="Requisition number" style={{ width: "9rem" }} />
                              )}
                              <button className="btn secondary gw-mini" type="submit">
                                File on this order
                              </button>
                            </form>
                            {sugg.length > 0 && (
                              <form action={linkInterfaceMessage.bind(null, m.id)} className="cn-inline">
                                <input name="requisition" placeholder="Other requisition #" aria-label="Requisition number" style={{ width: "9rem" }} />
                                <button className="btn ghost gw-mini" type="submit">
                                  File
                                </button>
                              </form>
                            )}
                            <div className="cn-inline">
                              <form action={replayInterfaceMessage.bind(null, m.id)}>
                                <button className="btn ghost gw-mini" type="submit">
                                  Replay
                                </button>
                              </form>
                              <form action={discardInterfaceMessage.bind(null, m.id)} className="cn-inline">
                                <input name="reason" placeholder="Reason" aria-label="Reason" style={{ width: "8rem" }} />
                                <button className="btn ghost gw-mini" type="submit">
                                  Discard
                                </button>
                              </form>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      ) : view === "import" ? (
        <section className="panel">
          <h2>Import results from a lab</h2>
          <p className="muted">
            Upload the HL7 v2 result file (ORU^R01) the lab sends. Each result is filed on the order whose requisition number it carries, and the ordering provider
            gets a review task (urgent for critical values). Files that cannot be matched wait in the interface inbox. Connected labs can also post results
            directly (see Settings → Interoperability). Results can still be typed in or a scanned report attached on the order.
          </p>
          <form action={importResultsFile} className="cn-inline">
            <input type="file" name="file" required accept=".hl7,.txt,.oru,.dat" aria-label="HL7 result file" />
            <button className="btn" type="submit">
              Import results
            </button>
          </form>
        </section>
      ) : (
        <>
          <nav className="cn-filters">
            <Link href={`/orders?view=${view}`} className={!kind ? "active" : ""}>
              Labs &amp; imaging
            </Link>
            <Link href={`/orders?view=${view}&kind=LAB`} className={kind === "LAB" ? "active" : ""}>
              Labs
            </Link>
            <Link href={`/orders?view=${view}&kind=IMAGING`} className={kind === "IMAGING" ? "active" : ""}>
              Imaging
            </Link>
          </nav>
          <section className="panel">
            {orders.length === 0 ? (
              <p className="muted">No orders here.</p>
            ) : (
              <table className="cn-table">
                <thead>
                  <tr>
                    <th>Ordered</th>
                    <th>Patient</th>
                    <th>Tests / studies</th>
                    <th>Sent to</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const [label, tone] = ORDER_STATUS[o.status] ?? [o.status, "info"];
                    const abnormal = o.results.some((r) => r.flag !== "NORMAL");
                    const critical = o.results.some((r) => r.flag === "CRITICAL");
                    const late = o.status === "SENT" && o.sentAt && now - o.sentAt.getTime() > 7 * 86_400_000;
                    return (
                      <tr key={o.id}>
                        <td>
                          <Link href={`/orders/${o.id}`}>{formatDate(o.createdAt)}</Link>
                          <div className="muted cn-small">
                            {o.kind === "LAB" ? "Lab" : "Imaging"} · {o.requisition}
                          </div>
                        </td>
                        <td>
                          {patientName(o.patient)}
                          <div className="muted cn-small">{ordering.get(o.orderedById) ?? ""}</div>
                        </td>
                        <td className="cn-small">{o.items.map((i) => i.name).join(", ")}</td>
                        <td className="cn-small">
                          {o.provider?.name ?? "—"}
                          {o.sentVia ? ` · ${o.sentVia.toLowerCase()} ${o.sentAt ? formatDate(o.sentAt) : ""}` : ""}
                        </td>
                        <td>
                          <span className={`gw-tag gw-tag-${tone}`}>{label}</span>
                          {critical ? <div className="gw-missing cn-small">Critical value</div> : abnormal ? <div className="gw-missing cn-small">Abnormal</div> : null}
                          {late && <div className="gw-missing cn-small">No results after 7 days</div>}
                          {o.priority !== "ROUTINE" && <span className="cn-tag">{o.priority}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
