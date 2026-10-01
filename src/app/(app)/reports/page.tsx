import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { reportRange } from "@/lib/financial-reports";
import { OPS_REPORTS, runOpsReport } from "@/lib/ops-reports";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ r?: string; from?: string; to?: string }> }) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "BILLER", "SCHEDULER"]);
  const sp = await searchParams;
  const key = OPS_REPORTS.some(([k]) => k === sp.r) ? sp.r! : "daily";
  const { from, to } = reportRange(sp);
  const table = await runOpsReport(user.practiceId, key, from, to);
  const meta = OPS_REPORTS.find(([k]) => k === key)!;
  const money = new Set(table.money ?? []);
  const fmt = (v: string | number, i: number) => (money.has(i) && typeof v === "number" ? v.toLocaleString("en-US", { style: "currency", currency: "USD" }) : v);
  const qs = new URLSearchParams({ r: key, from: iso(from), to: iso(to) });

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">Practice reports</p>
          <h1>{meta[1]}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {meta[2]}
          </p>
        </div>
        <div className="cn-actions">
          <a className="btn secondary" href={`/api/reports/ops?${qs}`}>
            Export CSV
          </a>
          {["ADMIN", "BILLER"].includes(user.role) && (
            <Link className="btn ghost" href="/billing/reports">
              Financial reports
            </Link>
          )}
          <Link className="btn ghost" href="/care-gaps">
            Care gaps
          </Link>
        </div>
      </div>
      <nav className="cn-filters">
        {OPS_REPORTS.map(([k, l]) => (
          <Link key={k} href={`/reports?r=${k}&from=${iso(from)}&to=${iso(to)}`} className={k === key ? "active" : ""}>
            {l}
          </Link>
        ))}
      </nav>
      <form className="cn-inline" method="get">
        <input type="hidden" name="r" value={key} />
        <label className="checkbox-inline">
          From <input type="date" name="from" defaultValue={iso(from)} />
        </label>
        <label className="checkbox-inline">
          To <input type="date" name="to" defaultValue={iso(to)} />
        </label>
        <button className="btn secondary" type="submit">
          Run
        </button>
      </form>
      <section className="panel">
        {table.rows.length === 0 ? (
          <p className="muted">Nothing to report for this period.</p>
        ) : (
          <div className="table-scroll">
            <table className="cn-table rp-table">
              <thead>
                <tr>
                  {table.columns.map((c, i) => (
                    <th key={c} className={money.has(i) ? "num" : ""}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => (
                      <td key={j} className={money.has(j) ? "num" : ""}>
                        {fmt(v, j)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {table.totals && (
                <tfoot>
                  <tr>
                    {table.totals.map((v, j) => (
                      <th key={j} className={money.has(j) ? "num" : ""}>
                        {fmt(v, j)}
                      </th>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
