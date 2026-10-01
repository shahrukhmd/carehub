import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { BUCKETS, FILTER_KEYS, claimsDashboard, type ClaimFilters } from "@/lib/claims-dashboard";
import { claimNumber, claimStatusLabel, payerRankLabel } from "@/lib/claim-format";
import { formatDate, formatMoney, insuranceTypeLabel, patientName } from "@/lib/format";
import { BillingTabs } from "../tabs";
import { goToClaim } from "./go";

const LIST_LIMIT = 300;
type Search = ClaimFilters & { error?: string };

// Keeps the filter panel's choices on every link inside the dashboard.
function query(f: ClaimFilters, extra: Record<string, string | undefined> = {}) {
  const p = new URLSearchParams();
  for (const k of FILTER_KEYS) if (f[k]) p.set(k, f[k]!);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export default async function ClaimsDashboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(["ADMIN", "BILLER"]);
  const sp = await searchParams;
  const [d, payers, providers, locations] = await Promise.all([
    claimsDashboard(user.practiceId, sp),
    prisma.payer.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" }, select: { id: true, name: true, insuranceType: true } }),
    prisma.renderingProvider.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" }, select: { id: true, name: true, isRendering: true, isReferring: true } }),
    prisma.location.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const insTypes = [...new Set(payers.map((p) => p.insuranceType).filter((t): t is string => Boolean(t)))];
  const shown = d.list.slice(0, LIST_LIMIT);
  const approaching = d.list.filter((c) => c.filing === "APPROACHING").length;
  const past = d.list.filter((c) => c.filing === "PAST").length;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            <Link href="/billing">Revenue cycle</Link>
          </p>
          <h1>Claims dashboard</h1>
        </div>
        <form action={goToClaim} className="cd-go">
          <input name="claim" placeholder="Go to claim # (e.g. CLM-26ABC123)" aria-label="Claim number" required />
          <button className="btn" type="submit">
            Go
          </button>
        </form>
      </div>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      <BillingTabs active="claims" />

      <section className="grid-stats cd-tiles">
        <Link className={`stat${d.selected === "UNBILLED" ? " cd-on" : ""}`} href={`/billing/claims${query(sp, { bucket: "UNBILLED" })}`} title="Claims not yet sent to a payer: draft, ready, on hold or rejected by the clearinghouse">
          <span>Unbilled</span>
          <strong>{d.tiles.unbilled}</strong>
        </Link>
        <Link className={`stat${d.selected === "TF_APPROACHING" ? " cd-on" : ""}`} href={`/billing/claims${query(sp, { bucket: "TF_APPROACHING" })}`} title="Unsent claims close to the payer's filing deadline">
          <span>Approaching timely filing</span>
          <strong className={d.tiles.approaching ? "cd-warn" : undefined}>{d.tiles.approaching}</strong>
        </Link>
        <Link className={`stat${d.selected === "DENIED" ? " cd-on" : ""}`} href={`/billing/claims${query(sp, { bucket: "DENIED" })}`} title="Claims denied by the payer">
          <span>Denied</span>
          <strong className={d.tiles.denied ? "cd-bad" : undefined}>{d.tiles.denied}</strong>
        </Link>
        <Link className="stat" href="/statements" title="When patient statements were last generated">
          <span>Last statement batch date</span>
          <strong>{d.tiles.lastStatement ? formatDate(d.tiles.lastStatement) : "—"}</strong>
        </Link>
        <Link className={`stat${d.selected === "TF_PAST" ? " cd-on" : ""}`} href={`/billing/claims${query(sp, { bucket: "TF_PAST" })}`} title="Unsent claims already past the payer's filing deadline">
          <span>Past timely filing</span>
          <strong className={d.tiles.past ? "cd-bad" : undefined}>{d.tiles.past}</strong>
        </Link>
      </section>

      <div className="cd-layout">
        {/* ---------------- Filters ---------------- */}
        <details className="panel cd-filters" open={d.hasFilters}>
          <summary>
            Claim filters{d.hasFilters ? " · on" : ""}
          </summary>
          <form method="get" className="cd-filter-form">
            {sp.bucket && <input type="hidden" name="bucket" value={sp.bucket} />}
            <label>
              Claim dates
              <select name="dateType" defaultValue={sp.dateType ?? "dos"}>
                <option value="dos">Date of service</option>
                <option value="created">Created</option>
                <option value="submitted">Submitted</option>
              </select>
            </label>
            <div className="cd-pair">
              <label>
                From
                <input type="date" name="from" defaultValue={sp.from ?? ""} />
              </label>
              <label>
                To
                <input type="date" name="to" defaultValue={sp.to ?? ""} />
              </label>
            </div>
            <label>
              Age of claim — at least (days since service)
              <input name="ageMin" type="number" min="0" defaultValue={sp.ageMin ?? ""} placeholder="e.g. 90" />
            </label>
            <label>
              Claim status
              <select name="status" defaultValue={sp.status ?? ""}>
                <option value="">All</option>
                {Object.entries(claimStatusLabel)
                  .filter(([k]) => k !== "VOID")
                  .map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Payer type
              <select name="rank" defaultValue={sp.rank ?? ""}>
                <option value="">All</option>
                {Object.entries(payerRankLabel).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l} insurance
                  </option>
                ))}
              </select>
            </label>
            <label>
              Insurance type
              <select name="insType" defaultValue={sp.insType ?? ""}>
                <option value="">All</option>
                {insTypes.map((t) => (
                  <option key={t} value={t}>
                    {insuranceTypeLabel[t] ?? t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Insurance plan
              <select name="payer" defaultValue={sp.payer ?? ""}>
                <option value="">All</option>
                {payers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Patient name
              <input name="patient" defaultValue={sp.patient ?? ""} placeholder="Last or first name contains" />
            </label>
            <label>
              Patient number (MRN starts with)
              <input name="mrn" defaultValue={sp.mrn ?? ""} />
            </label>
            <label>
              Location
              <select name="location" defaultValue={sp.location ?? ""}>
                <option value="">All</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Provider
              <select name="provider" defaultValue={sp.provider ?? ""}>
                <option value="">All</option>
                {providers
                  .filter((p) => p.isRendering)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Referring provider
              <select name="referrer" defaultValue={sp.referrer ?? ""}>
                <option value="">All</option>
                {providers
                  .filter((p) => p.isReferring)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Billing code (CPT / HCPCS starts with)
              <input name="cpt" defaultValue={sp.cpt ?? ""} placeholder="e.g. 97597" />
            </label>
            <div className="cd-pair">
              <label>
                Balance
                <select name="balOp" defaultValue={sp.balOp ?? "gte"}>
                  <option value="gte">≥ at least</option>
                  <option value="lte">≤ at most</option>
                </select>
              </label>
              <label>
                Amount ($)
                <input name="bal" inputMode="decimal" defaultValue={sp.bal ?? ""} />
              </label>
            </div>
            <div className="gw-actions">
              <button className="btn" type="submit">
                Apply filters
              </button>
              <Link className="btn ghost" href={`/billing/claims${sp.bucket ? `?bucket=${sp.bucket}` : ""}`}>
                Clear all filters
              </Link>
            </div>
          </form>
        </details>

        {/* ---------------- Overview ---------------- */}
        <section className="panel cd-overview">
          <div className="gw-section-head">
            <h2>Claims overview</h2>
            <span className="muted">{d.hasFilters ? `${d.total} claims match the filters` : `${d.total} claims`}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th className="num">Claims</th>
                <th className="num">Total balance</th>
              </tr>
            </thead>
            <tbody>
              {d.overview.map((b, i) => (
                <tr key={b.key} className={`${b.key === d.selected ? "cd-row-on" : ""}${b.count === 0 ? " cd-empty" : ""}${!b.status && BUCKETS[i - 1]?.status ? " cd-split" : ""}`}>
                  <td>
                    <Link href={`/billing/claims${query(sp, { bucket: b.key })}`} title={b.hint}>
                      {b.label}
                    </Link>
                  </td>
                  <td className="num">{b.count}</td>
                  <td className="num">{b.balance < 0 ? `- ${formatMoney(-b.balance)}` : formatMoney(b.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* ---------------- Claims in the selected row ---------------- */}
        <section className="panel cd-list">
          <div className="cd-list-head">
            <strong>
              {d.selectedLabel}: {d.list.length}
            </strong>
            <span>
              Approaching timely filing: {approaching} · Past timely filing: {past}
            </span>
          </div>
          <div className="cd-scroll">
            <table>
              <thead>
                <tr>
                  <th>Claim #</th>
                  <th>Patient name</th>
                  <th>Date of service</th>
                  <th>Submitted</th>
                  <th>Insurance payer</th>
                  <th>Primary provider</th>
                  <th>Location</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/billing/claims/${c.id}`}>{claimNumber(c)}</Link>
                    </td>
                    <td>
                      {patientName(c.patient)}
                      {c.filing && (
                        <span className={`gw-tag gw-tag-${c.filing === "PAST" ? "bad" : "warn"}`} title="Days left to file with this payer">
                          {c.filing === "PAST" ? `Filing deadline passed ${-c.filingDaysLeft!}d ago` : `${c.filingDaysLeft}d to file`}
                        </span>
                      )}
                    </td>
                    <td>{formatDate(c.dos)}</td>
                    <td>{c.submittedAt ? formatDate(c.submittedAt) : "—"}</td>
                    <td>
                      {c.payerName}
                      {c.payerRank !== "PRIMARY" && <span className="muted"> · {payerRankLabel[c.payerRank]}</span>}
                    </td>
                    <td>{c.renderingProvider?.name ?? "—"}</td>
                    <td>{c.serviceLocation?.name ?? "—"}</td>
                    <td className="num">{c.balance < 0 ? `- ${formatMoney(-c.balance)}` : formatMoney(c.balance)}</td>
                  </tr>
                ))}
                {d.list.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted">
                      No claims here{d.hasFilters ? " with these filters" : ""}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {d.list.length > LIST_LIMIT && <p className="muted">Showing the first {LIST_LIMIT} of {d.list.length}. Narrow the list with the claim filters.</p>}
        </section>
      </div>
    </>
  );
}
