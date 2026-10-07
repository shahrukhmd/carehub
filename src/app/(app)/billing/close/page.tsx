import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { can, rolesFor } from "@/lib/permissions";
import { formatDate, formatMoney } from "@/lib/format";
import { DEPOSIT_STATUSES, closeChecklist, currentPeriod, daySheet, periodLabel, periodSnapshot, previousPeriod } from "@/lib/period-close";
import { BillingTabs } from "../tabs";
import { SelectAll } from "@/components/SelectAll";
import { PrintButton } from "@/components/PrintButton";
import { closeMonth, depositSlip, importBankStatement, reopenMonth } from "./actions";

type Search = { tab?: string; period?: string; day?: string; ok?: string; error?: string };
const TABS: [string, string][] = [
  ["close", "Month close"],
  ["deposits", "Deposits & bank"],
  ["daysheet", "Cash day sheet"],
];

// Payment operations: close a month against a checklist and freeze its numbers; balance deposits to the bank
// statement; print the cash day sheet.
export default async function PeriodClosePage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(rolesFor("billing.work"));
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "close";
  const period = /^\d{4}-\d{2}$/.test(sp.period ?? "") ? sp.period! : previousPeriod(currentPeriod());
  const admin = can(user, "settings.admin");

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">Practice management · payments → deposits → bank → month end</p>
          <h1>Payment operations</h1>
        </div>
      </div>
      <BillingTabs active="close" />
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      <nav className="view-tabs" aria-label="Payment operations">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/billing/close?tab=${k}&period=${period}`} className={`view-tab${tab === k ? " active" : ""}`}>
            {l}
          </Link>
        ))}
      </nav>
      {tab === "close" && <CloseTab practiceId={user.practiceId} period={period} admin={admin} />}
      {tab === "deposits" && <DepositsTab practiceId={user.practiceId} />}
      {tab === "daysheet" && <DaySheetTab practiceId={user.practiceId} day={sp.day} />}
    </div>
  );
}

async function CloseTab({ practiceId, period, admin }: { practiceId: string; period: string; admin: boolean }) {
  const [checklist, snapshot, closes, settings] = await Promise.all([
    closeChecklist(practiceId, period),
    periodSnapshot(practiceId, period),
    prisma.periodClose.findMany({ where: { practiceId }, orderBy: { period: "desc" }, take: 24 }),
    prisma.practiceSettings.findUnique({ where: { practiceId }, select: { closedThrough: true } }),
  ]);
  const thisClose = closes.find((c) => c.period === period);
  const isClosed = Boolean(thisClose && !thisClose.reopenedAt);
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const Item = ({ n, label, href }: { n: number; label: string; href: string }) => (
    <li className={n ? "gw-tag gw-tag-warn" : "gw-tag gw-tag-ok"} style={{ display: "block", marginBottom: "0.3rem" }}>
      {n ? <Link href={href}>{n} {label}</Link> : <>0 {label}</>}
    </li>
  );
  return (
    <div className="two-col">
      <section className="panel stack">
        <form method="get" className="cn-inline">
          <input type="hidden" name="tab" value="close" />
          <select name="period" defaultValue={period} aria-label="Month">
            {months.map((m) => (
              <option key={m} value={m}>
                {periodLabel(m)}
              </option>
            ))}
          </select>
          <button className="btn secondary gw-mini" type="submit">
            Show
          </button>
          <span className="muted cn-small">Closed through: {settings?.closedThrough ? formatDate(settings.closedThrough) : "nothing closed yet"}</span>
        </form>
        <h2>
          {periodLabel(period)} {isClosed ? <span className="gw-tag gw-tag-ok">closed {thisClose?.closedAt ? formatDate(thisClose.closedAt) : ""}</span> : <span className="gw-tag gw-tag-warn">open</span>}
        </h2>
        <h3>Checklist</h3>
        <ul style={{ listStyle: "none", padding: 0 }}>
          <Item n={checklist.openDeposits.length} label="deposits not yet reconciled to the bank" href="/billing/close?tab=deposits" />
          <Item n={checklist.unappliedDeposits.length} label="deposits with unapplied money" href="/billing?tab=deposits" />
          <Item n={checklist.unpostedEras.length} label="ERA files with unposted claims" href="/billing?tab=era" />
          <Item n={checklist.unreleased.length} label="claims for the month still in the pre-release queue" href="/billing/claims/release" />
          <Item n={checklist.unbilledVisits} label="signed visits in the month with no claim" href="/billing?tab=visits" />
        </ul>
        {!isClosed ? (
          admin ? (
            <form action={closeMonth} className="stack">
              <input type="hidden" name="period" value={period} />
              <label>
                {checklist.clean ? "Note (optional)" : "Acknowledge the open items (required)"}
                <input name="note" maxLength={500} placeholder={checklist.clean ? "" : "e.g. two deposits reconcile next week; closing for client invoicing"} />
              </label>
              <button className="btn" type="submit">
                Close {periodLabel(period)}
              </button>
              <p className="muted cn-small">Closing freezes the numbers below and refuses any posting dated on or before the last day of the month. Corrections then go through a dated reversal in the open month.</p>
            </form>
          ) : (
            <p className="muted">An administrator closes the month.</p>
          )
        ) : admin ? (
          <form action={reopenMonth} className="cn-inline">
            <input type="hidden" name="period" value={period} />
            <input name="reason" placeholder="Reason to reopen" required />
            <button className="btn ghost" type="submit">
              Reopen
            </button>
          </form>
        ) : null}
      </section>
      <div className="stack">
        <section className="panel">
          <h2>{isClosed ? "Frozen snapshot" : "Numbers so far"}</h2>
          <Snapshot s={isClosed && thisClose?.snapshot ? JSON.parse(thisClose.snapshot) : snapshot} />
          {thisClose?.note && <p className="muted cn-small">Note at close: {thisClose.note}</p>}
          {thisClose?.reopenedAt && <p className="muted cn-small">Reopened {formatDate(thisClose.reopenedAt)}: {thisClose.reopenReason}</p>}
        </section>
        <section className="panel">
          <h2>Closed months</h2>
          <table>
            <tbody>
              {closes.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/billing/close?tab=close&period=${c.period}`}>{periodLabel(c.period)}</Link>
                  </td>
                  <td className="cn-small">{c.reopenedAt ? `reopened ${formatDate(c.reopenedAt)}` : `closed ${formatDate(c.closedAt)}`}</td>
                </tr>
              ))}
              {closes.length === 0 && (
                <tr>
                  <td className="muted">No month closed yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function Snapshot({ s }: { s: Awaited<ReturnType<typeof periodSnapshot>> }) {
  return (
    <table>
      <tbody>
        <tr>
          <td>Charges (by date of service)</td>
          <td>
            {formatMoney(s.chargesCents)} <span className="muted cn-small">{s.chargeLines} lines</span>
          </td>
        </tr>
        <tr>
          <td>Claims submitted</td>
          <td>{s.claimsSubmitted}</td>
        </tr>
        <tr>
          <td>Deposits posted</td>
          <td>
            {formatMoney(s.depositsCents)} <span className="muted cn-small">{s.depositsCount} deposits · insurance {formatMoney(s.insuranceCents)} · patient {formatMoney(s.patientCents)}</span>
          </td>
        </tr>
        <tr>
          <td>By method</td>
          <td className="cn-small">{Object.entries(s.byMethod).map(([m, c]) => `${m} ${formatMoney(c)}`).join(" · ") || "—"}</td>
        </tr>
        <tr>
          <td>Applied to claims</td>
          <td>
            {formatMoney(s.appliedCents)} <span className="muted cn-small">adjustments {formatMoney(s.adjustmentsCents)} · unapplied {formatMoney(s.unappliedCents)}</span>
          </td>
        </tr>
        <tr>
          <td>Front-desk receipts</td>
          <td>
            {formatMoney(s.frontDeskCents)} <span className="muted cn-small">{s.frontDeskReceipts} receipts</span>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

async function DepositsTab({ practiceId }: { practiceId: string }) {
  const [deposits, imports] = await Promise.all([
    prisma.deposit.findMany({ where: { practiceId, status: { not: "RECONCILED" } }, orderBy: { postedAt: "desc" }, take: 200 }),
    prisma.bankImport.findMany({ where: { practiceId }, orderBy: { createdAt: "desc" }, take: 3 }),
  ]);
  const last = imports[0];
  const unmatched: { date: string; amount: number; description: string }[] = last ? JSON.parse(last.unmatched) : [];
  return (
    <div className="two-col">
      <form action={depositSlip} className="panel stack" id="slip">
        <h2>Deposit slip</h2>
        <p className="muted">Tick the deposits that went to the bank together and set the bank deposit date. Reconciled deposits drop off this list.</p>
        <div className="cn-inline">
          <SelectAll name="deposit" noun="deposit" />
          <input name="depositDate" type="date" required aria-label="Bank deposit date" />
          <input name="bankAccount" placeholder="Bank account (optional)" aria-label="Bank account" style={{ width: "10rem" }} />
          <button className="btn secondary gw-mini" type="submit">
            Mark deposited
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Posted</th>
              <th>Payer</th>
              <th>Method · ref</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {deposits.map((d) => (
              <tr key={d.id}>
                <td>
                  <input type="checkbox" name="deposit" value={d.id} form="slip" aria-label="Select deposit" />
                </td>
                <td className="cn-small">{formatDate(d.postedAt)}</td>
                <td>{d.payerName}</td>
                <td className="cn-small">
                  {d.paymentMethod}
                  {d.checkNumber ? ` · ${d.checkNumber}` : ""}
                </td>
                <td>{formatMoney(d.totalCents)}</td>
                <td className="cn-small">
                  {DEPOSIT_STATUSES[d.status] ?? d.status}
                  {d.depositDate ? ` ${formatDate(d.depositDate)}` : ""}
                </td>
              </tr>
            ))}
            {deposits.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Every deposit is reconciled.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </form>
      <div className="stack">
        <form action={importBankStatement} className="panel stack">
          <h2>Bank reconciliation</h2>
          <p className="muted">Upload or paste the bank statement export (CSV with date and amount columns). Credits that match a deposit&apos;s amount within three days of its deposit date are reconciled.</p>
          <input name="file" type="file" accept=".csv,text/csv" />
          <textarea name="csv" rows={4} placeholder={"Date,Amount,Description\n2026-10-03,1250.00,DEPOSIT"} />
          <button className="btn" type="submit">
            Match to deposits
          </button>
        </form>
        {last && (
          <section className="panel">
            <h2>Last import</h2>
            <p className="muted cn-small">
              {formatDate(last.createdAt)}: {last.lines} lines, {last.matched} matched, {unmatched.length} unmatched
            </p>
            {unmatched.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {unmatched.map((u, i) => (
                    <tr key={i}>
                      <td className="cn-small">{u.date}</td>
                      <td>{formatMoney(u.amount)}</td>
                      <td className="cn-small">{u.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

async function DaySheetTab({ practiceId, day }: { practiceId: string; day?: string }) {
  const date = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T12:00:00`) : new Date();
  const s = await daySheet(practiceId, date);
  return (
    <section className="panel stack">
      <form method="get" className="cn-inline">
        <input type="hidden" name="tab" value="daysheet" />
        <input name="day" type="date" defaultValue={s.date.toISOString().slice(0, 10)} aria-label="Day" />
        <button className="btn secondary gw-mini" type="submit">
          Show
        </button>
        <PrintButton />
      </form>
      <h2>
        Cash day sheet · {formatDate(s.date)} <span className="muted cn-small">{s.summary}</span>
      </h2>
      <div className="two-col">
        <div>
          <h3>Front desk by staff member</h3>
          <table>
            <thead>
              <tr>
                <th>Staff</th>
                <th>Receipts</th>
                <th>Total</th>
                <th>By method</th>
              </tr>
            </thead>
            <tbody>
              {s.byUser.map((u) => (
                <tr key={u.user}>
                  <td>{u.user}</td>
                  <td>{u.n}</td>
                  <td>{formatMoney(u.cents)}</td>
                  <td className="cn-small">{Object.entries(u.byMethod).map(([m, c]) => `${m} ${formatMoney(c)}`).join(" · ")}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Desk total</strong>
                </td>
                <td></td>
                <td>
                  <strong>{formatMoney(s.deskCents)}</strong>
                </td>
                <td className="cn-small">
                  patient deposits recorded {formatMoney(s.patientDepositsCents)} · variance{" "}
                  <span className={`gw-tag gw-tag-${s.varianceCents === 0 ? "ok" : "warn"}`}>{formatMoney(s.varianceCents)}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <h3>Posting</h3>
          <table>
            <tbody>
              <tr>
                <td>Charges on visits dated today</td>
                <td>
                  {formatMoney(s.chargesCents)} <span className="muted cn-small">{s.chargeCount} lines</span>
                </td>
              </tr>
              <tr>
                <td>Payments applied to claims</td>
                <td>{formatMoney(s.paymentsCents)}</td>
              </tr>
              <tr>
                <td>Adjustments posted</td>
                <td>{formatMoney(s.adjustmentsCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h3>Deposits posted today</h3>
          <table>
            <thead>
              <tr>
                <th>Payer</th>
                <th>Method</th>
                <th>Amount</th>
                <th>Unapplied</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {s.deposits.map((d) => (
                <tr key={d.id}>
                  <td>{d.payerName}</td>
                  <td className="cn-small">
                    {d.paymentMethod}
                    {d.checkNumber ? ` · ${d.checkNumber}` : ""}
                  </td>
                  <td>{formatMoney(d.totalCents)}</td>
                  <td>{formatMoney(d.unappliedCents)}</td>
                  <td className="cn-small">{DEPOSIT_STATUSES[d.status] ?? d.status}</td>
                </tr>
              ))}
              {s.deposits.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No deposits posted.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <h3>Receipts</h3>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Patient</th>
                <th>For</th>
                <th>Method</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {s.receipts.map((r) => (
                <tr key={r.number} className={r.voidedAt ? "muted" : undefined}>
                  <td className="cn-small">{r.number}</td>
                  <td>
                    {r.patient.lastName}, {r.patient.firstName}
                  </td>
                  <td className="cn-small">{r.kind}</td>
                  <td className="cn-small">{r.method}</td>
                  <td>
                    {formatMoney(r.amountCents)}
                    {r.voidedAt ? " (void)" : ""}
                  </td>
                </tr>
              ))}
              {s.receipts.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No receipts.
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
