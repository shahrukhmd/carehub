import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney } from "@/lib/format";
import {
  APPEAL_LEVELS,
  APPEAL_METHODS,
  APPEAL_STATUS,
  DENIAL_CATEGORIES,
  DENIAL_RESOLUTION,
  DENIAL_ROLES,
  DENIAL_STATUS,
  appealEnclosures,
  daysUntil,
  deadlineLabel,
  deadlineTone,
  ensureDenialRecords,
} from "@/lib/denials";
import {
  discardAppealDraft,
  fileAppeal,
  recordAppealOutcome,
  saveAppealLetter,
  startAppeal,
  transferDenialToPatient,
  workDenial,
} from "../../denials/actions";

// Local calendar date for date inputs.
const iso = (d: Date | null | undefined) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "");

// Loaded by the claim page (not inside the panel) so the whole page renders in one pass.
export async function loadDenialPanel(claimId: string, practiceId: string) {
  await ensureDenialRecords(practiceId);
  const denials = await prisma.claimDenial.findMany({ where: { claimId, practiceId }, include: { appeals: { orderBy: { createdAt: "asc" } } }, orderBy: { deniedAt: "desc" } });
  const staff = denials.length
    ? await prisma.membership.findMany({
        where: { practiceId, role: { in: DENIAL_ROLES }, user: { active: true } },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { user: { name: "asc" } },
      })
    : [];
  return { denials, staff };
}

// Denial work area on the claim: reason and suggested fix, owner and follow-up, appeals and their outcomes.
export function DenialPanel({ denials, staff, payerFax }: Awaited<ReturnType<typeof loadDenialPanel>> & { payerFax: string | null }) {
  if (denials.length === 0) return null;
  const current = denials.find((d) => d.status !== "RESOLVED") ?? denials[0];
  const earlier = denials.filter((d) => d.id !== current.id);
  const cat = DENIAL_CATEGORIES[current.category] ?? DENIAL_CATEGORIES.OTHER;
  const [statusLabel, statusTone] = DENIAL_STATUS[current.status] ?? [current.status, "muted"];
  const active = current.status !== "RESOLVED";
  const inProgress = current.appeals.some((a) => ["DRAFT", "FILED"].includes(a.status));
  const upheld = current.appeals.filter((a) => a.status === "UPHELD").length;

  return (
    <section className="panel" id="denial">
      <h2>
        Denial &amp; appeals{" "}
        <span className={`gw-tag gw-tag-${statusTone}`}>
          {current.status === "RESOLVED" ? (DENIAL_RESOLUTION[current.resolution ?? ""] ?? statusLabel) : statusLabel}
        </span>
      </h2>
      <div className="gw-facts">
        <div>
          <span>Denied</span>
          {formatDate(current.deniedAt)} · {current.source === "ERA" ? "from ERA" : "keyed"}
        </div>
        <div>
          <span>Reason code</span>
          {current.code ? `${current.groupCode ? `${current.groupCode}-` : ""}${current.code}` : "—"}
          {current.remarks ? ` · remarks ${current.remarks}` : ""}
        </div>
        <div>
          <span>Category</span>
          {cat.label}
        </div>
        <div>
          <span>Amount denied</span>
          {formatMoney(current.amountCents)}
          {current.recoveredCents > 0 ? ` · recovered ${formatMoney(current.recoveredCents)}` : ""}
        </div>
        {current.status === "OPEN" && (
          <div>
            <span>Appeal by</span>
            <span className={`gw-tag gw-tag-${deadlineTone(daysUntil(current.appealDueAt))}`}>{deadlineLabel(current.appealDueAt)}</span>
          </div>
        )}
        {current.resolvedAt && (
          <div>
            <span>Resolved</span>
            {formatDate(current.resolvedAt)}
          </div>
        )}
      </div>
      <p>
        <strong>Payer&apos;s reason:</strong> {current.reason}
      </p>

      {active && (
        <>
          {current.status === "OPEN" && (
            <p className="gw-handoff" style={{ display: "block" }}>
              <strong>Suggested next step:</strong> {cat.fix}
            </p>
          )}

          <form action={workDenial.bind(null, current.id)} className="form-grid gw-grid-3">
            <label>
              Owner
              <select name="ownerId" defaultValue={current.ownerId ?? ""}>
                <option value="">Billing team (unassigned)</option>
                {staff.map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    {m.user.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Category
              <select name="category" defaultValue={current.category}>
                {Object.entries(DENIAL_CATEGORIES).map(([k, c]) => (
                  <option key={k} value={k}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Follow up on
              <input type="date" name="followUpAt" defaultValue={iso(current.followUpAt)} />
            </label>
            <label>
              Appeal deadline
              <input type="date" name="appealDueAt" defaultValue={iso(current.appealDueAt)} />
            </label>
            <label className="gw-span-3">
              Work note
              <input name="workNote" defaultValue={current.workNote ?? ""} placeholder="Who you spoke to at the payer, reference number, what they need…" maxLength={2000} />
            </label>
            <button className="btn secondary" type="submit">
              Save
            </button>
          </form>

          <div className="gw-actions" style={{ marginTop: "0.8rem" }}>
            {!inProgress && upheld < 3 && (
              <form action={startAppeal.bind(null, current.id)}>
                <button className="btn" type="submit">
                  {upheld ? `Start ${APPEAL_LEVELS[upheld + 1].toLowerCase()}` : "Start an appeal"}
                </button>
              </form>
            )}
            {!current.appeals.some((a) => a.status === "FILED") && (
              <form action={transferDenialToPatient.bind(null, current.id)}>
                <button className="btn ghost" type="submit">
                  Transfer balance to patient
                </button>
              </form>
            )}
          </div>
          <p className="muted">
            To fix and resend instead, use <strong>Create corrected claim (7)</strong> or <strong>Resubmit (same claim)</strong>; to give up the balance, record{" "}
            <strong>Written off</strong> under Payer outcome. Each of these closes the denial.
          </p>
        </>
      )}

      {current.appeals.map((a) => {
        const [label, tone] = APPEAL_STATUS[a.status] ?? [a.status, "muted"];
        return (
          <div key={a.id} className="panel-section" style={{ borderTop: "1px solid var(--line)", paddingTop: "0.9rem", marginTop: "0.9rem" }}>
            <h3>
              {APPEAL_LEVELS[a.level] ?? `Appeal level ${a.level}`} <span className={`gw-tag gw-tag-${tone}`}>{label}</span>
            </h3>

            {a.status === "DRAFT" && (
              <>
                <form className="stack">
                  <label>
                    Appeal letter (the payer address, claim details, signature and enclosure list are added to the PDF)
                    <textarea name="letterBody" defaultValue={a.letterBody} rows={14} required />
                  </label>
                  <div className="gw-actions">
                    <button className="btn secondary" type="submit" formAction={saveAppealLetter.bind(null, a.id)}>
                      Save letter
                    </button>
                    <a className="btn ghost" href={`/api/appeals/${a.id}/letter`} target="_blank" rel="noopener">
                      Preview PDF (last saved)
                    </a>
                  </div>
                  <p className="muted" style={{ margin: 0 }}>
                    Attach before sending: {appealEnclosures(current.category).join(" · ")}.
                  </p>
                  <div className="form-grid gw-grid-3">
                    <label>
                      File by
                      <select name="method" defaultValue={payerFax ? "FAX" : "MAIL"}>
                        {Object.entries(APPEAL_METHODS).map(([k, l]) => (
                          <option key={k} value={k}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Payer appeals fax
                      <input name="fax" defaultValue={payerFax ?? ""} placeholder="10-digit fax (for fax only)" />
                    </label>
                    <label>
                      Date filed
                      <input type="date" name="filedAt" defaultValue={iso(new Date())} />
                    </label>
                    <label>
                      Payer reference # (if any)
                      <input name="payerReference" maxLength={60} />
                    </label>
                  </div>
                  <div className="gw-actions">
                    <button className="btn" type="submit" formAction={fileAppeal.bind(null, a.id)}>
                      File appeal
                    </button>
                  </div>
                </form>
                <form action={discardAppealDraft.bind(null, a.id)} style={{ marginTop: "0.5rem" }}>
                  <button className="btn ghost gw-mini" type="submit">
                    Discard draft
                  </button>
                </form>
              </>
            )}

            {a.status !== "DRAFT" && (
              <div className="gw-facts">
                <div>
                  <span>Filed</span>
                  {a.filedAt ? formatDate(a.filedAt) : "—"} · {APPEAL_METHODS[a.filedVia ?? ""] ?? a.filedVia ?? ""}
                </div>
                {a.payerReference && (
                  <div>
                    <span>Payer reference</span>
                    {a.payerReference}
                  </div>
                )}
                {a.decisionAt && (
                  <div>
                    <span>Decision</span>
                    {formatDate(a.decisionAt)}
                  </div>
                )}
                {a.recoveredCents > 0 && (
                  <div>
                    <span>Recovered</span>
                    {formatMoney(a.recoveredCents)}
                  </div>
                )}
                <div>
                  <span>Letter</span>
                  <a href={`/api/appeals/${a.id}/letter`} target="_blank" rel="noopener">
                    Open PDF
                  </a>
                </div>
              </div>
            )}
            {a.outcomeNote && <p className="muted">{a.outcomeNote}</p>}

            {a.status === "FILED" && (
              <form action={recordAppealOutcome.bind(null, a.id)} className="form-grid gw-grid-3">
                <label>
                  Payer&apos;s decision
                  <select name="outcome" defaultValue="" required>
                    <option value="" disabled>
                      Choose…
                    </option>
                    <option value="OVERTURNED">Overturned — payer will pay</option>
                    <option value="PARTIAL">Partly overturned</option>
                    <option value="UPHELD">Upheld — still denied</option>
                    <option value="WITHDRAWN">Withdrawn by us</option>
                  </select>
                </label>
                <label>
                  Decision date
                  <input type="date" name="decisionAt" defaultValue={iso(new Date())} />
                </label>
                <label>
                  Payer reference #
                  <input name="payerReference" defaultValue={a.payerReference ?? ""} maxLength={60} />
                </label>
                <label className="gw-span-3">
                  Note
                  <input name="outcomeNote" placeholder="What the payer said" maxLength={1000} />
                </label>
                <button className="btn secondary" type="submit">
                  Record decision
                </button>
              </form>
            )}
          </div>
        );
      })}

      {earlier.length > 0 && (
        <details style={{ marginTop: "0.9rem" }}>
          <summary className="muted">Earlier denials on this claim ({earlier.length})</summary>
          <ul className="gw-timeline">
            {earlier.map((d) => (
              <li key={d.id}>
                <span className="muted">
                  {formatDate(d.deniedAt)} · {DENIAL_CATEGORIES[d.category]?.label ?? d.category} · {formatMoney(d.amountCents)}
                </span>
                <div>
                  {d.reason} — {DENIAL_RESOLUTION[d.resolution ?? ""] ?? DENIAL_STATUS[d.status]?.[0] ?? d.status}
                  {d.resolvedAt ? ` ${formatDate(d.resolvedAt)}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="muted" style={{ marginBottom: 0 }}>
        <Link href="/billing/denials">Back to the denial worklist</Link>
      </p>
    </section>
  );
}
