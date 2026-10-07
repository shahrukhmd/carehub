import { rolesFor } from "@/lib/permissions";
import { TeamWaiting } from "@/components/TeamWaiting";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BillingTabs } from "./tabs";
import type { Prisma } from "@prisma/client";
import { createDeposit } from "@/app/actions";
import { createClaim, writeOffSmallBalances } from "./claims/actions";
import { generateClaims } from "./claims/batch-actions";
import { SelectAll } from "@/components/SelectAll";
import { createTestEra, uploadEra } from "./era/actions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { agingBucket, depositPayerTypeLabel, formatDate, formatMoney, patientName } from "@/lib/format";
import { SIGNED_STATUSES, visitStatusLabel, visitStatusTone } from "@/lib/visit-workflow";
import {
  EDITABLE_CLAIM_STATUSES,
  OPEN_AR_STATUSES,
  PRE_RELEASE_STATUSES,
  claimStatusLabel,
  claimStatusTone,
  payerRankLabel,
  visitBillingStatusLabel,
} from "@/lib/claim-format";

const AGING_BUCKETS = ["0-30 days", "31-60 days", "61-90 days", "90+ days"] as const;
// Tabs rendered on this page; the others (claims dashboard, denial worklist, reports) are their own pages.
const LOCAL_TABS = ["visits", "deposits", "era", "ar"];

type Search = { tab?: string; imported?: string; q?: string; status?: string; rank?: string; billing?: string; error?: string; ok?: string };

export default async function BillingPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(rolesFor("billing.work"));
  const smallBalanceCents = (await prisma.practiceSettings.findUnique({ where: { practiceId: user.practiceId }, select: { smallBalanceCents: true } }))?.smallBalanceCents ?? 500;
  const sp = await searchParams;
  // Old links to the claims tab land on the dashboard.
  if (sp.tab === "claims") redirect(`/billing/claims${sp.status === "UNSENT" ? "?bucket=UNBILLED" : sp.status === "PROBLEM" ? "?bucket=DENIED" : ""}`);
  const tab = sp.tab && LOCAL_TABS.includes(sp.tab) ? sp.tab : "visits";

  const claims = await prisma.claim.findMany({
    where: { practiceId: user.practiceId, status: { not: "VOID" } },
    select: { status: true, billedCents: true, paidCents: true, adjustedCents: true, submittedAt: true },
  });
  const readyVisits = await prisma.encounter.count({
    where: { practiceId: user.practiceId, status: { in: SIGNED_STATUSES }, charges: { some: {} }, claims: { none: { status: { not: "VOID" } } } },
  });
  const openAr = claims
    .filter((c) => OPEN_AR_STATUSES.includes(c.status) || c.status === "TRANSFERRED")
    .reduce((s, c) => s + Math.max(c.billedCents - c.paidCents - c.adjustedCents, 0), 0);
  const collected = claims.reduce((s, c) => s + c.paidCents, 0);
  const unsent = claims.filter((c) => EDITABLE_CLAIM_STATUSES.includes(c.status)).length;
  const preRelease = claims.filter((c) => PRE_RELEASE_STATUSES.includes(c.status)).length;
  const problems = claims.filter((c) => ["DENIED", "EDI_REJECTED"].includes(c.status)).length;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Practice management · visit → claim → submission → payment</p>
          <h1>Revenue cycle</h1>
        </div>
      </div>

      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}

      <section className="grid-stats">
        <Link className="stat" href="/billing?tab=visits&billing=READY_FOR_CLAIM">
          <span>Visits ready for claim</span>
          <strong>{readyVisits}</strong>
        </Link>
        <Link className="stat" href="/billing/claims/release" title="Generated claims waiting for billing to review and bill">
          <span>In pre-release queue</span>
          <strong>{preRelease}</strong>
        </Link>
        <Link className="stat" href="/billing/claims?bucket=UNBILLED" title="Pre-release, on hold or rejected by the clearinghouse">
          <span>Claims not yet billed</span>
          <strong>{unsent}</strong>
        </Link>
        <Link className="stat" href="/billing/claims?bucket=DENIED">
          <span>Denied / rejected</span>
          <strong>{problems}</strong>
        </Link>
        <div className="stat">
          <span>Open AR · collected</span>
          <strong>
            {formatMoney(openAr)} · {formatMoney(collected)}
          </strong>
        </div>
      </section>

      <TeamWaiting user={user} />
      <BillingTabs active={tab} />

      {tab === "visits" && <VisitsTab practiceId={user.practiceId} sp={sp} />}
      {tab === "deposits" && <DepositsTab practiceId={user.practiceId} />}
      {tab === "era" && <EraTab practiceId={user.practiceId} imported={sp.imported} />}
      {tab === "ar" && <ArTab claims={claims} smallBalanceCents={smallBalanceCents} />}
    </>
  );
}

// ---------------------------------------------------------------- Visits to bill

async function VisitsTab({ practiceId, sp }: { practiceId: string; sp: Search }) {
  const q = sp.q?.trim();
  const where: Prisma.EncounterWhereInput = {
    practiceId,
    OR: [{ status: { in: SIGNED_STATUSES } }, { claims: { some: {} } }],
    ...(sp.billing && sp.billing in visitBillingStatusLabel ? { billingStatus: sp.billing } : {}),
    ...(q ? { patient: { OR: [{ lastName: { contains: q } }, { firstName: { contains: q } }, { mrn: { contains: q } }] } } : {}),
  };
  const visits = await prisma.encounter.findMany({
    where,
    include: {
      patient: { include: { insurances: { where: { active: true }, include: { payer: true } } } },
      provider: true,
      charges: true,
      claims: { where: { status: { not: "VOID" } }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { date: "desc" },
    take: 200,
  });

  const canGenerate = visits.filter((v) => SIGNED_STATUSES.includes(v.status) && v.charges.length > 0 && !v.claims.some((c) => c.payerRank === "PRIMARY")).length;

  return (
    <>
      <form method="get" className="panel gw-filters">
        <input type="hidden" name="tab" value="visits" />
        <input name="q" defaultValue={q} placeholder="Patient name or MRN" aria-label="Patient" />
        <select name="billing" defaultValue={sp.billing ?? ""} aria-label="Billing status">
          <option value="">Any billing status</option>
          {Object.entries(visitBillingStatusLabel).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <button className="btn secondary" type="submit">
          Filter
        </button>
        <Link className="btn ghost" href="/billing?tab=visits">
          Clear
        </Link>
      </form>

      {/* The checkboxes belong to this form (form="generate") so the per-row secondary buttons stay their own forms. */}
      <form id="generate" action={generateClaims} className="panel cm-bar-plain gw-actions" style={{ alignItems: "center" }}>
        <SelectAll name="visit" max={200} noun="visit" />
        <button className="btn" type="submit" disabled={canGenerate === 0}>
          Generate claims
        </button>
        <span className="muted">
          Creates a primary claim for each ticked signed visit and puts it in the <Link href="/billing/claims/release">pre-release queue</Link> for billing to review and bill.
        </span>
      </form>

      <section className="panel gw-table cm-batch">
        <table>
          <thead>
            <tr>
              <th aria-label="Select" />
              <th>Visit</th>
              <th>Patient</th>
              <th>Provider</th>
              <th>Visit status</th>
              <th>Billing status</th>
              <th>Charges</th>
              <th>Claims</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visits.map((v) => {
              const total = v.charges.reduce((s, c) => s + c.amountCents, 0);
              const has = (rank: string) => v.claims.some((c) => c.payerRank === rank);
              const primary = v.claims.find((c) => c.payerRank === "PRIMARY");
              const secondaryIns = v.patient.insurances.find((i) => i.rank === "SECONDARY");
              const canPrimary = SIGNED_STATUSES.includes(v.status) && !has("PRIMARY") && v.charges.length > 0;
              const canSecondary =
                primary && ["PAID", "PARTIAL", "DENIED", "TRANSFERRED"].includes(primary.status) && secondaryIns && !has("SECONDARY");
              return (
                <tr key={v.id}>
                  <td>
                    <input type="checkbox" name="visit" value={v.id} form="generate" disabled={!canPrimary} aria-label={`Generate claim for ${patientName(v.patient)} ${formatDate(v.date)}`} />
                  </td>
                  <td>
                    <Link href={`/encounters/${v.id}`}>{formatDate(v.date)}</Link>
                  </td>
                  <td>
                    <Link href={`/patients/${v.patientId}`}>{patientName(v.patient)}</Link>
                    <div className="muted">
                      {v.patient.mrn} · {v.patient.insurances.find((i) => i.rank === "PRIMARY")?.payer.name ?? "No insurance"}
                    </div>
                  </td>
                  <td>{v.provider.name}</td>
                  <td>
                    <span className={`gw-tag gw-tag-${visitStatusTone(v.status)}`}>{visitStatusLabel[v.status] ?? v.status}</span>
                  </td>
                  <td>{visitBillingStatusLabel[v.billingStatus] ?? v.billingStatus}</td>
                  <td>
                    {formatMoney(total)}
                    <div className="muted">{v.charges.map((c) => c.cptCode).join(", ")}</div>
                  </td>
                  <td>
                    {v.claims.map((c) => (
                      <div key={c.id}>
                        <Link href={`/billing/claims/${c.id}`} className={`gw-tag gw-tag-${claimStatusTone(c.status)}`}>
                          {payerRankLabel[c.payerRank]} · {claimStatusLabel[c.status] ?? c.status}
                        </Link>
                      </div>
                    ))}
                    {v.claims.length === 0 && <span className="muted">—</span>}
                  </td>
                  <td className="gw-actions">
                    {canPrimary && (
                      <form action={createClaim.bind(null, v.id, "PRIMARY")}>
                        <button className="btn ghost gw-mini" type="submit" title="Generate this one claim and open it">
                          Generate &amp; open
                        </button>
                      </form>
                    )}
                    {canSecondary && (
                      <form action={createClaim.bind(null, v.id, "SECONDARY")}>
                        <button className="btn secondary gw-mini" type="submit">
                          Bill secondary
                        </button>
                      </form>
                    )}
                    {!SIGNED_STATUSES.includes(v.status) && v.claims.length === 0 && <span className="muted">Not signed</span>}
                  </td>
                </tr>
              );
            })}
            {visits.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
                  No visits match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- Claims

async function DepositsTab({ practiceId }: { practiceId: string }) {
  const deposits = await prisma.deposit.findMany({
    where: { practiceId },
    include: { applications: { include: { claim: { include: { patient: true } } } } },
    orderBy: { postedAt: "desc" },
  });
  return (
    <section className="panel">
      <div className="panel-columns">
        <div className="panel-section">
          <h3>Record deposit</h3>
          <p className="muted">Record a lump-sum receipt (check, EFT, card, cash), then apply it from each claim&apos;s page.</p>
          <form className="stack" action={createDeposit}>
            <label>
              Payer type
              <select name="payerType" defaultValue="INSURANCE">
                {Object.entries(depositPayerTypeLabel).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Payer / patient name
              <input name="payerName" placeholder="Horizon Blue Cross, or patient name" required />
            </label>
            <label>
              Payment method
              <select name="paymentMethod" defaultValue="CHECK">
                <option value="CHECK">Check</option>
                <option value="EFT">EFT</option>
                <option value="CREDIT_CARD">Credit card</option>
                <option value="CASH">Cash</option>
              </select>
            </label>
            <label>
              Check / reference number
              <input name="checkNumber" />
            </label>
            <label>
              Total amount (USD)
              <input name="amount" type="number" step="0.01" required />
            </label>
            <label>
              Note
              <input name="note" />
            </label>
            <label title="Leave blank for today. A closed accounting period cannot be posted into.">
              Posted date
              <input name="postedAt" type="date" />
            </label>
            <button className="btn" type="submit">
              Record deposit
            </button>
          </form>
        </div>
        <div className="panel-section">
          <h3>Deposit history</h3>
          <table>
            <thead>
              <tr>
                <th>Payer</th>
                <th>Total</th>
                <th>Unapplied</th>
                <th>Applied to</th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.payerName}
                    <div className="muted">
                      {depositPayerTypeLabel[d.payerType] ?? d.payerType} · {d.paymentMethod}
                      {d.checkNumber ? ` #${d.checkNumber}` : ""} · {formatDate(d.postedAt)}
                    </div>
                  </td>
                  <td>{formatMoney(d.totalCents)}</td>
                  <td>{formatMoney(d.unappliedCents)}</td>
                  <td>
                    {d.applications.map((a) => (
                      <div key={a.id}>
                        <Link href={`/billing/claims/${a.claimId}`}>{patientName(a.claim.patient)}</Link> ·{" "}
                        {formatMoney(a.amountCents)} {a.type === "ADJUSTMENT" ? "adj" : ""}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
              {deposits.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No deposits recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- AR & denials

function ArTab({
  claims,
  smallBalanceCents,
}: {
  smallBalanceCents: number;
  claims: { status: string; billedCents: number; paidCents: number; adjustedCents: number; submittedAt: Date | null }[];
}) {
  const now = Date.now();
  const aging = new Map<string, number>(AGING_BUCKETS.map((b) => [b, 0]));
  for (const c of claims) {
    if (!c.submittedAt || !(OPEN_AR_STATUSES.includes(c.status) || c.status === "TRANSFERRED")) continue;
    const balance = c.billedCents - c.paidCents - c.adjustedCents;
    if (balance <= 0) continue;
    const bucket = agingBucket(Math.floor((now - c.submittedAt.getTime()) / 86_400_000));
    aging.set(bucket, (aging.get(bucket) ?? 0) + balance);
  }
  const count = (s: string) => claims.filter((c) => c.status === s).length;
  return (
    <section className="panel">
      <div className="panel-columns">
        <div className="panel-section">
          <h3>AR aging (from submission)</h3>
          <table>
            <thead>
              <tr>
                <th>Bucket</th>
                <th>Open balance</th>
              </tr>
            </thead>
            <tbody>
              {AGING_BUCKETS.map((bucket) => (
                <tr key={bucket}>
                  <td>{bucket}</td>
                  <td>{formatMoney(aging.get(bucket) ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel-section">
          <h3>Small balance write-off</h3>
          <p className="muted">
            Clears claim balances at or under a threshold with a contractual adjustment (a zero-balance adjustment), so pennies and small remainders stop
            showing in AR. Each claim gets a log entry.
          </p>
          <form action={writeOffSmallBalances} className="cn-inline">
            <label className="checkbox-inline">
              Balances up to $<input name="threshold" inputMode="decimal" defaultValue={(smallBalanceCents / 100).toFixed(2)} style={{ width: "6rem" }} aria-label="Threshold" />
            </label>
            <select name="who" defaultValue="INSURANCE" aria-label="Whose balance">
              <option value="INSURANCE">Insurance balances</option>
              <option value="PATIENT">Patient balances</option>
              <option value="ALL">Both</option>
            </select>
            <button className="btn secondary" type="submit">
              Write off
            </button>
          </form>
          <h3 style={{ marginTop: "1rem" }}>Denials &amp; rejections</h3>
          <div className="grid-stats" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: "0.7rem" }}>
            <Link className="stat" href="/billing/denials">
              <span>Payer denials · under appeal</span>
              <strong>
                {count("DENIED")} · {count("APPEAL")}
              </strong>
            </Link>
            <Link className="stat" href="/billing/claims?bucket=EDI_REJECTED">
              <span>Clearinghouse rejections</span>
              <strong>{count("EDI_REJECTED")}</strong>
            </Link>
          </div>
          <p className="muted">
            Clearinghouse rejections happen before a payer ever sees the claim (bad NPI, invalid pointer, subscriber not found) and
            are fixed and resent. Denials happen after the payer adjudicates the claim and are appealed or corrected — work them
            from the <Link href="/billing/denials">denial worklist</Link>.
          </p>
        </div>
      </div>
    </section>
  );
}

async function EraTab({ practiceId, imported }: { practiceId: string; imported?: string }) {
  const [files, payers] = await Promise.all([
    prisma.eraFile.findMany({ where: { practiceId }, include: { _count: { select: { claims: true } }, claims: { select: { matchStatus: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.payer.findMany({ where: { practiceId, claims: { some: { status: { in: ["SUBMITTED", "ACCEPTED"] } } } }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="stack">
      {imported && <p className="notice-ok">{imported} remittance files imported.</p>}
      <section className="panel">
        <h2>Import an ERA (835 remittance)</h2>
        <p className="muted">
          Upload the 835 files your clearinghouse or payer portal gives you. CareHub reads every claim on the remittance, matches it to your claim, and posts
          the payment, contractual write-off, patient responsibility or denial in one step.
        </p>
        <form action={uploadEra} className="cn-inline">
          <input type="file" name="files" multiple required accept=".835,.txt,.edi,.x12,.era" aria-label="835 files" />
          <button className="btn" type="submit">
            Import &amp; match
          </button>
        </form>
        {payers.length > 0 && (
          <details>
            <summary className="muted">Testing without a clearinghouse? Create a test remittance for submitted claims</summary>
            <form action={createTestEra} className="cn-inline">
              <select name="payerId" aria-label="Payer">
                {payers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <label className="checkbox-inline">
                <input type="checkbox" name="deny" /> Deny the first claim
              </label>
              <button className="btn secondary" type="submit">
                Create test 835
              </button>
            </form>
          </details>
        )}
      </section>
      <section className="panel">
        <h2>Remittances</h2>
        {files.length === 0 ? (
          <p className="muted">No ERAs imported yet.</p>
        ) : (
          <table className="cn-table">
            <thead>
              <tr>
                <th>Imported</th>
                <th>Payer</th>
                <th>Payment</th>
                <th>Claims</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => {
                const unmatched = f.claims.filter((c) => c.matchStatus === "UNMATCHED").length;
                const ready = f.claims.filter((c) => c.matchStatus === "MATCHED").length;
                return (
                  <tr key={f.id}>
                    <td>{formatDate(f.createdAt)}</td>
                    <td>
                      <Link href={`/billing/era/${f.id}`}>{f.payerName}</Link>
                      <div className="muted cn-small">{f.fileName}</div>
                    </td>
                    <td>
                      {formatMoney(f.totalCents)}
                      <div className="muted cn-small">
                        {f.paymentMethod === "ACH" ? "EFT" : f.paymentMethod === "CHK" ? "Check" : f.paymentMethod} {f.traceNumber ?? ""}
                      </div>
                    </td>
                    <td>
                      {f._count.claims}
                      {unmatched > 0 && <div className="gw-missing">{unmatched} unmatched</div>}
                    </td>
                    <td>
                      <span className={`cn-status ${f.status === "POSTED" ? "cn-completed" : f.status === "PARTIAL" ? "cn-in_progress" : "cn-sent"}`}>
                        {f.status === "POSTED" ? "Posted" : f.status === "PARTIAL" ? "Partly posted" : ready ? `${ready} ready to post` : "Needs matching"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
