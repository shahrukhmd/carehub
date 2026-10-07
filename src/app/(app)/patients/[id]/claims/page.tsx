import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { PrintButton } from "@/components/PrintButton";
import { claimNumber, claimStatusLabel } from "@/lib/claim-format";
import { ageFromDob, formatDate, formatMoney, formatTime, patientName } from "@/lib/format";
import { PatientShell, loadPatientShell } from "../patient-shell";
import { allowed, rolesFor } from "@/lib/permissions";
import { STATEMENT_CHANNELS } from "@/lib/statements";
import { saveStatementPreference } from "@/app/(app)/statements/actions";

// Billing staff open a claim; the front desk sees the account (for patient questions) without the claim editor.
const CLAIM_OPEN_ROLES = rolesFor("billing.work");
const CLOSED = ["PAID", "VOID", "WRITTEN_OFF"];
const WITH_PAYER = ["DENIED", "EDI_REJECTED", "APPEAL"];
const METHODS: Record<string, string> = { CHECK: "Check", EFT: "EFT / ACH", CARD: "Card", CASH: "Cash", NON: "No payment", OTHER: "Other" };

type Search = { from?: string; to?: string; payerType?: string; method?: string; ref?: string; amount?: string; ok?: string; error?: string };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const minus = (cents: number) => (cents ? `- ${formatMoney(cents)}` : "");

function day(value: string | undefined, fallback: Date, end = false) {
  const d = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T${end ? "23:59:59" : "00:00:00"}`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : fallback;
}

// The patient's account: balances, then one row per claim with what was charged, paid by insurance and by the
// patient, adjusted and still owed, and who owes it. Opened from Quick actions → Claims.
export default async function PatientAccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const user = await requireUser(rolesFor("payments.take"));
  const { id } = await params;
  const sp = await searchParams;
  const shell = await loadPatientShell(id, user);
  const canOpen = allowed(user, CLAIM_OPEN_ROLES);
  const statementPrefs = await prisma.patient.findUnique({ where: { id }, select: { statementPreference: true, statementHold: true, statementHoldReason: true, statementHoldUntil: true } });

  const now = new Date();
  const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  const from = day(sp.from, yearAgo);
  const to = day(sp.to, new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59), true);
  const payerType = sp.payerType === "INSURANCE" || sp.payerType === "PATIENT" ? sp.payerType : "";
  const method = sp.method && sp.method in METHODS ? sp.method : "";
  const ref = sp.ref?.trim() ?? "";
  const amountCents = sp.amount && Number.isFinite(Number(sp.amount.replace(/[$,\s]/g, ""))) ? Math.round(Number(sp.amount.replace(/[$,\s]/g, "")) * 100) : null;
  const paymentFilter = Boolean(payerType || method || ref || amountCents !== null);

  const [patient, claims, deposits, receipts] = await Promise.all([
    prisma.patient.findFirstOrThrow({ where: { id, practiceId: user.practiceId }, include: { insurances: { where: { active: true }, include: { payer: true }, orderBy: { rank: "asc" } } } }),
    prisma.claim.findMany({
      where: { practiceId: user.practiceId, patientId: id, status: { not: "VOID" } },
      include: {
        lines: { orderBy: { lineNumber: "asc" } },
        diagnoses: { orderBy: { sequence: "asc" } },
        renderingProvider: true,
        applications: { include: { deposit: true }, orderBy: { postedAt: "asc" } },
        events: { where: { note: { not: null } }, include: { user: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      },
    }),
    prisma.deposit.findMany({ where: { practiceId: user.practiceId, patientId: id, payerType: "PATIENT" }, include: { applications: true }, orderBy: { postedAt: "desc" } }),
    prisma.receipt.findMany({ where: { practiceId: user.practiceId, patientId: id, voidedAt: null }, orderBy: { createdAt: "desc" } }),
  ]);

  const rows = claims
    .map((c) => {
      const dos = c.lines.length ? new Date(Math.min(...c.lines.map((l) => l.dosFrom.getTime()))) : c.createdAt;
      const paid = (type: string) => c.applications.filter((a) => a.type === "PAYMENT" && a.deposit.payerType === type).reduce((s, a) => s + a.amountCents, 0);
      const ptPaid = paid("PATIENT");
      // Anything recorded on the claim but not tied to a patient payment counts as paid by insurance.
      const insPaid = Math.max(c.paidCents - ptPaid, 0);
      const balance = c.billedCents - c.paidCents - c.adjustedCents;
      // A denied or rejected claim is still with the payer, whoever the balance was last assigned to.
      const patientOwes = c.balanceResponsibility === "PATIENT" && balance > 0 && !CLOSED.includes(c.status) && !WITH_PAYER.includes(c.status);
      return { c, dos, insPaid, ptPaid, balance, patientOwes };
    })
    .sort((a, b) => a.dos.getTime() - b.dos.getTime());

  // Account balances always cover every open claim, whatever the filters below show.
  const open = rows.filter((r) => !CLOSED.includes(r.c.status) && r.balance > 0);
  const patientBalance = open.filter((r) => r.patientOwes).reduce((s, r) => s + r.balance, 0);
  const insuranceBalance = open.filter((r) => !r.patientOwes).reduce((s, r) => s + r.balance, 0);
  const unappliedPatient = deposits.reduce((s, d) => s + d.unappliedCents, 0);
  const lastPatientPayment = deposits[0]?.postedAt ?? null;

  const shown = rows.filter((r) => {
    if (r.dos < from || r.dos > to) return false;
    if (!paymentFilter) return true;
    return r.c.applications.some(
      (a) =>
        a.type === "PAYMENT" &&
        (!payerType || a.deposit.payerType === payerType) &&
        (!method || a.deposit.paymentMethod === method) &&
        (!ref || (a.deposit.checkNumber ?? "").toLowerCase().includes(ref.toLowerCase())) &&
        (amountCents === null || a.amountCents === amountCents || a.deposit.totalCents === amountCents)
    );
  });
  const sum = (pick: (r: (typeof rows)[number]) => number) => shown.reduce((s, r) => s + pick(r), 0);
  const notes = rows.filter((r) => r.c.claimNote || r.c.statusNote || r.c.events.length > 0);

  return (
    <PatientShell data={shell}>
      <div className="pd-head no-print">
        <div>
          <p className="pd-back">
            <Link href={`/patients/${id}`}>« Back to dashboard</Link>
          </p>
          <h1>Claims &amp; account</h1>
        </div>
      </div>

      <details className="panel acct-section" open>
        <summary>Patient Info</summary>
        <div className="acct-info">
          <div className="acct-id">
            <span>A/C #:</span>
            <strong>{patient.mrn}</strong>
          </div>
          <div className="acct-card">
            <div className="acct-who">
              <strong>
                {patientName(patient)} ({formatDate(patient.dob)}, {ageFromDob(patient.dob)}y)
              </strong>
              {patient.insurances.length === 0 && <span>Self-pay</span>}
              {patient.insurances.map((i) => (
                <span key={i.id}>
                  <em>{i.rank === "PRIMARY" ? "Primary" : i.rank === "SECONDARY" ? "Secondary" : "Tertiary"}</em> {i.payer.name} (Policy#: {i.memberId})
                </span>
              ))}
            </div>
            <dl className="acct-balances">
              <dt>Patient</dt>
              <dd>{formatMoney(patientBalance)}</dd>
              <dt>Insurance</dt>
              <dd>{formatMoney(insuranceBalance)}</dd>
              <dt>Unapplied Pat Pmts</dt>
              <dd>{formatMoney(unappliedPatient)}</dd>
              <dt>Unapplied Insurance Pmts</dt>
              <dd>{formatMoney(0)}</dd>
              <dt className="acct-strong">Total Pat Balance</dt>
              <dd className="acct-strong">{formatMoney(patientBalance - unappliedPatient)}</dd>
              <dt className="acct-strong">Total Ins Balance</dt>
              <dd className="acct-strong">{formatMoney(insuranceBalance)}</dd>
              <dt className="acct-strong">Last Pat Payment Date</dt>
              <dd className="acct-strong">{lastPatientPayment ? formatDate(lastPatientPayment) : "—"}</dd>
              <dt className="acct-strong">Total OS Balance</dt>
              <dd className="acct-strong">{formatMoney(patientBalance - unappliedPatient + insuranceBalance)}</dd>
            </dl>
          </div>
        </div>
        <div className="acct-buttons no-print">
          <a className="btn secondary" href="#claim-notes">
            Claim Notes
          </a>
          <a className="btn secondary" href="#itemized">
            Itemized Statement
          </a>
          <PrintButton label="Print Transactions" className="btn secondary" />
          <a className="btn secondary" href="#patient-payments">
            Patient Payments History
          </a>
          <Link className="btn secondary" href={`/patients/${id}/statement`}>
            View Statement
          </Link>
        </div>
      </details>

      <details className="panel acct-section" open>
        <summary>Other Filters and Info</summary>
        <form method="get" className="acct-filters no-print">
          <label>
            From:
            <input type="date" name="from" defaultValue={iso(from)} />
          </label>
          <label>
            To:
            <input type="date" name="to" defaultValue={iso(to)} />
          </label>
          <button className="btn" type="submit">
            Refresh
          </button>
          <label>
            Payer Type:
            <select name="payerType" defaultValue={payerType}>
              <option value="">All</option>
              <option value="INSURANCE">Insurance</option>
              <option value="PATIENT">Patient</option>
            </select>
          </label>
          <label>
            Payment Type:
            <select name="method" defaultValue={method}>
              <option value="">All</option>
              {Object.entries(METHODS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <span />
          <label>
            Check/Ref #:
            <input name="ref" defaultValue={ref} />
          </label>
          <label>
            Payment Amount:
            <input name="amount" inputMode="decimal" defaultValue={sp.amount ?? ""} />
          </label>
          {(paymentFilter || sp.from || sp.to) && (
            <Link className="btn ghost" href={`/patients/${id}/claims`}>
              Clear filters
            </Link>
          )}
        </form>
        <dl className="acct-totals">
          <dt>Total Charges:</dt>
          <dd>{formatMoney(sum((r) => r.c.billedCents))}</dd>
          <dt>Total Pat Payments:</dt>
          <dd>{minus(sum((r) => r.ptPaid)) || formatMoney(0)}</dd>
          <dt>Total Ins Payments:</dt>
          <dd>{minus(sum((r) => r.insPaid)) || formatMoney(0)}</dd>
          <dt>Total Adjustments:</dt>
          <dd>{minus(sum((r) => r.c.adjustedCents)) || formatMoney(0)}</dd>
        </dl>
      </details>

      {sp.ok && <p className="notice-ok">{sp.ok}</p>}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      <form className="panel cn-inline" action={saveStatementPreference.bind(null, id)} style={{ marginBottom: "1rem", alignItems: "flex-end" }}>
        <label>
          Statements by
          <select name="statementPreference" defaultValue={statementPrefs?.statementPreference ?? "PAPER"}>
            {Object.entries(STATEMENT_CHANNELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-inline">
          <input type="checkbox" name="statementHold" defaultChecked={statementPrefs?.statementHold ?? false} /> Hold statements
        </label>
        <label>
          Reason
          <input name="statementHoldReason" defaultValue={statementPrefs?.statementHoldReason ?? ""} placeholder="e.g. returned mail, dispute" />
        </label>
        <label>
          Until
          <input name="statementHoldUntil" type="date" defaultValue={statementPrefs?.statementHoldUntil ? statementPrefs.statementHoldUntil.toISOString().slice(0, 10) : ""} />
        </label>
        <button className="btn secondary" type="submit">
          Save
        </button>
      </form>
      <section className="panel gw-table acct-ledger">
        <table>
          <thead>
            <tr>
              <th>DOS</th>
              <th>Claim #</th>
              <th>Posted</th>
              <th className="num">Charged</th>
              <th className="num">Ins Paid</th>
              <th className="num">Pt Paid</th>
              <th className="num">Adjusted</th>
              <th className="num">Balance</th>
              <th>Status/Description</th>
              <th>Debtor</th>
              <th>Provider</th>
              <th>Diagnosis 1</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ c, dos, insPaid, ptPaid, balance, patientOwes }) => (
              <tr key={c.id} className={patientOwes ? "acct-due" : undefined}>
                <td>{formatDate(dos)}</td>
                <td>{canOpen ? <Link href={`/billing/claims/${c.id}`}>{claimNumber(c)}</Link> : claimNumber(c)}</td>
                <td>{formatDate(c.submittedAt ?? c.createdAt)}</td>
                <td className="num">{formatMoney(c.billedCents)}</td>
                <td className="num">{minus(insPaid)}</td>
                <td className="num">{minus(ptPaid)}</td>
                <td className="num">{minus(c.adjustedCents)}</td>
                <td className="num">{formatMoney(balance)}</td>
                <td>Claim - {patientOwes ? "Pending Statement" : (claimStatusLabel[c.status] ?? c.status)}</td>
                <td>{patientOwes ? patientName(patient) : c.payerName}</td>
                <td>{c.renderingProvider?.name ?? "—"}</td>
                <td>{c.diagnoses[0] ? `${c.diagnoses[0].icd10.replace(".", "")} - ${c.diagnoses[0].description ?? ""}` : "—"}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={12} className="muted">
                  {rows.length === 0 ? "No claims for this patient yet. Claims are created from a visit's superbill in Revenue cycle." : "No claims match these dates and filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <details className="panel acct-section" id="itemized">
        <summary>Itemized Statement — every service line</summary>
        <table>
          <thead>
            <tr>
              <th>DOS</th>
              <th>Claim #</th>
              <th>CPT</th>
              <th>Modifiers</th>
              <th className="num">Units</th>
              <th className="num">Charge</th>
              <th className="num">Paid</th>
              <th className="num">Adjusted</th>
              <th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {shown.flatMap(({ c }) =>
              c.lines.map((l) => (
                <tr key={l.id}>
                  <td>{formatDate(l.dosFrom)}</td>
                  <td>{claimNumber(c)}</td>
                  <td>{l.cptCode}</td>
                  <td>{l.modifiers ?? ""}</td>
                  <td className="num">{l.units}</td>
                  <td className="num">{formatMoney(l.chargeCents)}</td>
                  <td className="num">{minus(l.paidCents)}</td>
                  <td className="num">{minus(l.adjustedCents)}</td>
                  <td className="num">{formatMoney(l.chargeCents - l.paidCents - l.adjustedCents)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </details>

      <details className="panel acct-section" id="patient-payments">
        <summary>
          Patient Payments History ({deposits.length + receipts.filter((r) => !r.depositId).length})
        </summary>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Check/Ref #</th>
              <th className="num">Amount</th>
              <th className="num">Applied to claims</th>
              <th className="num">Unapplied</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {deposits.map((d) => (
              <tr key={d.id}>
                <td>{formatDate(d.postedAt)}</td>
                <td>{METHODS[d.paymentMethod] ?? d.paymentMethod}</td>
                <td>{d.checkNumber ?? receipts.find((r) => r.depositId === d.id)?.number ?? ""}</td>
                <td className="num">{formatMoney(d.totalCents)}</td>
                <td className="num">{formatMoney(d.applications.filter((a) => a.type === "PAYMENT").reduce((s, a) => s + a.amountCents, 0))}</td>
                <td className="num">{formatMoney(d.unappliedCents)}</td>
                <td>{d.note ?? ""}</td>
              </tr>
            ))}
            {receipts
              .filter((r) => !r.depositId)
              .map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.createdAt)}</td>
                  <td>{METHODS[r.method] ?? r.method}</td>
                  <td>{r.reference ?? r.number}</td>
                  <td className="num">{formatMoney(r.amountCents)}</td>
                  <td className="num">—</td>
                  <td className="num">—</td>
                  <td>{[r.kind.replaceAll("_", " ").toLowerCase(), r.note].filter(Boolean).join(" · ")}</td>
                </tr>
              ))}
            {deposits.length + receipts.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No patient payments recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </details>

      <details className="panel acct-section" id="claim-notes">
        <summary>Claim Notes ({notes.length})</summary>
        {notes.length === 0 && <p className="muted">No notes on this patient&apos;s claims.</p>}
        {notes.map(({ c, dos }) => (
          <div key={c.id} className="acct-note">
            <strong>
              {claimNumber(c)} · DOS {formatDate(dos)}
            </strong>
            {c.claimNote && <p>Claim note: {c.claimNote}</p>}
            {c.statusNote && <p>Status note: {c.statusNote}</p>}
            <ul>
              {c.events.map((e) => (
                <li key={e.id}>
                  <span className="muted">
                    {formatDate(e.createdAt)} {formatTime(e.createdAt)} · {e.user?.name ?? "System"} · {e.action.replaceAll("_", " ").toLowerCase()}
                  </span>{" "}
                  {e.note}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </details>
    </PatientShell>
  );
}
