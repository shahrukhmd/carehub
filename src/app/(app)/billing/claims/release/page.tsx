import { rolesFor } from "@/lib/permissions";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { SelectAll } from "@/components/SelectAll";
import { filteredClaims } from "@/lib/claims-dashboard";
import { RELEASABLE_STATUSES, editsFor } from "@/lib/claim-submit";
import { claimNumber, claimStatusLabel, payerRankLabel } from "@/lib/claim-format";
import { formatDate, formatMoney, insuranceTypeLabel, patientName } from "@/lib/format";
import { BillingTabs, ClaimsMenu } from "../../tabs";
import { bulkRelease } from "../batch-actions";

const LIST_LIMIT = 200;
type Search = { patient?: string; from?: string; to?: string; status?: string; location?: string; payer?: string; insType?: string; error?: string; ok?: string };

// The pre-release queue: every generated claim that has not been billed yet, with what would stop it. Billing
// reviews a claim here (or opens it), ticks the clean ones and bills them to insurance in one step.
export default async function PreReleaseQueuePage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(rolesFor("billing.work"));
  const sp = await searchParams;
  const status = sp.status && RELEASABLE_STATUSES.includes(sp.status) ? sp.status : "";

  const [all, payers, locations] = await Promise.all([
    filteredClaims(user.practiceId, { patient: sp.patient, from: sp.from, to: sp.to, dateType: "dos", status: status || undefined, location: sp.location, payer: sp.payer, insType: sp.insType }),
    prisma.payer.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" }, select: { id: true, name: true, insuranceType: true, payerCode: true } }),
    prisma.location.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const waiting = all.filter((c) => RELEASABLE_STATUSES.includes(c.status));
  const claims = waiting.slice(0, LIST_LIMIT);
  const edits = await editsFor(
    user.practiceId,
    claims.map((c) => c.id)
  );
  const insTypes = [...new Set(payers.map((p) => p.insuranceType).filter((t): t is string => Boolean(t)))];
  const filtered = Boolean(sp.patient || sp.from || sp.to || status || sp.location || sp.payer || sp.insType);

  const rows = claims.map((c) => {
    const list = edits.get(c.id) ?? [];
    const errors = list.filter((e) => e.severity === "error");
    const paperOnly = list.some((e) => e.field === "payer");
    const warnings = list.filter((e) => e.severity === "warning" && e.field !== "payer");
    return { ...c, errors, warnings, paperOnly, canRelease: errors.length === 0 && !paperOnly };
  });
  const ready = rows.filter((r) => r.canRelease).length;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            <Link href="/billing">Revenue cycle</Link>
          </p>
          <h1>Pre-release queue</h1>
        </div>
        <Link className="btn secondary" href="/billing/claims/release/status">
          Billing batch status
        </Link>
      </div>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}
      <BillingTabs active="release" />
      <ClaimsMenu active="release" />

      <details className="panel cd-filters" open={filtered}>
        <summary>Find claims{filtered ? " · filters on" : ""}</summary>
        <form method="get" className="cd-filter-form">
          <label>
            Patient name
            <input name="patient" defaultValue={sp.patient ?? ""} placeholder="Last or first name contains" />
          </label>
          <div className="cd-pair">
            <label>
              Date of service from
              <input type="date" name="from" defaultValue={sp.from ?? ""} />
            </label>
            <label>
              To
              <input type="date" name="to" defaultValue={sp.to ?? ""} />
            </label>
          </div>
          <label>
            Claim status
            <select name="status" defaultValue={status}>
              <option value="">All in the queue</option>
              {RELEASABLE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {claimStatusLabel[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Site of service
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
          <div className="gw-actions">
            <button className="btn" type="submit">
              Search
            </button>
            <Link className="btn ghost" href="/billing/claims/release">
              Clear
            </Link>
          </div>
        </form>
      </details>

      <form action={bulkRelease} className="panel cd-list cm-batch">
        <div className="cd-list-head">
          <strong>
            {waiting.length} claim{waiting.length === 1 ? "" : "s"} in pre-release · {ready} ready to bill
          </strong>
          <SelectAll name="claim" max={LIST_LIMIT} />
        </div>
        <div className="cd-scroll">
          <table>
            <thead>
              <tr>
                <th aria-label="Select" />
                <th>Claim #</th>
                <th>Patient name</th>
                <th>Date of service</th>
                <th>Insurance payer</th>
                <th>Site of service</th>
                <th>Status</th>
                <th>Claim check</th>
                <th className="num">Charges</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={c.canRelease ? undefined : "cm-blocked"}>
                  <td>
                    <input type="checkbox" name="claim" value={c.id} disabled={!c.canRelease} aria-label={`Bill ${claimNumber(c)}`} />
                  </td>
                  <td>
                    <Link href={`/billing/claims/${c.id}`}>{claimNumber(c)}</Link>
                  </td>
                  <td>{patientName(c.patient)}</td>
                  <td>{formatDate(c.dos)}</td>
                  <td>
                    {c.payerName}
                    {c.payerRank !== "PRIMARY" && <span className="muted"> · {payerRankLabel[c.payerRank]}</span>}
                  </td>
                  <td>{c.serviceLocation?.name ?? "—"}</td>
                  <td>{claimStatusLabel[c.status] ?? c.status}</td>
                  <td>
                    {c.errors.length > 0 && (
                      <span className="gw-tag gw-tag-bad" title={c.errors.map((e) => e.message).join("\n")}>
                        {c.errors.length} error{c.errors.length === 1 ? "" : "s"} — open to fix
                      </span>
                    )}
                    {c.paperOnly && (
                      <Link className="gw-tag gw-tag-info" href="/billing/claims/paper" title="This payer has no EDI payer ID, so the claim is printed on a CMS-1500 instead">
                        Paper only
                      </Link>
                    )}
                    {c.warnings.length > 0 && (
                      <span className="gw-tag gw-tag-warn" title={c.warnings.map((e) => e.message).join("\n")}>
                        {c.warnings.length} warning{c.warnings.length === 1 ? "" : "s"}
                      </span>
                    )}
                    {c.canRelease && c.warnings.length === 0 && <span className="gw-tag gw-tag-ok">Clean</span>}
                    {c.filing && (
                      <span className={`gw-tag gw-tag-${c.filing === "PAST" ? "bad" : "warn"}`}>{c.filing === "PAST" ? "Past timely filing" : `${c.filingDaysLeft}d to file`}</span>
                    )}
                  </td>
                  <td className="num">{formatMoney(c.billedCents)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted">
                    The pre-release queue is empty{filtered ? " with these filters" : ""}. Generate claims from <Link href="/billing?tab=visits">Visits to bill</Link>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {waiting.length > LIST_LIMIT && (
          <p className="muted">
            Showing the first {LIST_LIMIT} of {waiting.length}. Narrow the list with the filters, or bill these and come back for the rest.
          </p>
        )}
        <div className="cm-foot">
          <label className="cm-check" title="When ticked, a claim with warnings stays in the queue and is listed on the batch status screen with its warnings">
            <input type="checkbox" name="warningsBlock" defaultChecked />
            Warnings keep a claim in the queue
          </label>
          <span className="muted">Claims with errors can&apos;t be ticked — open the claim, fix it and save. Claims on hold are not listed.</span>
          <button className="btn" type="submit" disabled={ready === 0}>
            Bill selected to insurance
          </button>
        </div>
      </form>
    </>
  );
}
