import Link from "next/link";
import {
  applyDeposit,
  createDeposit,
  denyClaim,
  resubmitClaim,
  setBalanceResponsibility,
  setClaimStatus,
  submitClaim,
} from "@/app/actions";
import { StatusBadge } from "@/components/StatusBadge";
import { prisma } from "@/lib/prisma";
import { agingBucket, balanceResponsibilityLabel, depositPayerTypeLabel, formatMoney, patientName } from "@/lib/format";
import { requireUser } from "@/lib/auth";

const AGING_BUCKETS = ["0-30 days", "31-60 days", "61-90 days", "90+ days"] as const;

export default async function BillingPage() {
  const user = await requireUser(["ADMIN", "BILLER"]);
  const charges = await prisma.charge.findMany({
    where: { practiceId: user.practiceId },
    include: {
      claim: true,
      encounter: { include: { patient: true, provider: true } },
    },
    orderBy: { encounter: { date: "desc" } },
  });

  const deposits = await prisma.deposit.findMany({
    where: { practiceId: user.practiceId },
    orderBy: { postedAt: "desc" },
  });
  const unappliedDeposits = deposits.filter((d) => d.unappliedCents > 0);

  const billed = charges.reduce((s, c) => s + c.amountCents, 0);
  const paid = charges.reduce((s, c) => s + (c.claim?.paidCents ?? 0), 0);
  const adjusted = charges.reduce((s, c) => s + (c.claim?.adjustedCents ?? 0), 0);
  const denied = charges.filter((c) => c.claim?.status === "DENIED").length;
  const ediRejected = charges.filter((c) => c.claim?.status === "EDI_REJECTED").length;

  const now = Date.now();
  const aging = new Map<string, number>();
  for (const bucket of AGING_BUCKETS) aging.set(bucket, 0);

  for (const c of charges) {
    const claim = c.claim;
    if (!claim || !claim.submittedAt) continue;
    if (claim.status === "PAID") continue;
    const balanceCents = claim.billedCents - claim.paidCents - claim.adjustedCents;
    if (balanceCents <= 0) continue;
    const days = Math.floor((now - claim.submittedAt.getTime()) / (1000 * 60 * 60 * 24));
    const bucket = agingBucket(days);
    aging.set(bucket, (aging.get(bucket) ?? 0) + balanceCents);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Practice management</p>
          <h1>Revenue cycle</h1>
        </div>
      </div>

      <section className="grid-stats">
        <div className="stat">
          <span>Charges</span>
          <strong>{charges.length}</strong>
        </div>
        <div className="stat">
          <span>Billed</span>
          <strong>{formatMoney(billed)}</strong>
        </div>
        <div className="stat">
          <span>Collected</span>
          <strong>{formatMoney(paid)}</strong>
        </div>
        <div className="stat">
          <span>Open AR</span>
          <strong>{formatMoney(billed - paid - adjusted)}</strong>
        </div>
      </section>

      <div className="two-col" style={{ marginBottom: "1.25rem" }}>
        <section className="panel">
          <h2>AR aging</h2>
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
        </section>
        <section className="panel">
          <h2>Denials &amp; EDI rejections</h2>
          <div className="grid-stats" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 0 }}>
            <div className="stat">
              <span>Payer denials</span>
              <strong>{denied}</strong>
            </div>
            <div className="stat">
              <span>EDI rejections</span>
              <strong>{ediRejected}</strong>
            </div>
          </div>
          <p className="muted">
            EDI rejections happen at the clearinghouse before a payer ever sees the claim (bad NPI, invalid
            diagnosis pointer, etc.) — fix and resubmit. Denials happen after a payer adjudicates the claim.
          </p>
        </section>
      </div>

      <div className="two-col" style={{ marginBottom: "1.25rem" }}>
        <section className="panel">
          <h2>Record deposit</h2>
          <p className="muted">
            Record a lump-sum receipt from a payer or patient, then apply portions of it to individual claims below.
          </p>
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
        </section>
        <section className="panel">
          <h2>Deposits</h2>
          <table>
            <thead>
              <tr>
                <th>Payer</th>
                <th>Total</th>
                <th>Unapplied</th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.payerName}
                    <div className="muted">
                      {depositPayerTypeLabel[d.payerType] ?? d.payerType} · {d.paymentMethod}
                      {d.checkNumber ? ` #${d.checkNumber}` : ""}
                    </div>
                  </td>
                  <td>{formatMoney(d.totalCents)}</td>
                  <td>{formatMoney(d.unappliedCents)}</td>
                </tr>
              ))}
              {deposits.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    No deposits recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>

      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>Patient</th>
              <th>CPT / Mod</th>
              <th>Payer / claim</th>
              <th>Amount</th>
              <th>Balance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {charges.map((c) => {
              const claim = c.claim;
              const balanceCents = claim ? claim.billedCents - claim.paidCents - claim.adjustedCents : c.amountCents;

              return (
                <tr key={c.id}>
                  <td>
                    <Link href={`/patients/${c.encounter.patientId}/statement`}>
                      {patientName(c.encounter.patient)}
                    </Link>
                    <div className="muted">{c.encounter.provider.name}</div>
                  </td>
                  <td>
                    {c.cptCode}
                    <div className="muted">{c.modifiers ?? ""}</div>
                  </td>
                  <td>
                    {claim ? (
                      <>
                        {claim.payerName} <StatusBadge value={claim.status} />
                        {claim.attempt > 1 && <div className="muted">Attempt {claim.attempt}</div>}
                        {balanceCents > 0 && (
                          <div className="muted">
                            Responsibility: {balanceResponsibilityLabel[claim.balanceResponsibility] ?? claim.balanceResponsibility}
                          </div>
                        )}
                        {claim.status === "DENIED" && claim.denialReason && (
                          <div className="muted">Reason: {claim.denialReason}</div>
                        )}
                        {claim.status === "EDI_REJECTED" && claim.rejectionReason && (
                          <div className="muted">Clearinghouse: {claim.rejectionReason}</div>
                        )}
                        {(claim.status === "DELINQUENT" || claim.status === "IN_COLLECTION" || claim.status === "APPEAL") &&
                          claim.statusNote && <div className="muted">Note: {claim.statusNote}</div>}
                        {claim.clearinghouseClaimId && (
                          <div className="muted">CH ID: {claim.clearinghouseClaimId}</div>
                        )}
                      </>
                    ) : (
                      "No claim"
                    )}
                  </td>
                  <td>{formatMoney(c.amountCents)}</td>
                  <td>{formatMoney(Math.max(balanceCents, 0))}</td>
                  <td>
                    <div className="stack">
                      {!claim && (
                        <form action={submitClaim.bind(null, c.id)}>
                          <button className="btn" type="submit">
                            Submit claim
                          </button>
                        </form>
                      )}

                      {claim &&
                        ["SUBMITTED", "PARTIAL", "DELINQUENT", "IN_COLLECTION", "APPEAL"].includes(claim.status) && (
                          <>
                            {unappliedDeposits.length > 0 ? (
                              <form className="stack" action={applyDeposit.bind(null, unappliedDeposits[0].id, claim.id)}>
                                <label>
                                  Apply from deposit
                                  <select name="depositId" defaultValue={unappliedDeposits[0].id} disabled>
                                    <option value={unappliedDeposits[0].id}>
                                      {unappliedDeposits[0].payerName} ({formatMoney(unappliedDeposits[0].unappliedCents)}{" "}
                                      unapplied)
                                    </option>
                                  </select>
                                </label>
                                <label>
                                  Amount (USD)
                                  <input name="amount" type="number" step="0.01" required />
                                </label>
                                <label>
                                  Type
                                  <select name="type" defaultValue="PAYMENT">
                                    <option value="PAYMENT">Payment</option>
                                    <option value="ADJUSTMENT">Adjustment / write-off</option>
                                  </select>
                                </label>
                                <button className="btn secondary" type="submit">
                                  Apply deposit
                                </button>
                              </form>
                            ) : (
                              <p className="muted">Record a deposit above to apply payments.</p>
                            )}
                            <form action={denyClaim.bind(null, claim.id)} className="stack">
                              <label>
                                Denial reason
                                <input name="reason" placeholder="Missing auth, timely filing, ..." />
                              </label>
                              <button className="btn ghost" type="submit">
                                Mark denied
                              </button>
                            </form>
                            {claim.status !== "DELINQUENT" && (
                              <form action={setClaimStatus.bind(null, claim.id, "DELINQUENT")}>
                                <button className="btn ghost" type="submit">
                                  Mark delinquent
                                </button>
                              </form>
                            )}
                            {claim.status !== "IN_COLLECTION" && (
                              <form action={setClaimStatus.bind(null, claim.id, "IN_COLLECTION")}>
                                <button className="btn ghost" type="submit">
                                  Send to collections
                                </button>
                              </form>
                            )}
                            {claim.status !== "APPEAL" && (
                              <form action={setClaimStatus.bind(null, claim.id, "APPEAL")}>
                                <button className="btn ghost" type="submit">
                                  Under appeal
                                </button>
                              </form>
                            )}
                            {balanceCents > 0 && (
                              <form
                                action={setBalanceResponsibility.bind(
                                  null,
                                  claim.id,
                                  claim.balanceResponsibility === "PATIENT" ? "INSURANCE" : "PATIENT"
                                )}
                              >
                                <button className="btn ghost" type="submit">
                                  Shift responsibility to{" "}
                                  {claim.balanceResponsibility === "PATIENT" ? "insurance" : "patient"}
                                </button>
                              </form>
                            )}
                          </>
                        )}

                      {claim && claim.status === "DENIED" && (
                        <form action={resubmitClaim.bind(null, claim.id)}>
                          <button className="btn" type="submit">
                            Resubmit claim
                          </button>
                        </form>
                      )}

                      {claim && claim.status === "EDI_REJECTED" && (
                        <form action={submitClaim.bind(null, c.id)}>
                          <button className="btn" type="submit">
                            Resubmit to clearinghouse
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
