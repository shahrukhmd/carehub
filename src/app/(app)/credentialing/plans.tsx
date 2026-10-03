import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate, planSegmentLabel } from "@/lib/format";
import { STANDARD_PAYERS, planApprovalLabel, syncPlansFromCoverage } from "@/lib/payer-plans";
import { addPlan, decidePlan, loadStandardPayers, removePlan, setPayerSegment } from "./plan-actions";

type SearchParams = Record<string, string | undefined>;
const TONE: Record<string, string> = { REVIEW: "warn", APPROVED: "ok", NOT_APPROVED: "bad" };

// Payer names and plans: each payer with the plan type its name stands for, and the plan names under it with
// credentialing's decision. Kept by the credentialing team; plan names VOB enters on patients arrive on their own.
export async function PayerPlans({ practiceIds, sp, isAdmin }: { practiceIds: string[]; sp: SearchParams; isAdmin: boolean }) {
  for (const id of practiceIds) await syncPlansFromCoverage(id);
  const practiceId = { in: practiceIds };
  const [payers, plans] = await Promise.all([
    prisma.payer.findMany({ where: { practiceId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, payerCode: true, planSegment: true, practiceId: true } }),
    prisma.payerPlan.findMany({ where: { practiceId }, orderBy: [{ status: "desc" }, { name: "asc" }] }),
  ]);
  const deciders = new Map(
    (await prisma.user.findMany({ where: { id: { in: [...new Set(plans.map((p) => p.decidedById).filter((v): v is string => Boolean(v)))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])
  );
  const q = (sp.q ?? "").trim().toLowerCase();
  const only = sp.status && sp.status in planApprovalLabel ? sp.status : "";
  const shownPlans = plans.filter((p) => (!only || p.status === only) && (!q || p.name.toLowerCase().includes(q) || (payers.find((x) => x.id === p.payerId)?.name.toLowerCase().includes(q) ?? false)));
  const rows = payers.map((p) => ({ payer: p, plans: shownPlans.filter((x) => x.payerId === p.id) })).filter((r) => (!q && !only) || r.plans.length > 0 || (!only && r.payer.name.toLowerCase().includes(q)));
  const missingStandard = STANDARD_PAYERS.filter((s) => !payers.some((p) => p.name.trim().toLowerCase() === s.name.toLowerCase())).length;
  const count = (s: string) => plans.filter((p) => p.status === s).length;

  return (
    <div className="stack" style={{ gap: "0.6rem" }}>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}

      <section className="panel">
        <div className="gw-section-head">
          <h2>Payer names &amp; plans</h2>
          <span className="muted">
            {count("REVIEW")} to review · {count("APPROVED")} approved · {count("NOT_APPROVED")} not approved
          </span>
        </div>
        <p className="muted">
          A payer name says which line of business it is (Aetna Commercial, Aetna Medicare Advantage). Under each payer, list the plan names and mark the ones the practice is approved for. Plan
          names the VOB team enters on patients show up here as &ldquo;Not reviewed yet&rdquo;; once decided, VOB sees the answer on the patient&apos;s case.
        </p>
        <form method="get" className="pv-inline">
          <input type="hidden" name="tab" value="board" />
          <input type="hidden" name="view" value="plans" />
          {sp.p && <input type="hidden" name="p" value={sp.p} />}
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Payer or plan name" aria-label="Find a payer or plan" />
          <select name="status" defaultValue={only} aria-label="Plan status">
            <option value="">All plans</option>
            {Object.entries(planApprovalLabel).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <button className="btn secondary" type="submit">
            Filter
          </button>
          {(q || only) && (
            <Link className="btn ghost" href="/credentialing?tab=board&view=plans">
              Clear
            </Link>
          )}
        </form>
      </section>

      <section className="panel">
        <h2>Add a plan name</h2>
        <form action={addPlan} className="pv-inline">
          <select name="payerId" required defaultValue="" aria-label="Payer">
            <option value="" disabled>
              Payer…
            </option>
            {payers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input name="name" required maxLength={160} placeholder="Plan name as it appears on the card or contract" aria-label="Plan name" />
          <select name="status" defaultValue="APPROVED" aria-label="Decision">
            <option value="APPROVED">Approved</option>
            <option value="NOT_APPROVED">Not approved</option>
            <option value="REVIEW">Not reviewed yet</option>
          </select>
          <input name="notes" maxLength={400} placeholder="Note (contract reference, exclusions…)" aria-label="Note" />
          <button className="btn" type="submit">
            Add plan
          </button>
        </form>
      </section>

      <section className="panel cd-list">
        <div className="cd-scroll">
          <table className="pp-table">
            <thead>
              <tr>
                <th>Payer name</th>
                <th>Plan type</th>
                <th>Plan name</th>
                <th>Decision</th>
                <th>On patients</th>
                <th>Decided</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ payer, plans: list }) => {
                const span = Math.max(list.length, 1);
                return (list.length ? list : [null]).map((plan, i) => (
                  <tr key={plan?.id ?? payer.id} className={i === 0 ? "sgrid-newpayer" : undefined}>
                    {i === 0 && (
                      <>
                        <td rowSpan={span}>
                          <strong>{payer.name}</strong>
                          {payer.payerCode ? <div className="muted">Payer ID {payer.payerCode}</div> : null}
                        </td>
                        <td rowSpan={span}>
                          <form action={setPayerSegment.bind(null, payer.id)} className="pv-inline">
                            <select name="planSegment" defaultValue={payer.planSegment ?? ""} aria-label={`${payer.name} plan type`}>
                              <option value="">Not set</option>
                              {Object.entries(planSegmentLabel).map(([k, l]) => (
                                <option key={k} value={k}>
                                  {l}
                                </option>
                              ))}
                            </select>
                            <button className="btn ghost gw-mini" type="submit">
                              Save
                            </button>
                          </form>
                        </td>
                      </>
                    )}
                    {plan ? (
                      <>
                        <td>
                          {plan.name}
                          {plan.source === "VOB" && (
                            <span className="gw-tag gw-tag-muted" title="First seen on a patient's coverage entered by the VOB / intake team">
                              From VOB
                            </span>
                          )}
                        </td>
                        <td>
                          <form action={decidePlan.bind(null, plan.id)} className="pv-inline">
                            <span className={`gw-tag gw-tag-${TONE[plan.status] ?? "muted"}`}>{planApprovalLabel[plan.status] ?? plan.status}</span>
                            <select name="status" defaultValue={plan.status} aria-label={`${plan.name} decision`}>
                              {Object.entries(planApprovalLabel).map(([k, l]) => (
                                <option key={k} value={k}>
                                  {l}
                                </option>
                              ))}
                            </select>
                            <input name="notes" defaultValue={plan.notes ?? ""} maxLength={400} placeholder="Note" aria-label={`${plan.name} note`} />
                            <button className="btn secondary gw-mini" type="submit">
                              Save
                            </button>
                          </form>
                        </td>
                        <td>
                          {plan.seenCount}
                          {plan.lastSeenAt ? <span className="muted"> · last {formatDate(plan.lastSeenAt)}</span> : null}
                          {plan.seenCount === 0 && (
                            <form action={removePlan.bind(null, plan.id)} style={{ display: "inline", marginLeft: "0.4rem" }}>
                              <button className="btn ghost gw-mini" type="submit">
                                Remove
                              </button>
                            </form>
                          )}
                        </td>
                        <td>{plan.decidedAt ? `${formatDate(plan.decidedAt)}${plan.decidedById ? ` · ${deciders.get(plan.decidedById) ?? ""}` : ""}` : "—"}</td>
                      </>
                    ) : (
                      <td colSpan={4} className="muted">
                        No plan names listed yet.
                      </td>
                    )}
                  </tr>
                ));
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Nothing matches.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {isAdmin && missingStandard > 0 && (
        <section className="panel">
          <h2>Standard payer names</h2>
          <p className="muted">
            {missingStandard} of the {STANDARD_PAYERS.length} standard payer names (one per line of business, such as &ldquo;Aetna Commercial&rdquo; and &ldquo;Aetna Medicare Advantage&rdquo;) are not in
            this practice&apos;s payer list yet.
          </p>
          <form action={loadStandardPayers}>
            <button className="btn secondary" type="submit">
              Add the missing standard payers
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
