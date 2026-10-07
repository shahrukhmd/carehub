import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { rolesFor } from "@/lib/permissions";
import { formatDate, formatMoney, patientName } from "@/lib/format";
import { COLLECTIONS_STATUSES, PLAN_FREQUENCIES, PLAN_STATUSES, STATEMENT_CHANNELS, statementCandidates } from "@/lib/statements";
import { PAY_METHODS } from "@/lib/checkout";
import { BillingTabs } from "../billing/tabs";
import { SelectAll } from "@/components/SelectAll";
import { cancelPaymentPlan, decideCollectionsCase, postInstallment, runStatementCycle, startPaymentPlan } from "./actions";

type Search = { tab?: string; q?: string; ok?: string; error?: string };
const TABS: [string, string][] = [
  ["run", "Statement run"],
  ["log", "Statement log"],
  ["plans", "Payment plans"],
  ["collections", "Collections"],
];

// Patient statements as a cycle: who is due a statement, the run, the log with printable PDFs, payment plans,
// and the collections worklist after the last notice.
export default async function StatementsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(rolesFor("billing.work"));
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "run";
  const q = sp.q?.trim();

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">Practice management · payer response → patient balance → statement → payment or collections</p>
          <h1>Patient statements</h1>
        </div>
      </div>
      <BillingTabs active="statements" />
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      <nav className="view-tabs" aria-label="Statements">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/statements?tab=${k}`} className={`view-tab${tab === k ? " active" : ""}`}>
            {l}
          </Link>
        ))}
      </nav>

      {tab === "run" && <RunTab practiceId={user.practiceId} />}
      {tab === "log" && <LogTab practiceId={user.practiceId} q={q} />}
      {tab === "plans" && <PlansTab practiceId={user.practiceId} />}
      {tab === "collections" && <CollectionsTab practiceId={user.practiceId} />}
    </div>
  );
}

async function RunTab({ practiceId }: { practiceId: string }) {
  const { candidates, settings } = await statementCandidates(practiceId);
  const eligible = candidates.filter((c) => !c.blocked);
  return (
    <form action={runStatementCycle} className="panel stack" id="run">
      <p className="muted">
        One statement per guarantor (dependents roll up). Eligible: balance at least {formatMoney(settings.minCents)}, {settings.minDays}+ days since the last
        statement, not on hold, not on a payment plan, not in collections, fewer than {settings.cycles} notices sent. Change these in Practice setup → Statements.
        Delivery follows each patient&apos;s preference (set on the patient&apos;s account page).
      </p>
      <div className="cn-inline">
        <SelectAll name="guarantor" noun="account" />
        <button className="btn" type="submit">
          Generate statements ({eligible.length} eligible{eligible.length ? ` · ${formatMoney(eligible.reduce((s, c) => s + c.totalCents, 0))}` : ""})
        </button>
        <span className="muted cn-small">Tick accounts to limit the run; none ticked = everyone eligible.</span>
      </div>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Guarantor</th>
            <th>Claims</th>
            <th>Balance</th>
            <th>Credit on file</th>
            <th>Next notice</th>
            <th>Delivery</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={c.guarantorId} className={c.blocked ? "muted" : undefined}>
              <td>{!c.blocked && <input type="checkbox" name="guarantor" value={c.guarantorId} form="run" aria-label="Select account" />}</td>
              <td>
                <Link href={`/patients/${c.guarantorId}/claims`}>{patientName(c.guarantor)}</Link>
                <div className="muted cn-small">{c.guarantor.mrn}</div>
              </td>
              <td className="cn-small">
                {c.claims.map((cl) => (
                  <div key={cl.id}>
                    {cl.number} · {cl.payerName} · {formatMoney(cl.balanceCents)} · notice {cl.cycle}
                    {cl.lastStatementAt ? ` on ${formatDate(cl.lastStatementAt)}` : ""}
                    {!cl.dueNow ? " (too recent)" : ""}
                  </div>
                ))}
              </td>
              <td>{formatMoney(c.totalCents)}</td>
              <td className="cn-small">{c.creditCents ? <span className="gw-tag gw-tag-warn">{formatMoney(c.creditCents)} unapplied</span> : "—"}</td>
              <td className="cn-small">
                {Math.min(settings.cycles, c.cycle + 1)} of {settings.cycles}
              </td>
              <td className="cn-small">{STATEMENT_CHANNELS[c.guarantor.statementPreference]?.split(" (")[0] ?? "Paper"}</td>
              <td className="cn-small">{c.blocked ?? <span className="gw-tag gw-tag-ok">eligible</span>}</td>
            </tr>
          ))}
          {candidates.length === 0 && (
            <tr>
              <td colSpan={8} className="muted">
                No patient balances above the minimum.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </form>
  );
}

async function LogTab({ practiceId, q }: { practiceId: string; q?: string }) {
  const statements = await prisma.statement.findMany({
    where: { practiceId, ...(q ? { patient: { OR: [{ lastName: { contains: q, mode: "insensitive" } }, { firstName: { contains: q, mode: "insensitive" } }, { mrn: { contains: q, mode: "insensitive" } }] } } : {}) },
    include: { patient: true, lines: { include: { claim: true } } },
    orderBy: { createdAt: "desc" },
    take: 150,
  });
  return (
    <section className="panel">
      <form method="get" className="cn-inline" style={{ margin: "0 0 0.6rem" }}>
        <input type="hidden" name="tab" value="log" />
        <input name="q" defaultValue={q ?? ""} placeholder="Patient name or MRN" aria-label="Patient" />
        <button className="btn secondary gw-mini" type="submit">
          Search
        </button>
      </form>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Guarantor</th>
            <th>Notice</th>
            <th>Claims</th>
            <th>Total</th>
            <th>Delivery</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {statements.map((s) => (
            <tr key={s.id}>
              <td>{formatDate(s.createdAt)}</td>
              <td>
                <Link href={`/patients/${s.patientId}/claims`}>{patientName(s.patient)}</Link>
              </td>
              <td>{s.cycle}</td>
              <td className="cn-small">
                {s.lines.map((l) => (
                  <div key={l.id} className="muted">
                    {l.claim.payerName} — {formatMoney(l.balanceCents)}
                  </div>
                ))}
              </td>
              <td>{formatMoney(s.totalCents)}</td>
              <td className="cn-small">
                {STATEMENT_CHANNELS[s.channel]?.split(" (")[0] ?? s.channel} · {s.status === "SENT" ? `sent ${s.sentAt ? formatDate(s.sentAt) : ""}` : "generated"}
                {s.deliveryNote ? <div className="gw-tag gw-tag-warn">{s.deliveryNote}</div> : null}
              </td>
              <td>
                <a className="btn ghost gw-mini" href={`/api/statements/${s.id}/pdf`} target="_blank" rel="noreferrer">
                  PDF
                </a>
              </td>
            </tr>
          ))}
          {statements.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                No statements yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

async function PlansTab({ practiceId }: { practiceId: string }) {
  const [plans, owing] = await Promise.all([
    prisma.paymentPlan.findMany({ where: { practiceId }, include: { patient: true, installments: { orderBy: { dueAt: "asc" } } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 100 }),
    prisma.patient.findMany({ where: { practiceId, claims: { some: { balanceResponsibility: "PATIENT", status: { in: ["SUBMITTED", "ACCEPTED", "PARTIAL", "DELINQUENT", "DENIED", "APPEAL"] } } } }, select: { id: true, firstName: true, lastName: true, mrn: true }, orderBy: { lastName: "asc" }, take: 300 }),
  ]);
  return (
    <div className="two-col">
      <section className="panel">
        <h2>Plans</h2>
        {plans.length === 0 && <p className="muted">No payment plans.</p>}
        {plans.map((p) => {
          const next = p.installments.find((i) => i.status === "DUE" || i.status === "MISSED");
          return (
            <article key={p.id} className="stack" style={{ borderTop: "1px solid var(--line)", paddingTop: "0.6rem", marginTop: "0.6rem" }}>
              <div>
                <strong>
                  <Link href={`/patients/${p.patientId}/claims`}>{patientName(p.patient)}</Link>
                </strong>{" "}
                <span className={`gw-tag gw-tag-${p.status === "ACTIVE" ? "ok" : p.status === "DEFAULTED" ? "bad" : "muted"}`}>{PLAN_STATUSES[p.status] ?? p.status}</span>
                <div className="muted cn-small">
                  {formatMoney(p.totalCents)} in {formatMoney(p.installmentCents)} {PLAN_FREQUENCIES[p.frequency]?.label.toLowerCase()} instalments · paid {formatMoney(p.paidCents)} · {p.method === "CARD_ON_FILE" ? `card on file${p.cardRef ? ` ${p.cardRef}` : ""}` : "paid manually"}
                  {p.missed ? ` · ${p.missed} missed` : ""}
                  {p.note ? ` · ${p.note}` : ""}
                </div>
              </div>
              <div className="cn-small">
                {p.installments.map((i) => (
                  <span key={i.id} className={`gw-tag gw-tag-${i.status === "PAID" ? "ok" : i.status === "MISSED" ? "bad" : i.status === "SKIPPED" ? "muted" : "info"}`} style={{ marginRight: "0.3rem" }}>
                    {formatDate(i.dueAt)} {formatMoney(i.amountCents)} {i.status.toLowerCase()}
                  </span>
                ))}
              </div>
              {p.status === "ACTIVE" && next && (
                <form action={postInstallment.bind(null, p.id, next.id)} className="cn-inline">
                  <span className="cn-small">Post instalment due {formatDate(next.dueAt)} ({formatMoney(next.amountCents)}):</span>
                  <select name="method" defaultValue="CARD" aria-label="Method">
                    {Object.entries(PAY_METHODS).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <input name="reference" placeholder="Reference" aria-label="Reference" style={{ width: "8rem" }} />
                  <button className="btn secondary gw-mini" type="submit">
                    Post
                  </button>
                </form>
              )}
              {p.status === "ACTIVE" && (
                <form action={cancelPaymentPlan.bind(null, p.id)} className="cn-inline">
                  <input name="reason" placeholder="Cancel because…" aria-label="Reason" required />
                  <button className="btn ghost gw-mini" type="submit">
                    Cancel plan
                  </button>
                </form>
              )}
            </article>
          );
        })}
      </section>
      <form className="panel stack" action={startPaymentPlan}>
        <h2>Set up a payment plan</h2>
        <p className="muted">Statements pause while the plan is active. Card-on-file charging needs the payment provider; until then instalments are posted by hand.</p>
        <label>
          Patient
          <select name="patientId" required defaultValue="">
            <option value="">Pick a patient with a balance…</option>
            {owing.map((p) => (
              <option key={p.id} value={p.id}>
                {p.lastName}, {p.firstName} · {p.mrn}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid gw-grid-3">
          <label>
            Plan total $
            <input name="total" inputMode="decimal" required />
          </label>
          <label>
            Instalment $
            <input name="installment" inputMode="decimal" required />
          </label>
          <label>
            Every
            <select name="frequency" defaultValue="MONTHLY">
              {Object.entries(PLAN_FREQUENCIES).map(([k, f]) => (
                <option key={k} value={k}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            First due
            <input name="firstDueAt" type="date" required />
          </label>
          <label>
            Method
            <select name="method" defaultValue="MANUAL">
              <option value="MANUAL">Patient pays each instalment</option>
              <option value="CARD_ON_FILE">Card on file (provider needed)</option>
            </select>
          </label>
          <label>
            Card reference (last 4)
            <input name="cardRef" maxLength={40} />
          </label>
        </div>
        <label>
          Note
          <input name="note" maxLength={300} />
        </label>
        <button className="btn" type="submit">
          Start plan
        </button>
      </form>
    </div>
  );
}

async function CollectionsTab({ practiceId }: { practiceId: string }) {
  const cases = await prisma.collectionsCase.findMany({ where: { practiceId }, include: { patient: true }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 100 });
  const referred = cases.filter((c) => c.status === "REFERRED").length;
  return (
    <section className="panel stack">
      <div className="cn-inline">
        <p className="muted" style={{ margin: 0 }}>
          Accounts that finished the statement cycle. Decide: in-house calls, refer to an agency (suppresses statements, marks the claims in collection), write off, or close.
        </p>
        {referred > 0 && (
          <a className="btn ghost gw-mini" href="/api/statements/collections/export">
            Agency file (CSV, {referred} referred)
          </a>
        )}
      </div>
      <table>
        <thead>
          <tr>
            <th>Patient</th>
            <th>Balance</th>
            <th>Since</th>
            <th>Status</th>
            <th>Decision</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <tr key={c.id} className={["CLOSED", "WRITTEN_OFF"].includes(c.status) ? "muted" : undefined}>
              <td>
                <Link href={`/patients/${c.patientId}/claims`}>{patientName(c.patient)}</Link>
                <div className="muted cn-small">{c.patient.mrn}</div>
              </td>
              <td>{formatMoney(c.balanceCents)}</td>
              <td className="cn-small">{formatDate(c.createdAt)}</td>
              <td className="cn-small">
                {COLLECTIONS_STATUSES[c.status] ?? c.status}
                {c.agency ? ` · ${c.agency}` : ""}
                {c.referredAt ? ` · ${formatDate(c.referredAt)}` : ""}
                {c.note ? <div className="muted">{c.note}</div> : null}
              </td>
              <td>
                {!["CLOSED", "WRITTEN_OFF"].includes(c.status) && (
                  <form action={decideCollectionsCase.bind(null, c.id)} className="stack cn-small">
                    <select name="decision" defaultValue={c.status === "REVIEW" ? "IN_HOUSE" : "REFERRED"} aria-label="Decision">
                      <option value="IN_HOUSE">In-house calls</option>
                      <option value="REFERRED">Refer to agency</option>
                      <option value="WRITTEN_OFF">Write off</option>
                      <option value="CLOSED">Close (paid / other)</option>
                    </select>
                    <input name="agency" placeholder="Agency (when referring)" aria-label="Agency" defaultValue={c.agency ?? ""} />
                    <input name="note" placeholder="Note / reason" aria-label="Note" />
                    <button className="btn secondary gw-mini" type="submit">
                      Record
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
          {cases.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No accounts in collections.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
