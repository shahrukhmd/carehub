import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { createDeposit } from "@/app/actions";
import { createClaim } from "./claims/actions";
import { createTestEra, uploadEra } from "./era/actions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { agingBucket, depositPayerTypeLabel, formatDate, formatMoney, patientName } from "@/lib/format";
import { SIGNED_STATUSES, visitStatusLabel, visitStatusTone } from "@/lib/visit-workflow";
import { claimEdits } from "@/lib/claims";
import { getPracticeSettings } from "@/lib/chart-setup";
import {
  EDITABLE_CLAIM_STATUSES,
  OPEN_AR_STATUSES,
  claimNumber,
  claimStatusLabel,
  claimStatusTone,
  payerRankLabel,
  visitBillingStatusLabel,
} from "@/lib/claim-format";

const AGING_BUCKETS = ["0-30 days", "31-60 days", "61-90 days", "90+ days"] as const;
const TABS = [
  { key: "visits", label: "Visits to bill" },
  { key: "claims", label: "Claims" },
  { key: "deposits", label: "Deposits" },
  { key: "era", label: "ERA / 835 posting" },
  { key: "ar", label: "AR & denials" },
  { key: "denials", label: "Denial worklist" },
  { key: "reports", label: "Financial reports" },
];
// Tabs that are their own pages.
const TAB_PAGES: Record<string, string> = { reports: "/billing/reports", denials: "/billing/denials" };

type Search = { tab?: string; imported?: string; q?: string; status?: string; rank?: string; billing?: string; error?: string };

export default async function BillingPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(["ADMIN", "BILLER"]);
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab && !TAB_PAGES[t.key]) ? sp.tab! : "visits";

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

      <section className="grid-stats">
        <Link className="stat" href="/billing?tab=visits&billing=READY_FOR_CLAIM">
          <span>Visits ready for claim</span>
          <strong>{readyVisits}</strong>
        </Link>
        <Link className="stat" href="/billing?tab=claims&status=UNSENT">
          <span>Claims not yet sent</span>
          <strong>{unsent}</strong>
        </Link>
        <Link className="stat" href="/billing?tab=claims&status=PROBLEM">
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

      <nav className="view-tabs" style={{ margin: "0.9rem 0", width: "fit-content" }}>
        {TABS.map((t) => (
          <Link key={t.key} href={TAB_PAGES[t.key] ?? `/billing?tab=${t.key}`} className={`view-tab${t.key === tab ? " active" : ""}`}>
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "visits" && <VisitsTab practiceId={user.practiceId} sp={sp} />}
      {tab === "claims" && <ClaimsTab practiceId={user.practiceId} sp={sp} />}
      {tab === "deposits" && <DepositsTab practiceId={user.practiceId} />}
      {tab === "era" && <EraTab practiceId={user.practiceId} imported={sp.imported} />}
      {tab === "ar" && <ArTab claims={claims} />}
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

      <section className="panel gw-table">
        <table>
          <thead>
            <tr>
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
                        <button className="btn gw-mini" type="submit">
                          Create claim
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
                <td colSpan={8} className="muted">
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

async function ClaimsTab({ practiceId, sp }: { practiceId: string; sp: Search }) {
  const settings = await getPracticeSettings(practiceId);
  const ruleOptions = { rulesEnabled: settings.enableClaimRules, allowZeroCharge: settings.allowZeroChargeClaims };
  const q = sp.q?.trim();
  const statusFilter: Prisma.ClaimWhereInput =
    sp.status === "UNSENT"
      ? { status: { in: EDITABLE_CLAIM_STATUSES } }
      : sp.status === "PROBLEM"
        ? { status: { in: ["DENIED", "EDI_REJECTED"] } }
        : sp.status && sp.status in claimStatusLabel
          ? { status: sp.status }
          : { status: { not: "VOID" } };
  const claims = await prisma.claim.findMany({
    where: {
      practiceId,
      ...statusFilter,
      ...(sp.rank ? { payerRank: sp.rank } : {}),
      ...(q
        ? {
            OR: [
              { patient: { lastName: { contains: q } } },
              { patient: { firstName: { contains: q } } },
              { patient: { mrn: { contains: q } } },
              { payerName: { contains: q } },
              { clearinghouseClaimId: { contains: q } },
            ],
          }
        : {}),
    },
    include: {
      lines: { orderBy: { lineNumber: "asc" } },
      diagnoses: true,
      insurance: true,
      payer: true,
      billingProvider: true,
      renderingProvider: true,
      patient: true,
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  return (
    <>
      <form method="get" className="panel gw-filters">
        <input type="hidden" name="tab" value="claims" />
        <input name="q" defaultValue={q} placeholder="Patient, MRN, payer or clearinghouse ID" aria-label="Search" />
        <select name="status" defaultValue={sp.status ?? ""} aria-label="Status">
          <option value="">All (except voided)</option>
          <option value="UNSENT">Not yet sent</option>
          <option value="PROBLEM">Denied / rejected</option>
          {Object.entries(claimStatusLabel).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <select name="rank" defaultValue={sp.rank ?? ""} aria-label="Payer rank">
          <option value="">Any payer rank</option>
          {Object.entries(payerRankLabel).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <button className="btn secondary" type="submit">
          Filter
        </button>
        <Link className="btn ghost" href="/billing?tab=claims">
          Clear
        </Link>
      </form>

      <section className="panel gw-table vw-worklist">
        <table>
          <thead>
            <tr>
              <th>Claim #</th>
              <th>Form</th>
              <th>DOS</th>
              <th>Patient</th>
              <th>Payer</th>
              <th>Lines</th>
              <th>Billed</th>
              <th>Paid</th>
              <th>Balance</th>
              <th>Status</th>
              <th>Edits</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {claims.map((c) => {
              const edits = EDITABLE_CLAIM_STATUSES.includes(c.status) ? claimEdits(c, ruleOptions) : [];
              const errors = edits.filter((e) => e.severity === "error").length;
              const dos = c.lines.map((l) => l.dosFrom.getTime());
              const balance = c.billedCents - c.paidCents - c.adjustedCents;
              return (
                <tr key={c.id}>
                  <td>
                    <Link href={`/billing/claims/${c.id}`}>
                      <strong>{claimNumber(c)}</strong>
                    </Link>
                    <div className="muted">
                      {formatDate(c.createdAt)}
                      {c.frequencyCode !== "1" ? ` · freq ${c.frequencyCode}` : ""}
                    </div>
                  </td>
                  <td>{c.formType === "CMS1500" ? "HCFA" : "UB04"}</td>
                  <td>{dos.length ? formatDate(new Date(Math.min(...dos))) : "—"}</td>
                  <td>
                    <Link href={`/patients/${c.patientId}`}>{patientName(c.patient)}</Link>
                    <div className="muted">{c.patient.mrn}</div>
                  </td>
                  <td>
                    {c.payerName}
                    <div className="muted">
                      {payerRankLabel[c.payerRank]}
                      {c.payer?.payerCode ? ` · ${c.payer.payerCode}` : ""}
                    </div>
                  </td>
                  <td>{c.lines.map((l) => l.cptCode).join(", ")}</td>
                  <td>{formatMoney(c.billedCents)}</td>
                  <td>{formatMoney(c.paidCents)}</td>
                  <td>{formatMoney(balance)}</td>
                  <td>
                    <span className={`gw-tag gw-tag-${claimStatusTone(c.status)}`}>{claimStatusLabel[c.status] ?? c.status}</span>
                    {c.rejectionReason && c.status === "EDI_REJECTED" && <div className="gw-missing">{c.rejectionReason}</div>}
                    {c.denialReason && c.status === "DENIED" && <div className="gw-missing">{c.denialReason}</div>}
                  </td>
                  <td>
                    {EDITABLE_CLAIM_STATUSES.includes(c.status) ? (
                      errors ? (
                        <span className="gw-tag gw-tag-bad">{errors} error(s)</span>
                      ) : (
                        <span className="gw-tag gw-tag-ok">Clean</span>
                      )
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="gw-actions">
                    <Link className="btn secondary gw-mini" href={`/billing/claims/${c.id}`}>
                      Open
                    </Link>
                    <a className="btn ghost gw-mini" href={`/api/claims/${c.id}/cms1500`} target="_blank" rel="noopener">
                      CMS-1500
                    </a>
                  </td>
                </tr>
              );
            })}
            {claims.length === 0 && (
              <tr>
                <td colSpan={12} className="muted">
                  No claims match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- Deposits

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
}: {
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
          <h3>Denials &amp; rejections</h3>
          <div className="grid-stats" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: "0.7rem" }}>
            <Link className="stat" href="/billing/denials">
              <span>Payer denials · under appeal</span>
              <strong>
                {count("DENIED")} · {count("APPEAL")}
              </strong>
            </Link>
            <Link className="stat" href="/billing?tab=claims&status=EDI_REJECTED">
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
