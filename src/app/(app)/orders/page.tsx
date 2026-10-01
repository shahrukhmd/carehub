import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, patientName } from "@/lib/format";
import { ORDER_ROLES, ORDER_STATUS, ensureOrderCatalog } from "@/lib/orders";
import { importResultsFile } from "./actions";

type Search = { view?: string; kind?: string; error?: string; ok?: string };

const VIEWS: [string, string][] = [
  ["review", "Results to review"],
  ["pending", "Awaiting results"],
  ["unsent", "Drafts & unsent"],
  ["all", "All orders"],
  ["import", "Import results (HL7)"],
];

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(ORDER_ROLES);
  const sp = await searchParams;
  const view = VIEWS.some(([k]) => k === sp.view) ? sp.view! : "review";
  await ensureOrderCatalog(user.practiceId);
  const kind = sp.kind === "LAB" || sp.kind === "IMAGING" ? sp.kind : undefined;
  const statusWhere: Prisma.ClinicalOrderWhereInput =
    view === "review" ? { status: { in: ["RESULTED", "PARTIAL"] }, results: { some: { reviewedAt: null } } } : view === "pending" ? { status: { in: ["SENT", "PARTIAL"] } } : view === "unsent" ? { status: { in: ["DRAFT", "SIGNED"] } } : {};
  const [orders, counts] = await Promise.all([
    view === "import"
      ? Promise.resolve([])
      : prisma.clinicalOrder.findMany({
          where: { practiceId: user.practiceId, ...(kind ? { kind } : {}), ...statusWhere },
          include: { patient: true, items: true, provider: true, results: true },
          orderBy: { createdAt: "desc" },
          take: 300,
        }),
    Promise.all([
      prisma.clinicalOrder.count({ where: { practiceId: user.practiceId, status: { in: ["RESULTED", "PARTIAL"] }, results: { some: { reviewedAt: null } } } }),
      prisma.clinicalOrder.count({ where: { practiceId: user.practiceId, status: { in: ["SENT", "PARTIAL"] } } }),
      prisma.clinicalOrder.count({ where: { practiceId: user.practiceId, status: { in: ["DRAFT", "SIGNED"] } } }),
    ]),
  ]);
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
            {i < 3 && counts[i] > 0 ? <span className="tk-count">{counts[i]}</span> : null}
          </Link>
        ))}
      </nav>
      {view === "import" ? (
        <section className="panel">
          <h2>Import results from a lab</h2>
          <p className="muted">
            Upload the HL7 v2 result file (ORU^R01) the lab sends. Each result is filed on the order whose requisition number it carries, and the ordering provider
            gets a review task (urgent for critical values). Until a live lab interface is connected, results can also be typed in or a scanned report attached
            on the order.
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
