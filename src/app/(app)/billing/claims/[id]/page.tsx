import { requireChartAccess } from "@/lib/privacy";
import { claimNeighbours } from "@/lib/claims-dashboard";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { claimEdits, claimRuleOptions } from "@/lib/claims";
import { US_STATES, formatDate, formatMoney, patientName } from "@/lib/format";
import { placeOfServiceLabel } from "@/lib/superbill";
import {
  DX_LETTERS,
  EDITABLE_CLAIM_STATUSES,
  MAX_CLAIM_DIAGNOSES,
  MAX_CLAIM_LINES,
  claimFrequencyLabel,
  claimNumber,
  claimStatusLabel,
  claimStatusTone,
  delayReasonLabel,
  payerRankLabel,
  visitBillingStatusLabel,
} from "@/lib/claim-format";
import {
  applyPayment,
  correctClaim,
  holdClaim,
  releaseClaim,
  resubmitDenied,
  saveClaim,
  setBalanceResponsibility,
  setClaimStatus,
  submitClaim,
} from "../actions";
import { denialCodeOptions } from "@/lib/denials";
import { DenialPanel, loadDenialPanel } from "./denial-panel";

function d(v: Date | null | undefined) {
  return v ? v.toISOString().slice(0, 10) : "";
}

function Opt({ labels }: { labels: Record<string, string> }) {
  return (
    <>
      {Object.entries(labels).map(([k, l]) => (
        <option key={k} value={k}>
          {l}
        </option>
      ))}
    </>
  );
}

const BLANK_LINES = 3;

export default async function ClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const user = await requireUser(["ADMIN", "BILLER"]);
  const { id } = await params;
  const { error, ok } = await searchParams;
  const claim = await prisma.claim.findFirst({
    where: { id, practiceId: user.practiceId },
    include: {
      lines: { orderBy: { lineNumber: "asc" } },
      diagnoses: { orderBy: { sequence: "asc" } },
      insurance: true,
      payer: true,
      billingProvider: true,
      renderingProvider: true,
      patient: { include: { insurances: { include: { payer: true } } } },
      encounter: { include: { provider: true } },
      applications: { include: { deposit: true }, orderBy: { postedAt: "desc" } },
      events: { include: { user: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!claim) notFound();
  if (claim.patientId) await requireChartAccess(user, claim.patientId, `/billing/claims/${id}`);

  const [billingProviders, providers, locations, deposits, related] = await Promise.all([
    prisma.billingProvider.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: { name: "asc" } }),
    prisma.renderingProvider.findMany({ where: { practiceId: user.practiceId, status: "ACTIVE" }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" } }),
    prisma.deposit.findMany({ where: { practiceId: user.practiceId, unappliedCents: { gt: 0 } }, orderBy: { postedAt: "desc" } }),
    prisma.claim.findMany({
      where: { encounterId: claim.encounterId, id: { not: claim.id } },
      orderBy: { createdAt: "asc" },
      select: { id: true, payerRank: true, status: true, frequencyCode: true, createdAt: true },
    }),
  ]);

  const denialData = await loadDenialPanel(claim.id, user.practiceId);
  const nav = await claimNeighbours(user.practiceId, claim);
  const lastSaved = claim.events[0] ?? null;
  const editable = EDITABLE_CLAIM_STATUSES.includes(claim.status);
  const edits = claimEdits(claim, await claimRuleOptions(user.practiceId, claim));
  const errors = edits.filter((e) => e.severity === "error");
  const warnings = edits.filter((e) => e.severity === "warning");
  const balance = claim.billedCents - claim.paidCents - claim.adjustedCents;
  const lineRows = Math.min(claim.lines.length + (editable ? BLANK_LINES : 0), MAX_CLAIM_LINES);
  const renderers = providers.filter((p) => p.isRendering);
  const referrers = providers.filter((p) => p.isReferring);
  const supervisors = providers.filter((p) => p.isSupervising);

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href={`/billing/claims?bucket=${claim.status}`}>« Claims dashboard</Link> · Visit <Link href={`/encounters/${claim.encounterId}`}>{formatDate(claim.encounter.date)}</Link> ·{" "}
            {visitBillingStatusLabel[claim.encounter.billingStatus] ?? claim.encounter.billingStatus}
          </p>
          <h1>
            {claimNumber(claim)}{" "}
            <span className={`gw-tag gw-tag-${claimStatusTone(claim.status)}`}>{claimStatusLabel[claim.status] ?? claim.status}</span>
          </h1>
          <p className="chart-meta">
            <span>
              <Link href={`/patients/${claim.patientId}`}>{patientName(claim.patient)}</Link> · {claim.patient.mrn}
            </span>
            <span>
              {payerRankLabel[claim.payerRank]}: {claim.payerName}
              {claim.payer?.payerCode ? ` (${claim.payer.payerCode})` : ""}
            </span>
            <span>Frequency {claimFrequencyLabel[claim.frequencyCode] ?? claim.frequencyCode}</span>
            {claim.clearinghouseClaimId && <span>CH ID {claim.clearinghouseClaimId}</span>}
          </p>
        </div>
        <div className="gw-actions">
          <a className="btn secondary" href={`/api/claims/${claim.id}/cms1500`} target="_blank" rel="noopener">
            CMS-1500 PDF
          </a>
          <a className="btn ghost" href={`/api/claims/${claim.id}/cms1500?form=0`} target="_blank" rel="noopener" title="For pre-printed red forms">
            Data only
          </a>
          <Link className="btn ghost" href={`/billing/claim/${claim.id}/print`}>
            Summary
          </Link>
          {["DRAFT", "READY", "EDI_REJECTED"].includes(claim.status) && (
            <form action={submitClaim.bind(null, claim.id, null)}>
              <button className="btn" type="submit" disabled={errors.length > 0}>
                {claim.status === "EDI_REJECTED" ? "Resubmit to clearinghouse" : "Submit claim"}
              </button>
            </form>
          )}
          {["DRAFT", "READY", "EDI_REJECTED"].includes(claim.status) && (nav.next ?? nav.previous) && (
            <form action={submitClaim.bind(null, claim.id, nav.next ?? nav.previous)}>
              <button className="btn secondary" type="submit" disabled={errors.length > 0} title="Submit this claim and open the next one in the same list">
                Submit and next
              </button>
            </form>
          )}
          {claim.status === "HOLD" && (
            <form action={releaseClaim.bind(null, claim.id)}>
              <button className="btn secondary" type="submit">
                Release hold
              </button>
            </form>
          )}
          {["DENIED", "APPEAL"].includes(claim.status) && (
            <form action={resubmitDenied.bind(null, claim.id)}>
              <button className="btn secondary" type="submit">
                Resubmit (same claim)
              </button>
            </form>
          )}
        </div>
      </div>

      <section className="panel cd-strip">
        <div>
          <span>Status</span>
          <strong>{claimStatusLabel[claim.status] ?? claim.status}</strong>
        </div>
        <div>
          <span>Outstanding balance</span>
          <strong>{formatMoney(balance)}</strong>
        </div>
        <div>
          <span>Billed · paid · adjusted</span>
          <strong>
            {formatMoney(claim.billedCents)} · {formatMoney(claim.paidCents)} · {formatMoney(claim.adjustedCents)}
          </strong>
        </div>
        <div>
          <span>Created</span>
          <strong>{formatDate(claim.createdAt)}</strong>
        </div>
        <div>
          <span>Last saved</span>
          <strong>{lastSaved ? `${lastSaved.user?.name ?? "System"} · ${formatDate(lastSaved.createdAt)}` : "—"}</strong>
        </div>
        <nav className="cd-prevnext" aria-label="Claims in this list">
          {nav.previous ? (
            <Link className="btn secondary gw-mini" href={`/billing/claims/${nav.previous}`}>
              ‹ Previous
            </Link>
          ) : (
            <span className="btn secondary gw-mini cd-disabled">‹ Previous</span>
          )}
          <span className="muted">
            {nav.position} of {nav.total} {claimStatusLabel[claim.status]?.toLowerCase()}
          </span>
          {nav.next ? (
            <Link className="btn secondary gw-mini" href={`/billing/claims/${nav.next}`}>
              Next ›
            </Link>
          ) : (
            <span className="btn secondary gw-mini cd-disabled">Next ›</span>
          )}
        </nav>
      </section>

      {error && (
        <p className="gw-error" role="alert">
          {error}
        </p>
      )}
      {ok && <p className="notice-ok">{ok}</p>}

      {related.length > 0 && (
        <p className="muted">
          Other claims for this visit:{" "}
          {related.map((r) => (
            <Link key={r.id} href={`/billing/claims/${r.id}`} className={`gw-tag gw-tag-${claimStatusTone(r.status)}`}>
              {payerRankLabel[r.payerRank]} · {claimStatusLabel[r.status]}
              {r.frequencyCode !== "1" ? ` · freq ${r.frequencyCode}` : ""}
            </Link>
          ))}
        </p>
      )}

      {/* ---------------- Claim edits ---------------- */}
      {editable && (
        <section className={`panel ${errors.length ? "vw-query" : "gw-handoff"}`}>
          <strong>{errors.length ? `${errors.length} claim edit(s) to fix before submitting` : "Claim passes all edits"}</strong>
          {edits.length > 0 && (
            <ul className="cl-edits">
              {errors.map((e, i) => (
                <li key={`e${i}`} className="cl-error">
                  {e.message}
                </li>
              ))}
              {warnings.map((e, i) => (
                <li key={`w${i}`} className="cl-warn">
                  {e.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {claim.status === "EDI_REJECTED" && claim.rejectionReason && (
        <section className="panel vw-query">
          <strong>Clearinghouse rejection</strong>
          <p>{claim.rejectionReason}</p>
        </section>
      )}

      <DenialPanel {...denialData} payerFax={claim.payer?.fax ?? null} />

      {/* ---------------- The claim form ---------------- */}
      <form action={saveClaim.bind(null, claim.id)} className="stack">
        <input type="hidden" name="lineRows" value={lineRows} />
        <fieldset className="stack gw-fieldset" disabled={!editable}>
          <section className="panel">
            <h2>Insurance &amp; claim</h2>
            <div className="form-grid gw-grid-3">
              <label>
                Insurance (box 1a / 11)
                <select name="insuranceId" defaultValue={claim.insuranceId ?? ""}>
                  <option value="">—</option>
                  {claim.patient.insurances.map((i) => (
                    <option key={i.id} value={i.id}>
                      {payerRankLabel[i.rank] ?? i.rank}: {i.payer.name} · {i.memberId}
                      {i.active ? "" : " (inactive)"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Claim frequency (box 22)
                <select name="frequencyCode" defaultValue={claim.frequencyCode}>
                  <Opt labels={claimFrequencyLabel} />
                </select>
              </label>
              <label>
                Payer original claim # (box 22)
                <input name="originalReference" defaultValue={claim.originalReference ?? ""} />
              </label>
              <label>
                Default place of service
                <select name="placeOfService" defaultValue={claim.placeOfService ?? "11"}>
                  <Opt labels={placeOfServiceLabel} />
                </select>
              </label>
              <label>
                Patient account # (box 26)
                <input name="patientAccountNumber" defaultValue={claim.patientAccountNumber ?? ""} />
              </label>
              <label className="checkbox-inline">
                <input type="checkbox" name="acceptAssignment" defaultChecked={claim.acceptAssignment} /> Accept assignment (box 27)
              </label>
            </div>
          </section>

          <section className="panel">
            <h2>Providers &amp; facility</h2>
            <div className="form-grid gw-grid-3">
              <label>
                Billing provider (box 33)
                <select name="billingProviderId" defaultValue={claim.billingProviderId ?? ""}>
                  <option value="">—</option>
                  {billingProviders.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.npi ? ` · NPI ${b.npi}` : " · no NPI"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Rendering provider (box 24J)
                <select name="renderingProviderId" defaultValue={claim.renderingProviderId ?? ""}>
                  <option value="">— Same as billing —</option>
                  {renderers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.npi ? ` · ${p.npi}` : " · no NPI"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Service facility (box 32)
                <select name="serviceLocationId" defaultValue={claim.serviceLocationId ?? ""}>
                  <option value="">— Same as billing —</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Referring provider (box 17 · DN)
                <select name="referringProviderId" defaultValue={claim.referringProviderId ?? ""}>
                  <option value="">—</option>
                  {referrers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.npi ? ` · ${p.npi}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Supervising provider (box 17 · DQ)
                <select name="supervisingProviderId" defaultValue={claim.supervisingProviderId ?? ""}>
                  <option value="">—</option>
                  {supervisors.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.npi ? ` · ${p.npi}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Ordering provider (box 17 · DK)
                <select name="orderingProviderId" defaultValue={claim.orderingProviderId ?? ""}>
                  <option value="">—</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.npi ? ` · ${p.npi}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="panel">
            <h2>Diagnosis codes (box 21 · A–L)</h2>
            <div className="cl-dx-grid">
              {Array.from({ length: MAX_CLAIM_DIAGNOSES }, (_, i) => {
                const dx = claim.diagnoses[i];
                return (
                  <label key={i} className="cl-dx">
                    <span className="cl-dx-letter">{DX_LETTERS[i]}</span>
                    <input name={`dx_${i}`} defaultValue={dx?.icd10 ?? ""} placeholder="ICD-10" className="cl-code" />
                    <input name={`dxd_${i}`} defaultValue={dx?.description ?? ""} placeholder="Description" />
                  </label>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <h2>Service lines (box 24)</h2>
            <div className="cl-lines-wrap">
              <table className="cl-lines">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>DOS from</th>
                    <th>DOS to</th>
                    <th>POS</th>
                    <th>EMG</th>
                    <th>CPT / HCPCS</th>
                    <th colSpan={4}>Modifiers</th>
                    <th>Dx ptr</th>
                    <th>Units</th>
                    <th>Charge $</th>
                    <th>NDC · qty · unit</th>
                    <th>Line note</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: lineRows }, (_, i) => {
                    const l = claim.lines[i];
                    const mods = (l?.modifiers ?? "").split(",");
                    return (
                      <tr key={i}>
                        <td>
                          {i + 1}
                          {l?.chargeId && <input type="hidden" name={`l_${i}_chargeId`} value={l.chargeId} />}
                        </td>
                        <td>
                          <input type="date" name={`l_${i}_from`} defaultValue={d(l?.dosFrom ?? (i === claim.lines.length ? claim.lines[0]?.dosFrom : null))} />
                        </td>
                        <td>
                          <input type="date" name={`l_${i}_to`} defaultValue={d(l?.dosTo)} />
                        </td>
                        <td>
                          <select name={`l_${i}_pos`} defaultValue={l?.placeOfService ?? claim.placeOfService ?? "11"} className="cl-pos">
                            {Object.keys(placeOfServiceLabel).map((k) => (
                              <option key={k} value={k}>
                                {k}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input type="checkbox" name={`l_${i}_emg`} defaultChecked={l?.emergency ?? false} />
                        </td>
                        <td>
                          <input name={`l_${i}_cpt`} defaultValue={l?.cptCode ?? ""} className="cl-code" />
                        </td>
                        {[0, 1, 2, 3].map((m) => (
                          <td key={m}>
                            <input name={`l_${i}_m${m + 1}`} defaultValue={mods[m] ?? ""} className="cl-mod" maxLength={2} />
                          </td>
                        ))}
                        <td>
                          <input name={`l_${i}_ptr`} defaultValue={l?.pointers ?? ""} className="cl-ptr" placeholder="A,B" />
                        </td>
                        <td>
                          <input name={`l_${i}_units`} defaultValue={l?.units ?? 1} className="cl-units" inputMode="decimal" />
                        </td>
                        <td>
                          <input
                            name={`l_${i}_charge`}
                            defaultValue={l ? (l.chargeCents / 100).toFixed(2) : ""}
                            className="cl-money"
                            inputMode="decimal"
                          />
                        </td>
                        <td className="cl-ndc">
                          <input name={`l_${i}_ndc`} defaultValue={l?.ndcCode ?? ""} placeholder="NDC" />
                          <input name={`l_${i}_ndcqty`} defaultValue={l?.ndcQuantity ?? ""} placeholder="qty" className="cl-units" />
                          <select name={`l_${i}_ndcunit`} defaultValue={l?.ndcUnit ?? ""}>
                            <option value="" />
                            <option value="UN">UN</option>
                            <option value="ML">ML</option>
                            <option value="GR">GR</option>
                            <option value="F2">F2</option>
                            <option value="ME">ME</option>
                          </select>
                        </td>
                        <td>
                          <input name={`l_${i}_note`} defaultValue={l?.lineNote ?? ""} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={12} style={{ textAlign: "right" }}>
                      <strong>Total charges (box 28)</strong>
                    </td>
                    <td colSpan={3}>
                      <strong>{formatMoney(claim.billedCents)}</strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {editable && <p className="muted">Blank rows are ignored. Pointers use the letters above (up to 4 per line).</p>}
          </section>

          <section className="panel">
            <h2>Claim information (boxes 10–23)</h2>
            <div className="form-grid gw-grid-3">
              <label className="checkbox-inline">
                <input type="checkbox" name="employmentRelated" defaultChecked={claim.employmentRelated} /> Employment related (10a)
              </label>
              <span className="cl-inline">
                <label className="checkbox-inline">
                  <input type="checkbox" name="autoAccident" defaultChecked={claim.autoAccident} /> Auto accident (10b)
                </label>
                <select name="autoAccidentState" defaultValue={claim.autoAccidentState ?? ""} aria-label="Accident state">
                  <option value="">State</option>
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </span>
              <label className="checkbox-inline">
                <input type="checkbox" name="otherAccident" defaultChecked={claim.otherAccident} /> Other accident (10c)
              </label>
              <label>
                Onset of current illness (14)
                <input type="date" name="onsetDate" defaultValue={d(claim.onsetDate)} />
              </label>
              <label>
                Initial treatment / other date (15)
                <input type="date" name="initialTreatmentDate" defaultValue={d(claim.initialTreatmentDate)} />
              </label>
              <span />
              <label>
                Unable to work from (16)
                <input type="date" name="unableToWorkFrom" defaultValue={d(claim.unableToWorkFrom)} />
              </label>
              <label>
                Unable to work to (16)
                <input type="date" name="unableToWorkTo" defaultValue={d(claim.unableToWorkTo)} />
              </label>
              <span />
              <label>
                Hospitalization from (18)
                <input type="date" name="hospitalFrom" defaultValue={d(claim.hospitalFrom)} />
              </label>
              <label>
                Hospitalization to (18)
                <input type="date" name="hospitalTo" defaultValue={d(claim.hospitalTo)} />
              </label>
              <span />
              <span className="cl-inline">
                <label className="checkbox-inline">
                  <input type="checkbox" name="outsideLab" defaultChecked={claim.outsideLab} /> Outside lab (20)
                </label>
                <input
                  name="outsideLabCharges"
                  defaultValue={claim.outsideLabChargesCents != null ? (claim.outsideLabChargesCents / 100).toFixed(2) : ""}
                  placeholder="$ charges"
                  className="cl-money"
                />
              </span>
              <label>
                Prior authorization # (23)
                <input name="priorAuthNumber" defaultValue={claim.priorAuthNumber ?? ""} />
              </label>
              <label>
                Referral #
                <input name="referralNumber" defaultValue={claim.referralNumber ?? ""} />
              </label>
              <label>
                CLIA # (23)
                <input name="cliaNumber" defaultValue={claim.cliaNumber ?? ""} />
              </label>
              <label>
                Delay reason code
                <select name="delayReasonCode" defaultValue={claim.delayReasonCode ?? ""}>
                  <option value="">—</option>
                  <Opt labels={delayReasonLabel} />
                </select>
              </label>
              <span />
              <label className="gw-span-3">
                Additional claim information (box 19)
                <input name="claimNote" defaultValue={claim.claimNote ?? ""} maxLength={80} />
              </label>
            </div>
          </section>

          {editable && (
            <div className="form-actions">
              <button className="btn" type="submit">
                Save claim &amp; run edits
              </button>
            </div>
          )}
        </fieldset>
      </form>

      {editable && ["DRAFT", "READY", "EDI_REJECTED"].includes(claim.status) && (
        <details className="gw-inline-form">
          <summary>Put claim on hold</summary>
          <form action={holdClaim.bind(null, claim.id)}>
            <input name="note" required placeholder="Reason (e.g. waiting on referral, coding review)" />
            <button className="btn secondary" type="submit">
              Hold
            </button>
          </form>
        </details>
      )}

      {/* ---------------- After submission ---------------- */}
      {!editable && claim.status !== "VOID" && (
        <div className="two-col">
          <section className="panel">
            <h2>Payments</h2>
            <div className="gw-facts">
              <div>
                <span>Billed</span>
                {formatMoney(claim.billedCents)}
              </div>
              <div>
                <span>Paid</span>
                {formatMoney(claim.paidCents)}
              </div>
              <div>
                <span>Adjusted</span>
                {formatMoney(claim.adjustedCents)}
              </div>
              <div>
                <span>Balance</span>
                {formatMoney(balance)}
              </div>
              <div>
                <span>Balance responsibility</span>
                {claim.balanceResponsibility === "PATIENT" ? "Patient" : "Insurance"}
              </div>
            </div>
            {deposits.length > 0 ? (
              <form action={applyPayment.bind(null, claim.id)} className="form-grid">
                <label>
                  From deposit
                  <select name="depositId">
                    {deposits.map((dep) => (
                      <option key={dep.id} value={dep.id}>
                        {dep.payerName} · {formatMoney(dep.unappliedCents)} unapplied
                        {dep.checkNumber ? ` · #${dep.checkNumber}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Amount $
                  <input name="amount" inputMode="decimal" required />
                </label>
                <label>
                  Type
                  <select name="type" defaultValue="PAYMENT">
                    <option value="PAYMENT">Payment</option>
                    <option value="ADJUSTMENT">Adjustment / write-off</option>
                  </select>
                </label>
                <button className="btn secondary" type="submit">
                  Post
                </button>
              </form>
            ) : (
              <p className="muted">
                Record a deposit on the <Link href="/billing?tab=deposits">Deposits</Link> tab to post payments.
              </p>
            )}
            {balance > 0 && (
              <form action={setBalanceResponsibility.bind(null, claim.id)} style={{ marginTop: "0.6rem" }}>
                <input type="hidden" name="value" value={claim.balanceResponsibility === "PATIENT" ? "INSURANCE" : "PATIENT"} />
                <button className="btn ghost" type="submit">
                  Shift balance to {claim.balanceResponsibility === "PATIENT" ? "insurance" : "patient"}
                </button>
              </form>
            )}
            <ul className="gw-timeline" style={{ marginTop: "0.8rem" }}>
              {claim.applications.map((a) => (
                <li key={a.id}>
                  <span className="muted">
                    {formatDate(a.postedAt)} · {a.deposit.payerName}
                    {a.deposit.checkNumber ? ` #${a.deposit.checkNumber}` : ""}
                  </span>
                  <div>
                    {a.type === "ADJUSTMENT" ? "Adjustment" : "Payment"} {formatMoney(a.amountCents)}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <h2>Payer outcome &amp; corrections</h2>
            <form action={setClaimStatus.bind(null, claim.id)} className="form-grid">
              <label>
                Record status
                <select name="status" defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  <option value="ACCEPTED">Accepted by payer</option>
                  <option value="DENIED">Denied</option>
                  <option value="APPEAL">Under appeal</option>
                  <option value="DELINQUENT">Delinquent</option>
                  <option value="IN_COLLECTION">In collection</option>
                  <option value="WRITTEN_OFF">Written off</option>
                </select>
              </label>
              <label>
                Denial reason code (from the EOB)
                <select name="denialCode" defaultValue="">
                  <option value="">— none / not a denial —</option>
                  {denialCodeOptions().map((g) => (
                    <optgroup key={g.category} label={g.label}>
                      {g.codes.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} · {c.text}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label>
                Reason / note
                <input name="note" placeholder="Denial reason, appeal ref…" />
              </label>
              <button className="btn secondary" type="submit">
                Save status
              </button>
            </form>
            {claim.denialReason && (
              <p>
                <strong>Denial reason:</strong> {claim.denialReason}
              </p>
            )}
            <div className="gw-actions" style={{ marginTop: "0.8rem" }}>
              <form action={correctClaim.bind(null, claim.id, "7")}>
                <button className="btn secondary" type="submit">
                  Create corrected claim (7)
                </button>
              </form>
              <form action={correctClaim.bind(null, claim.id, "8")}>
                <button className="btn ghost" type="submit">
                  Void claim (8)
                </button>
              </form>
            </div>
            <p className="muted">
              A corrected or void claim copies this one with the payer&apos;s claim number in box 22 and voids this copy.
            </p>
          </section>
        </div>
      )}

      {/* ---------------- Change log ---------------- */}
      <section className="panel">
        <h2>Claim log</h2>
        <table className="cl-log">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Field</th>
              <th>Old value</th>
              <th>New value</th>
            </tr>
          </thead>
          <tbody>
            {claim.events.map((ev) => (
              <tr key={ev.id}>
                <td>{formatDate(ev.createdAt)}</td>
                <td>{ev.user?.name ?? "System"}</td>
                <td>
                  {ev.action.replaceAll("_", " ").toLowerCase()}
                  {ev.note && <div className="muted">{ev.note}</div>}
                </td>
                <td>{ev.field ?? ""}</td>
                <td className="cl-val">{ev.oldValue ?? ""}</td>
                <td className="cl-val">{ev.newValue ?? ""}</td>
              </tr>
            ))}
            {claim.events.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No changes yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
