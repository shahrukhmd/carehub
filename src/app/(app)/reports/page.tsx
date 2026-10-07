import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { reportRange } from "@/lib/financial-reports";
import { OPS_REPORTS, runOpsReport } from "@/lib/ops-reports";
import { REPORTS as FINANCIAL_REPORTS } from "@/lib/financial-reports";
import { CATALOG } from "@/lib/report-catalog";
import { can, type Subject } from "@/lib/permissions";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ r?: string; from?: string; to?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  if (!sp.r) return <ReportsHome role={user} />;
  if (!can(user, "reports.ops") && !can(user, "reports.clinical")) return <ReportsHome role={user} />;
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
          <p className="muted">
            <Link href="/reports">Reports</Link> · Front office &amp; operations
          </p>
          <h1>{meta[1]}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {meta[2]}
          </p>
        </div>
        <div className="cn-actions">
          <a className="btn secondary" href={`/api/reports/ops?${qs}`}>
            Export CSV
          </a>
          {can(user, "billing.work") && (
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

// ---- The reports catalogue: every report in CareHub, grouped by the work it serves, one click to run. ----

const CLINICAL_OPS = new Set(["wound_outcomes", "wound_provider", "hbo"]);

function ReportsHome({ role }: { role: Subject }) {
  const ops = OPS_REPORTS.filter(([k]) => !CLINICAL_OPS.has(k));
  const clinical = OPS_REPORTS.filter(([k]) => CLINICAL_OPS.has(k));
  const groups: { title: string; about: string; show: boolean; items: { href: string; label: string; about: string }[] }[] = [
    {
      title: "Front office & operations",
      about: "The day, the schedule, the waiting room and the cash drawer",
      show: can(role, "reports.ops"),
      items: ops.map(([k, l, d]) => ({ href: `/reports?r=${k}`, label: l, about: d })),
    },
    {
      title: "Clinical & outcomes",
      about: "How patients are doing, what is due, and quality measures",
      show: can(role, "reports.clinical") || can(role, "caregaps.view"),
      items: [
        ...clinical.map(([k, l, d]) => ({ href: `/reports?r=${k}`, label: l, about: d })),
        { href: "/care-gaps", label: "Care gaps", about: "Active patients due for a screening, lab or assessment" },
        { href: "/reports/registry", label: "Patient registry", about: "Build a patient list from diagnoses, medications and demographics; export" },
        { href: "/reports/quality", label: "Quality measures", about: "eCQM / MIPS measure performance for the period" },
      ],
    },
    {
      title: "Revenue cycle",
      about: "Collections, A/R, denials, payer mix and coding",
      show: can(role, "billing.work"),
      items: [...FINANCIAL_REPORTS.map(([k, l, d]) => ({ href: `/billing/reports?r=${k}`, label: l, about: d })), ...CATALOG.filter((r) => r.group === "revenue" && !FINANCIAL_REPORTS.some(([k]) => k === r.key)).map((r) => ({ href: r.href, label: r.label, about: r.about }))],
    },
    {
      title: "Patient accounts",
      about: "Statements, payment plans and collections",
      show: can(role, "billing.work"),
      items: CATALOG.filter((r) => r.group === "accounts").map((r) => ({ href: r.href, label: r.label, about: r.about })),
    },
    {
      title: "Operations",
      about: "Deposits and the bank, imports, automation runs",
      show: can(role, "billing.work"),
      items: CATALOG.filter((r) => r.group === "operations").map((r) => ({ href: r.href, label: r.label, about: r.about })),
    },
    {
      title: "Credentialing",
      about: "Enrollments and expirations",
      show: can(role, "credentialing.work"),
      items: [{ href: "/credentialing", label: "Enrollment status grid", about: "Every provider × payer line with its status" }, { href: "/api/credentialing/export", label: "Credentialing export (CSV)", about: "The full enrollment list for spreadsheets" }],
    },
  ];
  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">Insights</p>
          <h1>Reports</h1>
          <p className="muted" style={{ margin: 0 }}>
            Every report, by the work it serves. Each one runs for a date range and exports to CSV. <Link href="/reports/subscriptions">Saved views &amp; email subscriptions</Link>. The <Link href="/dashboard">dashboard</Link> shows today&apos;s numbers at a glance.
          </p>
        </div>
      </div>
      {groups
        .filter((g) => g.show)
        .map((g) => (
          <section className="panel" key={g.title}>
            <div className="gw-section-head">
              <h2>{g.title}</h2>
              <span className="muted">{g.about}</span>
            </div>
            <ul className="rp-catalog">
              {g.items.map((i) => (
                <li key={i.href}>
                  <Link href={i.href}>{i.label}</Link>
                  <span className="muted">{i.about}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
