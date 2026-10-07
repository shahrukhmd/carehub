import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { rolesFor } from "@/lib/permissions";
import { formatDate, formatMoney, patientName } from "@/lib/format";
import { claimNumber } from "@/lib/claim-format";
import { FOLLOWUP_STATUSES, FOLLOWUP_TRIGGERS, followUpBalance, loadFollowUps, unworkedClaims } from "@/lib/followups";
import { BillingTabs } from "../tabs";
import { SelectAll } from "@/components/SelectAll";
import { bulkAssign, openFollowUps } from "./actions";

type Search = { view?: string; trigger?: string; q?: string; ok?: string; error?: string };

const VIEWS: [string, string][] = [
  ["open", "To work"],
  ["mine", "Mine"],
  ["due", "Due today"],
  ["deadlines", "Deadline soon"],
  ["unassigned", "Unassigned pool"],
  ["aging", "Open AR not yet worked"],
  ["resolved", "Resolved"],
  ["all", "All"],
];
const DAY = 86_400_000;
const days = (d: Date | null) => (d ? Math.ceil((d.getTime() - Date.now()) / DAY) : null);

// The AR follow-up worklist: every unpaid, underpaid, denied, rejected or unanswered claim as a worked item,
// sorted by priority then next check date. Supervisors assign in bulk and open items for aging claims.
export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(rolesFor("billing.work"));
  const sp = await searchParams;
  const view = VIEWS.some(([k]) => k === sp.view) ? sp.view! : "open";
  const [rows, aging, staff] = await Promise.all([
    view === "aging" ? [] : loadFollowUps(user.practiceId, { view, userId: user.id, trigger: sp.trigger, q: sp.q?.trim() }),
    view === "aging" ? unworkedClaims(user.practiceId) : [],
    prisma.membership.findMany({ where: { practiceId: user.practiceId, role: { in: ["ADMIN", "BILLER"] }, user: { active: true } }, include: { user: { select: { id: true, name: true } } }, orderBy: { user: { name: "asc" } } }),
  ]);
  const counts = await prisma.claimFollowUp.groupBy({ by: ["status"], where: { practiceId: user.practiceId }, _count: { _all: true }, _sum: { balanceCents: true } });
  const openCount = counts.filter((c) => !["RESOLVED", "WRITTEN_OFF"].includes(c.status)).reduce((s, c) => s + c._count._all, 0);
  const openBalance = counts.filter((c) => !["RESOLVED", "WRITTEN_OFF"].includes(c.status)).reduce((s, c) => s + (c._sum.balanceCents ?? 0), 0);
  const href = (extra: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ view, trigger: sp.trigger, q: sp.q, ...extra })) if (v) u.set(k, v);
    return `/billing/followups?${u}`;
  };

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">Practice management · claim → payer response → follow-up → payment</p>
          <h1>AR follow-up</h1>
        </div>
        <div className="muted">
          {openCount} open · {formatMoney(openBalance)} outstanding
        </div>
      </div>
      <BillingTabs active="followups" />
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      <nav className="view-tabs" aria-label="Follow-up views">
        {VIEWS.map(([k, l]) => (
          <Link key={k} href={href({ view: k })} className={`view-tab${view === k ? " active" : ""}`}>
            {l}
          </Link>
        ))}
      </nav>
      {view !== "aging" && (
        <form className="cn-inline" method="get" action="/billing/followups">
          <input type="hidden" name="view" value={view} />
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Patient name or MRN" aria-label="Search" />
          <select name="trigger" defaultValue={sp.trigger ?? ""} aria-label="Trigger">
            <option value="">Any trigger</option>
            {Object.entries(FOLLOWUP_TRIGGERS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <button className="btn secondary" type="submit">
            Filter
          </button>
        </form>
      )}

      {view === "aging" ? (
        <form action={openFollowUps} className="panel stack" id="aging">
          <p className="muted">
            Claims out with a payer or a patient that nobody is working yet. Tick the ones to work, pick an owner, and each becomes a follow-up item with
            the right trigger (denied, rejected, patient balance, or no response).
          </p>
          <div className="cn-inline">
            <SelectAll name="claim" noun="claim" />
            <select name="ownerId" defaultValue="" aria-label="Owner">
              <option value="">Unassigned pool</option>
              {staff.map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {m.user.name}
                </option>
              ))}
            </select>
            <button className="btn" type="submit">
              Open follow-ups
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Claim</th>
                <th>Patient</th>
                <th>Payer</th>
                <th>Status</th>
                <th>Submitted</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {aging.map((c) => (
                <tr key={c.id}>
                  <td>
                    <input type="checkbox" name="claim" value={c.id} form="aging" aria-label="Select claim" />
                  </td>
                  <td>
                    <Link href={`/billing/claims/${c.id}`}>{claimNumber(c)}</Link>
                  </td>
                  <td>{patientName(c.patient)}</td>
                  <td>{c.payerName}</td>
                  <td className="cn-small">{c.status}</td>
                  <td className="cn-small">{c.submittedAt ? formatDate(c.submittedAt) : "—"}</td>
                  <td>{formatMoney(followUpBalance(c))}</td>
                </tr>
              ))}
              {aging.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    Every open claim already has a follow-up item.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </form>
      ) : (
        <form action={bulkAssign} className="panel stack" id="worklist">
          <div className="cn-inline">
            <SelectAll name="followUp" noun="follow-up" />
            <select name="ownerId" defaultValue="" aria-label="Assign to">
              <option value="">Unassigned pool</option>
              {staff.map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {m.user.name}
                </option>
              ))}
            </select>
            <button className="btn secondary" type="submit">
              Assign ticked
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Pri.</th>
                  <th>Claim</th>
                  <th>Patient</th>
                  <th>Payer · DOS</th>
                  <th>Trigger</th>
                  <th>Balance</th>
                  <th>Owner</th>
                  <th>Next check</th>
                  <th>Deadline</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => {
                  const dl = days(f.deadlineAt);
                  const tk = days(f.tickleAt);
                  return (
                    <tr key={f.id}>
                      <td>
                        <input type="checkbox" name="followUp" value={f.id} form="worklist" aria-label="Select follow-up" />
                      </td>
                      <td>
                        <span className={`gw-tag gw-tag-${f.priority >= 6 ? "bad" : f.priority >= 3 ? "warn" : "muted"}`}>{f.priority}</span>
                      </td>
                      <td>
                        <Link href={`/billing/claims/${f.claimId}?view=payments#followup`}>{claimNumber(f.claim)}</Link>
                      </td>
                      <td>
                        <Link href={`/patients/${f.claim.patient.id}`}>{patientName(f.claim.patient)}</Link>
                      </td>
                      <td className="cn-small">
                        {f.claim.payerName}
                        {f.claim.lines[0] ? ` · ${formatDate(f.claim.lines[0].dosFrom)}` : ""}
                      </td>
                      <td className="cn-small">
                        {FOLLOWUP_TRIGGERS[f.trigger] ?? f.trigger}
                        {f.note ? <div className="muted">{f.note.slice(0, 90)}</div> : null}
                      </td>
                      <td>{formatMoney(f.balanceCents)}</td>
                      <td className="cn-small">{f.owner?.name ?? <span className="muted">pool</span>}</td>
                      <td className="cn-small">{f.tickleAt ? <span className={tk !== null && tk <= 0 ? "gw-tag gw-tag-warn" : undefined}>{formatDate(f.tickleAt)}</span> : "—"}</td>
                      <td className="cn-small">{f.deadlineAt ? <span className={`gw-tag gw-tag-${dl !== null && dl <= 10 ? "bad" : dl !== null && dl <= 30 ? "warn" : "muted"}`}>{dl !== null && dl < 0 ? "passed" : `${dl}d`}</span> : "—"}</td>
                      <td className="cn-small">
                        {FOLLOWUP_STATUSES[f.status] ?? f.status}
                        {f.escalatedAt ? <div className="gw-tag gw-tag-bad">escalated</div> : null}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="muted">
                      Nothing in this view.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </form>
      )}
    </div>
  );
}
