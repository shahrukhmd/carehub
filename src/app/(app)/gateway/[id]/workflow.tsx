import type { PlanApproval } from "@/lib/payer-plans";
import Link from "next/link";
import type { EligibilityCheck, IntakeCase } from "@prisma/client";
import { CopyButton } from "@/components/CopyButton";
import type { NetworkStatus } from "@/lib/credentialing";
import type { BenefitField } from "@/lib/eligibility-apply";
import { formatDate, formatMoney, formatTime } from "@/lib/format";
import { CONSENTS, consentsSigned, eligibilityStatusLabel, vobDecisionLabel, vobDenyReasonLabel } from "@/lib/gateway";
import type { RouteSuggestion } from "@/lib/vob";
import { applyCaseBenefits, checkCaseEligibility, decideVob, handOffCase, markDataVerified, markSelfPay, moveCase, requestMissingInfo, sendConsents } from "../actions";
import { Tag, eligibilityTone } from "../views";

// Sync components for the case page; the page loads everything they show.

export type ConsentRequestInfo = { status: string; sentTo: string | null; createdAt: Date; completedAt: Date | null; link: string } | null;

const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? "—" : formatMoney(cents));

const SUGGEST_TONE: Record<RouteSuggestion["kind"], string> = { TAKE_DIRECT: "ok", SEND_TO_VOB: "warn", DECLINE: "bad", NOT_READY: "muted" };

export function SuggestionBox({ suggestion, kicker = "System suggestion · learned from VOB decisions" }: { suggestion: RouteSuggestion; kicker?: string }) {
  const s = suggestion.stats;
  return (
    <div className={`gw-suggest gw-suggest-${SUGGEST_TONE[suggestion.kind]}`}>
      <span className="gw-suggest-kicker">{kicker}</span>
      <strong>{suggestion.headline}</strong>
      {suggestion.reasons.map((r) => (
        <p key={r}>{r}</p>
      ))}
      {s && s.cases > 0 && (
        <p className="muted">
          Record: {s.approvedAll} all services · {s.approvedLimited} E&amp;M + debridement only · {s.denied} denied · auth needed on {s.needAuth} · referral on {s.needReferral}
          {s.lastDecisionAt ? ` · last decision ${formatDate(s.lastDecisionAt)}` : ""}
        </p>
      )}
    </div>
  );
}

// The clearinghouse answer: what came back, the full benefits to view or print, and anything that differs from the chart.
export function EligibilityBlock({
  c,
  check,
  fields,
  canRun,
  hasInsurance,
}: {
  c: IntakeCase;
  check: EligibilityCheck | null;
  fields: BenefitField[];
  canRun: boolean;
  hasInsurance: boolean;
}) {
  const mismatches = fields.filter((f) => f.state === "MISMATCH");
  return (
    <div className="gw-elig">
      {check ? (
        <>
          <div className="gw-facts">
            <div>
              <span>Clearinghouse result</span>
              <Tag tone={check.status === "ACTIVE" ? "ok" : check.status === "INACTIVE" ? "bad" : "warn"}>
                {check.status === "ACTIVE" ? "Active coverage" : check.status === "INACTIVE" ? "Inactive / termed" : "No definitive answer"}
              </Tag>
            </div>
            <div>
              <span>Plan</span>
              {check.planName ?? "—"}
            </div>
            <div>
              <span>Checked</span>
              {formatDate(check.checkedAt)} {formatTime(check.checkedAt)}
            </div>
            <div>
              <span>Copay</span>
              {money(check.copayCents)}
            </div>
            <div>
              <span>Coinsurance</span>
              {check.coinsurancePercent === null ? "—" : `${check.coinsurancePercent}%`}
            </div>
            <div>
              <span>Deductible / out-of-pocket remaining</span>
              {money(check.deductibleRemainingCents)} / {money(check.outOfPocketRemainingCents)}
            </div>
          </div>
          {check.payerMessage && <p className="muted">Payer message: {check.payerMessage}</p>}
        </>
      ) : (
        <p className="muted">
          {c.eligibilityStatus === "SELF_PAY"
            ? "Self-pay — no eligibility to check."
            : hasInsurance
              ? "Not checked yet. The check goes to the payer through the clearinghouse and fills in the benefits."
              : "Add the patient's insurance (Edit demographics & insurance) to check eligibility."}
        </p>
      )}
      <div className="gw-actions">
        {canRun && hasInsurance && (
          <form action={checkCaseEligibility.bind(null, c.id)}>
            <button className={check ? "btn secondary" : "btn"} type="submit">
              {check ? "Re-check eligibility" : "Check eligibility"}
            </button>
          </form>
        )}
        {check && (
          <Link className="btn secondary" href={`/patients/${c.patientId}/insurance/benefits/${check.id}?case=${c.id}`}>
            View / print benefits
          </Link>
        )}
        {canRun && !hasInsurance && c.stage === "DATA_ENTRY" && c.eligibilityStatus !== "SELF_PAY" && (
          <form action={markSelfPay.bind(null, c.id)}>
            <button className="btn ghost" type="submit">
              Patient is self-pay
            </button>
          </form>
        )}
      </div>

      {check?.status === "ACTIVE" && mismatches.length > 0 && (
        <form action={applyCaseBenefits.bind(null, c.id)} className="gw-mismatch">
          <strong>
            {mismatches.length === 1 ? "1 field differs" : `${mismatches.length} fields differ`} from the payer&apos;s response
          </strong>
          <table>
            <thead>
              <tr>
                <th>Use payer&apos;s</th>
                <th>Field</th>
                <th>Entered</th>
                <th>Payer returned</th>
              </tr>
            </thead>
            <tbody>
              {mismatches.map((f) => (
                <tr key={f.key}>
                  <td>
                    <input type="checkbox" name="keys" value={f.key} defaultChecked aria-label={`Use the payer's ${f.label}`} disabled={!canRun} />
                  </td>
                  <td>{f.label}</td>
                  <td>{f.current}</td>
                  <td>
                    <strong>{f.payer}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {canRun && (
            <div className="gw-actions">
              <button className="btn secondary" type="submit">
                Update ticked fields with the payer&apos;s values
              </button>
              <span className="muted">Untick a field to keep what was entered.</span>
            </div>
          )}
        </form>
      )}
      {check?.status === "ACTIVE" && mismatches.length === 0 && fields.length > 0 && (
        <p className="muted">All {fields.length} fields the payer returned agree with the chart.</p>
      )}
    </div>
  );
}

function ConsentStatus({ c, consent, canSend }: { c: IntakeCase; consent: ConsentRequestInfo; canSend: boolean }) {
  const signed = consentsSigned(c);
  const all = signed === CONSENTS.length;
  const open = consent && ["SENT", "OPENED", "IN_PROGRESS"].includes(consent.status);
  return (
    <div className="gw-consent-status">
      <Tag tone={all ? "ok" : "warn"}>
        {signed}/{CONSENTS.length} consents signed
      </Tag>
      {consent ? (
        <span className="muted">
          {consent.status === "COMPLETED"
            ? `Signed online ${consent.completedAt ? formatDate(consent.completedAt) : ""} — the signed copy is under Scans → Consents`
            : open
              ? `Sent for e-signature ${formatDate(consent.createdAt)}${consent.sentTo ? ` to ${consent.sentTo}` : ""} · ${consent.status === "SENT" ? "not opened yet" : "opened by the patient"}`
              : "The consent link has expired or was withdrawn"}
        </span>
      ) : (
        <span className="muted">{all ? "" : "Not sent yet"}</span>
      )}
      {open && <CopyButton text={consent.link} label="Copy consent link" />}
      {canSend && !all && c.stage !== "DATA_ENTRY" && c.stage !== "CLOSED" && (
        <form action={sendConsents.bind(null, c.id)}>
          <button className="btn ghost gw-mini" type="submit">
            {open ? "Re-send consent forms" : "Send consent forms"}
          </button>
        </form>
      )}
    </div>
  );
}

function Step({ n, title, state, children }: { n: number; title: string; state: "done" | "todo" | "wait"; children: React.ReactNode }) {
  return (
    <li className={`gw-step gw-step-${state}`}>
      <span className="gw-step-mark" aria-hidden>
        {state === "done" ? "✓" : n}
      </span>
      <div>
        <strong>{title}</strong>
        {children}
      </div>
    </li>
  );
}

// Data entry's five steps: documents read, details complete, eligibility checked, verified by hand, consents out + hand-off.
export function DataEntrySteps({
  c,
  gaps,
  documents,
  check,
  fields,
  hasInsurance,
  suggestion,
  consent,
  directProviders,
  verifiedBy,
  canWork,
}: {
  c: IntakeCase;
  gaps: string[];
  documents: { total: number; read: number };
  check: EligibilityCheck | null;
  fields: BenefitField[];
  hasInsurance: boolean;
  suggestion: RouteSuggestion;
  consent: ConsentRequestInfo;
  // Providers the patient may be booked with when taken directly: in network with the payer (any, for self-pay).
  directProviders: { id: string; name: string }[];
  verifiedBy: string | null;
  canWork: boolean;
}) {
  const detailGaps = gaps.filter((g) => g !== "eligibility check");
  const eligibilityDone = c.eligibilityStatus === "SELF_PAY" || Boolean(c.eligibilityCheckedAt);
  const verified = Boolean(c.dataVerifiedAt);
  const ready = gaps.length === 0 && verified;
  const direct = suggestion.kind === "TAKE_DIRECT";
  const allSigned = consentsSigned(c) === CONSENTS.length;
  const consentOpen = Boolean(consent && ["SENT", "OPENED", "IN_PROGRESS"].includes(consent.status));

  return (
    <section className="panel gw-checklist">
      <div className="gw-section-head">
        <h2>Data entry checklist</h2>
        {c.infoRequestedAt && <Tag tone="warn">Waiting on {c.infoRequestedFrom}</Tag>}
      </div>
      <ol className="gw-steps">
        <Step n={1} title="Upload the documents — details are read and filled in automatically" state={documents.total > 0 ? "done" : "todo"}>
          <p className="muted">
            {documents.total > 0 ? `${documents.total} document${documents.total === 1 ? "" : "s"} on file, ${documents.read} read and filed under Scans.` : "Nothing uploaded yet."}{" "}
            <a href="#documents">Upload more below</a>
          </p>
        </Step>

        <Step n={2} title="Complete the patient, insurance and referral details" state={detailGaps.length ? (c.infoRequestedAt ? "wait" : "todo") : "done"}>
          <p className="muted">
            {detailGaps.length ? (
              <>
                Still missing: <span className="gw-missing">{detailGaps.join(", ")}</span>
              </>
            ) : (
              "Everything required is entered."
            )}
          </p>
          {c.infoRequestedAt ? (
            <form action={requestMissingInfo.bind(null, c.id)} className="gw-waiting">
              <input type="hidden" name="received" value="1" />
              <span>
                Requested from <strong>{c.infoRequestedFrom}</strong> on {formatDate(c.infoRequestedAt)}: {c.infoRequestNote}
              </span>
              {canWork && (
                <button className="btn secondary gw-mini" type="submit">
                  Mark received
                </button>
              )}
            </form>
          ) : (
            canWork && (
              <details className="gw-inline-form">
                <summary>Something missing? Request it from the BD / referral source</summary>
                <form action={requestMissingInfo.bind(null, c.id)}>
                  <input name="from" placeholder="From (BD name / facility)" defaultValue={c.referralContactName ?? c.referralSourceName ?? ""} aria-label="Requested from" />
                  <input name="note" required placeholder="What is needed — e.g. updated insurance card, previous wound records" aria-label="What is needed" style={{ flex: 1 }} />
                  <button className="btn secondary" type="submit">
                    Log request
                  </button>
                </form>
              </details>
            )
          )}
        </Step>

        <Step n={3} title="Check eligibility with the payer (clearinghouse)" state={eligibilityDone ? "done" : "todo"}>
          <EligibilityBlock c={c} check={check} fields={fields} canRun={canWork} hasInsurance={hasInsurance} />
        </Step>

        <Step n={4} title="Manual verification" state={verified ? "done" : "todo"}>
          {verified ? (
            <form action={markDataVerified.bind(null, c.id)} className="gw-waiting">
              <input type="hidden" name="undo" value="1" />
              <span>
                Verified by <strong>{verifiedBy ?? "staff"}</strong> on {formatDate(c.dataVerifiedAt!)}.
              </span>
              {canWork && (
                <button className="btn ghost gw-mini" type="submit">
                  Reopen
                </button>
              )}
            </form>
          ) : (
            <form action={markDataVerified.bind(null, c.id)} className="gw-verify">
              <label className="checkbox-inline">
                <input type="checkbox" name="confirm" required disabled={!canWork || gaps.length > 0} /> I checked the demographics, insurance and benefits against the uploaded documents and the
                payer&apos;s response.
              </label>
              {canWork && (
                <button className="btn secondary" type="submit" disabled={gaps.length > 0}>
                  Mark verified
                </button>
              )}
              {gaps.length > 0 && <span className="muted">Finish steps 2 and 3 first.</span>}
            </form>
          )}
        </Step>

        <Step n={5} title="Send consent forms and hand off" state="todo">
          <SuggestionBox suggestion={suggestion} />
          <ConsentStatus c={c} consent={consent} canSend={canWork} />
          {canWork && (
            <form action={handOffCase.bind(null, c.id, "VOB")} className="gw-handoff-steps">
              {!allSigned && (
                <label className="checkbox-inline">
                  <input type="checkbox" name="sendConsents" defaultChecked={!consentOpen} /> {consentOpen ? "Re-send" : "Send"} the consent forms to the patient for e-signature now (text / email). The signed
                  copy is saved under Scans automatically.
                </label>
              )}
              {direct && (
                <label>
                  Rendering provider{c.eligibilityStatus === "SELF_PAY" ? "" : " (credentialed with this payer)"}
                  <select name="assignedProviderId" defaultValue={directProviders.find((p) => p.id === c.assignedProviderId)?.id ?? directProviders[0]?.id ?? ""}>
                    {directProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="gw-actions">
                {direct && (
                  <button className="btn" type="submit" formAction={handOffCase.bind(null, c.id, "DIRECT")} disabled={!ready}>
                    Take patient directly → scheduling
                  </button>
                )}
                <button className={direct ? "btn secondary" : "btn"} type="submit" disabled={!ready}>
                  Share with VOB team →
                </button>
                {!ready && <span className="muted">{gaps.length ? `Still missing: ${gaps.join(", ")}` : "Mark the data as verified first (step 4)."}</span>}
              </div>
            </form>
          )}
        </Step>
      </ol>
    </section>
  );
}

// The VOB team's decision on a case in their queue.
export function VobDecisionPanel({
  c,
  suggestion,
  consent,
  needsOverride,
  network,
  plan,
  decidedBy,
}: {
  c: IntakeCase;
  suggestion: RouteSuggestion;
  consent: ConsentRequestInfo;
  needsOverride: boolean;
  network: NetworkStatus | undefined;
  // Credentialing's answer for the patient's actual plan under the payer.
  plan: PlanApproval | null;
  decidedBy: string | null;
}) {
  const waiting = c.stage !== "VERIFICATION";
  return (
    <section className="panel gw-handoff gw-vob">
      <div className="gw-section-head" style={{ flex: "1 1 100%" }}>
        <h2>VOB decision</h2>
        <span>
          <Tag tone={eligibilityTone(c.eligibilityStatus)}>{eligibilityStatusLabel[c.eligibilityStatus]}</Tag>{" "}
          {c.assignedProviderId ? (
            <Tag tone={network?.network === "IN_NETWORK" ? "ok" : network?.network === "PENDING" ? "warn" : "bad"}>
              {network?.network === "IN_NETWORK" ? "Provider in network" : network?.network === "PENDING" ? "Credentialing pending" : "Provider not credentialed"}
            </Tag>
          ) : (
            <Tag tone="warn">No rendering provider</Tag>
          )}{" "}
          {plan && (
            <Tag tone={plan.status === "APPROVED" ? "ok" : plan.status === "NOT_APPROVED" ? "bad" : "warn"}>
              {plan.status === "APPROVED" ? "Plan approved" : plan.status === "NOT_APPROVED" ? "Plan not approved" : "Plan not reviewed"}
            </Tag>
          )}
        </span>
      </div>
      {c.vobDecision === "HOLD" && (
        <p className="gw-hold" style={{ flex: "1 1 100%" }}>
          <strong>On hold</strong> since {c.vobDecisionAt ? formatDate(c.vobDecisionAt) : "—"}
          {decidedBy ? ` (${decidedBy})` : ""} — {waiting ? "waiting for the authorization / referral below. The case returns here once it is approved or denied." : "the authorization / referral is back: record the final decision."}
          {c.vobDecisionNote ? ` Note: ${c.vobDecisionNote}` : ""}
        </p>
      )}
      <div style={{ flex: "1 1 100%" }}>
        <SuggestionBox suggestion={suggestion} kicker="Why this case is with VOB · what data entry was told" />
        <ConsentStatus c={c} consent={consent} canSend />
      </div>
      <form action={decideVob.bind(null, c.id)} className="vob-form">
        <fieldset className="vob-choices">
          <legend>Verify the benefits against credentialing, then decide</legend>
          {Object.entries(vobDecisionLabel).map(([k, l]) => (
            <label key={k} className={`vob-choice vob-choice-${k.toLowerCase()}`}>
              <input type="radio" name="decision" value={k} required /> {l}
            </label>
          ))}
        </fieldset>
        <label className="vob-when vob-when-denied">
          Reason for denying
          <select name="denyReason" defaultValue="">
            <option value="">— choose —</option>
            {Object.entries(vobDenyReasonLabel).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <div className="vob-when vob-when-hold">
          <span>Waiting for</span>
          <label className="checkbox-inline">
            <input type="checkbox" name="holdAuth" defaultChecked={c.authRequired === "YES" && c.authStatus !== "APPROVED"} /> Prior authorization
          </label>
          <label className="checkbox-inline">
            <input type="checkbox" name="holdReferral" defaultChecked={c.referralRequired === "YES" && c.referralStatus !== "RECEIVED"} /> Referral (PCC)
          </label>
        </div>
        {needsOverride && (
          <label className="vob-when vob-when-approved">
            Provider is not credentialed with this payer — document the override
            <input name="override" placeholder="e.g. single-case agreement approved by payer, ref #…" />
          </label>
        )}
        <label className="vob-note">
          Note (kept with the decision)
          <input name="note" placeholder="What you verified, who you spoke to, limits…" />
        </label>
        <button className="btn" type="submit">
          Record VOB decision
        </button>
      </form>
      <details className="gw-inline-form">
        <summary>Return to data entry</summary>
        <form action={moveCase.bind(null, c.id, "RETURN_TO_DATA_ENTRY")}>
          <input name="note" required placeholder="What needs correcting?" />
          <button className="btn secondary" type="submit">
            Return
          </button>
        </form>
      </details>
    </section>
  );
}
