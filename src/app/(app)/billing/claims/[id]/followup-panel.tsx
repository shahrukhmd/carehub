import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney } from "@/lib/format";
import { FOLLOWUP_ACTIONS, FOLLOWUP_STATUSES, FOLLOWUP_TRIGGERS, OPEN_FOLLOWUP_STATUSES } from "@/lib/followups";
import { assignFollowUp, resolveFollowUp, workFollowUp } from "../../followups/actions";

const DAY = 86_400_000;

export async function loadFollowUpPanel(claimId: string, practiceId: string) {
  const [current, staff] = await Promise.all([
    prisma.claimFollowUp.findFirst({ where: { claimId, practiceId, status: { in: OPEN_FOLLOWUP_STATUSES } }, include: { owner: { select: { id: true, name: true } } } }),
    prisma.membership.findMany({ where: { practiceId, role: { in: ["ADMIN", "BILLER"] }, user: { active: true } }, include: { user: { select: { id: true, name: true } } }, orderBy: { user: { name: "asc" } } }),
  ]);
  const past = current ? [] : await prisma.claimFollowUp.findMany({ where: { claimId, practiceId }, orderBy: { createdAt: "desc" }, take: 3 });
  return { current, staff, past };
}

// The claim's follow-up item beside the ERA lines and the denial: what triggered it, who owns it, the next check
// and deadline, and the actions a biller records (each sets the next status and tickle date).
export function FollowUpPanel({ current, staff, past, claimId }: Awaited<ReturnType<typeof loadFollowUpPanel>> & { claimId: string }) {
  if (!current) {
    if (past.length === 0) return null;
    const last = past[0];
    return (
      <section className="panel" id="followup">
        <h2>Follow-up</h2>
        <p className="muted">
          Last item {FOLLOWUP_STATUSES[last.status]?.toLowerCase() ?? last.status} {last.resolvedAt ? formatDate(last.resolvedAt) : ""}
          {last.resolvedReason ? ` — ${last.resolvedReason}` : ""}. <Link href="/billing/followups?view=aging">Open a new one</Link> from the aging list if the claim needs work again.
        </p>
      </section>
    );
  }
  const dl = current.deadlineAt ? Math.ceil((current.deadlineAt.getTime() - Date.now()) / DAY) : null;
  const tk = current.tickleAt ? Math.ceil((current.tickleAt.getTime() - Date.now()) / DAY) : null;
  return (
    <section className="panel gw-handoff" id="followup">
      <div>
        <strong>Follow-up · {FOLLOWUP_TRIGGERS[current.trigger] ?? current.trigger}</strong>
        <p className="muted">
          {FOLLOWUP_STATUSES[current.status] ?? current.status} · priority {current.priority} · balance {formatMoney(current.balanceCents)}
          {current.expectedCents ? ` (expected ${formatMoney(current.expectedCents)}, paid ${formatMoney(current.paidCents ?? 0)})` : ""} · owner {current.owner?.name ?? "unassigned"}
          {current.tickleAt ? ` · next check ${formatDate(current.tickleAt)}${tk !== null && tk <= 0 ? " (due)" : ""}` : ""}
          {current.slaDueAt ? ` · SLA ${formatDate(current.slaDueAt)}` : ""}
          {current.deadlineAt ? (
            <>
              {" "}
              · <span className={`gw-tag gw-tag-${dl !== null && dl <= 10 ? "bad" : "warn"}`}>deadline {formatDate(current.deadlineAt)}</span>
            </>
          ) : null}
          {current.escalatedAt ? " · escalated to the supervisor pool" : ""}
        </p>
        {current.note && <p className="cn-small">{current.note}</p>}
      </div>

      <form action={workFollowUp.bind(null, current.id)} className="stack" style={{ flex: 1, minWidth: "18rem" }}>
        <div className="form-grid gw-grid-3">
          <label>
            What was done
            <select name="action" defaultValue="CALLED_PAYER">
              {Object.entries(FOLLOWUP_ACTIONS).map(([k, a]) => (
                <option key={k} value={k}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Payer reference #
            <input name="reference" maxLength={80} />
          </label>
          <label>
            Spoke with
            <input name="representative" maxLength={80} />
          </label>
        </div>
        <label>
          Outcome / note
          <input name="note" maxLength={500} placeholder="What the payer said, what happens next" />
        </label>
        <div className="cn-inline">
          <label className="checkbox-inline">
            Next check on <input name="tickleAt" type="date" />
          </label>
          <button className="btn" type="submit">
            Record
          </button>
          {current.trigger === "DENIAL" && (
            <Link className="btn ghost" href={`/billing/claims/${claimId}?view=payments#denial`}>
              Appeal flow
            </Link>
          )}
        </div>
      </form>

      <div className="stack" style={{ minWidth: "14rem" }}>
        <form action={assignFollowUp.bind(null, current.id)} className="cn-inline">
          <select name="ownerId" defaultValue={current.owner?.id ?? ""} aria-label="Owner">
            <option value="">Unassigned pool</option>
            {staff.map((m) => (
              <option key={m.user.id} value={m.user.id}>
                {m.user.name}
              </option>
            ))}
          </select>
          <button className="btn ghost" type="submit">
            Assign
          </button>
        </form>
        <form action={resolveFollowUp.bind(null, current.id)} className="stack">
          <input name="reason" maxLength={200} placeholder="Resolved because…" required />
          <label className="checkbox-inline">
            <input type="checkbox" name="writeOff" /> Write off the remaining balance
          </label>
          <button className="btn ghost" type="submit">
            Resolve
          </button>
        </form>
      </div>
    </section>
  );
}
