import { rolesFor } from "@/lib/permissions";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { patientName } from "@/lib/format";
import { REPORTS, reportRange, runReport } from "@/lib/financial-reports";

type Search = { r?: string; from?: string; to?: string; patientId?: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const RANGED = ["collections", "cpt", "provider", "denials", "denial_rate", "denial_categories", "denial_providers", "appeals", "payer_mix", "em_levels"];

export default async function FinancialReportsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(rolesFor("billing.work"));
  const sp = await searchParams;
  const key = REPORTS.some(([k]) => k === sp.r) ? sp.r! : "collections";
  const { from, to } = reportRange(sp);
  const [table, patients] = await Promise.all([
    runReport(user.practiceId, key, from, to, sp.patientId),
    key === "ledger" ? prisma.patient.findMany({ where: { practiceId: user.practiceId }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 2000 }) : Promise.resolve([]),
  ]);
  const meta = REPORTS.find(([k]) => k === key)!;
  const money = new Set(table.money ?? []);
  const fmt = (v: string | number, i: number) => (money.has(i) && typeof v === "number" ? v.toLocaleString("en-US", { style: "currency", currency: "USD" }) : v);
  const qs = new URLSearchParams({ r: key, from: iso(from), to: iso(to), ...(sp.patientId ? { patientId: sp.patientId } : {}) });

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/billing">Revenue cycle</Link> · Financial reports
          </p>
          <h1>{meta[1]}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {meta[2]}
          </p>
        </div>
        <a className="btn secondary" href={`/api/reports/financial?${qs}`}>
          Export CSV
        </a>
      </div>
      <nav className="cn-filters">
        {REPORTS.map(([k, l]) => (
          <Link key={k} href={`/billing/reports?r=${k}&from=${iso(from)}&to=${iso(to)}`} className={k === key ? "active" : ""}>
            {l}
          </Link>
        ))}
      </nav>
      {(RANGED.includes(key) || key === "ledger") && (
        <form className="cn-inline" method="get">
          <input type="hidden" name="r" value={key} />
          {key === "ledger" ? (
            <select name="patientId" defaultValue={sp.patientId ?? ""} required aria-label="Patient">
              <option value="">Choose a patient…</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {patientName(p)} · {p.mrn}
                </option>
              ))}
            </select>
          ) : (
            <>
              <label className="checkbox-inline">
                From <input type="date" name="from" defaultValue={iso(from)} />
              </label>
              <label className="checkbox-inline">
                To <input type="date" name="to" defaultValue={iso(to)} />
              </label>
            </>
          )}
          <button className="btn secondary" type="submit">
            Run
          </button>
        </form>
      )}
      <section className="panel">
        {table.rows.length === 0 ? (
          <p className="muted">{key === "ledger" && !sp.patientId ? "Choose a patient to see their ledger." : "Nothing to report for this period."}</p>
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
