import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney, formatTime, patientName } from "@/lib/format";
import { CHECKOUT_ROLES, PAY_METHODS, RECEIPT_KINDS, collectedFor, copayFor, patientCredit } from "@/lib/checkout";
import { patientBalance } from "@/lib/connect/payments";
import { applyCredit, collect, setCopay, voidPayment } from "./actions";

type Search = { appointmentId?: string; patientId?: string; receipt?: string; error?: string };

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(CHECKOUT_ROLES);
  const sp = await searchParams;
  const appt = sp.appointmentId
    ? await prisma.appointment.findFirst({ where: { id: sp.appointmentId, practiceId: user.practiceId }, include: { provider: true, location: true, encounter: true } })
    : null;
  const patientId = appt?.patientId ?? sp.patientId;
  if (!patientId) notFound();
  const patient = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId }, include: { insurances: { where: { active: true }, include: { payer: true } } } });
  if (!patient) notFound();
  const [copay, collected, credit, balance, receipts, elig] = await Promise.all([
    appt ? copayFor(appt.id) : Promise.resolve(null),
    appt ? collectedFor(appt.id) : Promise.resolve(null),
    patientCredit(patient.id),
    patientBalance(patient.id),
    prisma.receipt.findMany({ where: { patientId: patient.id }, orderBy: { createdAt: "desc" }, take: 15 }),
    appt ? prisma.eligibilityCheck.findFirst({ where: { patientId: patient.id }, orderBy: { checkedAt: "desc" } }) : Promise.resolve(null),
  ]);
  const copayLeft = copay?.cents !== null && copay?.cents !== undefined && collected ? Math.max(copay.cents - collected.copay, 0) : null;
  const suggested = copayLeft ? copayLeft : balance.totalCents - credit > 0 ? balance.totalCents - credit : 0;
  const back = appt ? `/checkout?appointmentId=${appt.id}` : `/checkout?patientId=${patient.id}`;
  const just = sp.receipt ? receipts.find((r) => r.id === sp.receipt) : undefined;

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            Front desk · <Link href={`/patients/${patient.id}`}>{patientName(patient)}</Link>
          </p>
          <h1>Check-out &amp; payment</h1>
          {appt && (
            <p className="muted" style={{ margin: 0 }}>
              Visit {formatDate(appt.startsAt)} {formatTime(appt.startsAt)} · {appt.provider.name} · {appt.location.name}
            </p>
          )}
        </div>
        {appt && (
          <Link className="btn ghost" href="/flow">
            Flow board
          </Link>
        )}
      </div>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {just && (
        <section className="panel cn-sent">
          <div>
            <h2>
              Collected {formatMoney(just.amountCents)} — receipt {just.number}
            </h2>
            <a className="btn secondary" href={`/api/receipts/${just.id}`} target="_blank" rel="noreferrer">
              Print receipt
            </a>
          </div>
        </section>
      )}
      <section className="grid-stats">
        {appt && (
          <div className="stat">
            <span>Copay for this visit</span>
            <strong>{copay?.cents !== null && copay?.cents !== undefined ? formatMoney(copay.cents) : "—"}</strong>
            <span className="muted cn-small">{copay?.source}</span>
          </div>
        )}
        {appt && (
          <div className="stat">
            <span>Copay collected</span>
            <strong>{formatMoney(collected?.copay ?? 0)}</strong>
          </div>
        )}
        <div className="stat">
          <span>Patient balance (after insurance)</span>
          <strong>{formatMoney(balance.totalCents)}</strong>
        </div>
        <div className="stat">
          <span>Unapplied credit on file</span>
          <strong>{formatMoney(credit)}</strong>
        </div>
      </section>
      <div className="two-col">
        <section className="panel">
          <h2>Collect a payment</h2>
          <form action={collect} className="form-grid gw-grid-3">
            {appt && <input type="hidden" name="appointmentId" value={appt.id} />}
            <input type="hidden" name="patientId" value={patient.id} />
            <label>
              Amount
              <input name="amount" inputMode="decimal" required defaultValue={suggested ? (suggested / 100).toFixed(2) : ""} />
            </label>
            <label>
              For
              <select name="kind" defaultValue={copayLeft ? "COPAY" : balance.totalCents ? "BALANCE" : "PREPAY"}>
                {Object.entries(RECEIPT_KINDS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Paid by
              <select name="method" defaultValue="CARD">
                {Object.entries(PAY_METHODS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Check # / card approval code
              <input name="reference" />
            </label>
            <label className="gw-span-2">
              Note
              <input name="note" />
            </label>
            <button className="btn" type="submit">
              Collect &amp; print receipt
            </button>
          </form>
          <p className="muted cn-small">
            Card payments are run on the practice&apos;s card terminal; CareHub records them (no card numbers are entered here). Copays and prepayments stay as credit
            and apply automatically once insurance processes the visit.
          </p>
          {appt && (
            <form action={setCopay.bind(null, appt.id)} className="cn-inline">
              <label className="checkbox-inline">
                Copay for this visit $ <input name="copay" inputMode="decimal" defaultValue={appt.copayDueCents !== null ? (appt.copayDueCents / 100).toFixed(2) : ""} style={{ width: "6rem" }} />
              </label>
              <button className="btn ghost gw-mini" type="submit">
                Set
              </button>
              {elig && (
                <span className="muted cn-small">
                  Eligibility {formatDate(elig.checkedAt)}: {elig.status.toLowerCase()}
                  {elig.planName ? ` · ${elig.planName}` : ""}
                </span>
              )}
            </form>
          )}
        </section>
        <div className="stack">
          <section className="panel">
            <h2>What the patient owes</h2>
            {balance.items.length === 0 ? (
              <p className="muted">No balance after insurance.</p>
            ) : (
              <ul className="pd-list">
                {balance.items.map((i) => (
                  <li key={i.claimId}>
                    <span>Visit {formatDate(i.date)}</span>
                    <span className="muted">{i.number}</span>
                    <span>{formatMoney(i.dueCents)}</span>
                  </li>
                ))}
              </ul>
            )}
            {credit > 0 && balance.totalCents > 0 && (
              <form action={applyCredit.bind(null, patient.id)}>
                <input type="hidden" name="back" value={back} />
                <button className="btn secondary gw-mini" type="submit">
                  Apply {formatMoney(Math.min(credit, balance.totalCents))} credit to the balance
                </button>
              </form>
            )}
          </section>
          <section className="panel">
            <h2>Recent receipts</h2>
            {receipts.length === 0 ? (
              <p className="muted">None.</p>
            ) : (
              <table className="cn-table">
                <tbody>
                  {receipts.map((r) => (
                    <tr key={r.id} className={r.voidedAt ? "muted" : ""}>
                      <td>
                        {formatDate(r.createdAt)}
                        <div className="muted cn-small">{r.number}</div>
                      </td>
                      <td>
                        {RECEIPT_KINDS[r.kind]} · {PAY_METHODS[r.method]?.split(" ")[0]}
                        {r.voidedAt && <div className="gw-missing cn-small">VOID — {r.voidReason}</div>}
                      </td>
                      <td>{formatMoney(r.amountCents)}</td>
                      <td className="cn-actions">
                        <a className="btn ghost gw-mini" href={`/api/receipts/${r.id}`} target="_blank" rel="noreferrer">
                          Receipt
                        </a>
                        {!r.voidedAt && (
                          <form action={voidPayment.bind(null, r.id)}>
                            <input type="hidden" name="back" value={back} />
                            <button className="btn ghost gw-mini" type="submit">
                              Void
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
