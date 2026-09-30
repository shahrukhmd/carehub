import Link from "next/link";
import { formatDate } from "@/lib/format";
import { careGapsFor } from "@/lib/care-rules";
import { clearCareOverride, overrideCareGap } from "./actions";

const OVERRIDE: Record<string, string> = { DONE: "Done elsewhere", NOT_APPLICABLE: "Not applicable", REFUSED: "Patient refused" };

// Care-gap alerts for one patient (patient chart and visit chart).
export async function CareGapsPanel({ practiceId, patientId, back, compact }: { practiceId: string; patientId: string; back: string; compact?: boolean }) {
  const gaps = (await careGapsFor(practiceId, [patientId])).get(patientId) ?? [];
  const due = gaps.filter((g) => g.status === "DUE");
  if (compact && due.length === 0) return null;
  return (
    <section className={`panel cg-panel${due.some((g) => g.severity === "ALERT") ? " cg-alert" : ""}`}>
      <div className="gw-section-head">
        <h2>
          Care gaps {due.length > 0 && <span className="cg-count">{due.length} due</span>}
        </h2>
        <Link className="muted" href="/care-gaps">
          All patients
        </Link>
      </div>
      {gaps.length === 0 && <p className="muted">No care rules apply to this patient.</p>}
      <ul className="cg-list">
        {gaps
          .filter((g) => !compact || g.status === "DUE")
          .map((g) => (
            <li key={g.ruleId} className={`cg-${g.status.toLowerCase()}`}>
              <span className="cg-mark" aria-hidden="true">
                {g.status === "MET" ? "✓" : g.status === "OVERRIDDEN" ? "–" : "!"}
              </span>
              <div>
                <strong>{g.name}</strong>
                <div className="muted cn-small">
                  {g.status === "DUE"
                    ? g.message
                    : g.status === "MET"
                      ? `Done ${formatDate(g.lastDone!)} · next due ${formatDate(g.dueDate!)}`
                      : `${OVERRIDE[g.override!.status]}${g.override!.note ? ` — ${g.override!.note}` : ""}`}
                  {g.status === "DUE" && g.lastDone ? ` Last done ${formatDate(g.lastDone)}.` : ""}
                </div>
              </div>
              {g.status === "DUE" && (
                <details className="cg-act">
                  <summary className="btn ghost gw-mini">Address</summary>
                  <form action={overrideCareGap.bind(null, g.ruleId, patientId)} className="cn-inline">
                    <input type="hidden" name="back" value={back} />
                    <select name="status" aria-label="How it was addressed">
                      {Object.entries(OVERRIDE).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                    <input name="note" placeholder="Note (optional)" />
                    <button className="btn secondary gw-mini" type="submit">
                      Save
                    </button>
                  </form>
                </details>
              )}
              {g.status === "OVERRIDDEN" && (
                <form action={clearCareOverride.bind(null, g.ruleId, patientId)}>
                  <input type="hidden" name="back" value={back} />
                  <button className="btn ghost gw-mini" type="submit">
                    Undo
                  </button>
                </form>
              )}
            </li>
          ))}
      </ul>
    </section>
  );
}
