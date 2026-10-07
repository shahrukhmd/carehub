import Link from "next/link";
import { formatDate, formatTime } from "@/lib/format";
import { THREAD_ROLES, THREAD_TEAMS, loadPatientThread, waitingFor, type ThreadItem } from "@/lib/patient-thread";
import { markMessageAnswered, postPatientMessage } from "@/app/(app)/patients/[id]/thread/actions";
import { allowed } from "@/lib/permissions";

const KIND: Record<ThreadItem["kind"], [string, string]> = {
  MESSAGE: ["Message", "info"],
  CASE: ["Gateway", "muted"],
  VISIT: ["Visit", "muted"],
  CLAIM: ["Claim", "muted"],
  TASK: ["Task", "muted"],
};

// The patient's thread with a box to message a team. Used on the chart, and on the screens where teams work the
// patient, so nobody leaves their step to ask a question.
//   back:      the screen this is shown on (the reader lands back here after posting)
//   only:      "messages" hides the system history
//   limit:     how many entries to show before the link to the full thread
//   suggestTo: the team most likely to be asked from this screen
export async function PatientThread({
  user,
  patientId,
  back,
  only,
  limit = 60,
  suggestTo,
  notice,
  fullThreadHref,
}: {
  user: { id: string; practiceId: string; role: string };
  patientId: string;
  back: string;
  only?: string;
  limit?: number;
  suggestTo?: string;
  notice?: { ok?: string; error?: string };
  // Shown on a team's own screen: only the messages, with a link to everything on the patient.
  fullThreadHref?: string;
}) {
  const all = await loadPatientThread(user.practiceId, patientId);
  const waiting = waitingFor(all, user.role);
  const open = all.filter((i) => i.message?.needsReply && !i.message.answeredAt);
  const shown = (only === "messages" ? all.filter((i) => i.kind === "MESSAGE") : only === "open" ? open : all).slice(0, limit);
  const canWrite = allowed(user, THREAD_ROLES);
  const byId = new Map(all.filter((i) => i.message).map((i) => [i.message!.id, i]));

  return (
    <section className="panel pt-thread" id="thread">
      <div className="gw-section-head">
        <h2>
          Team communication <span className="pill">{all.filter((i) => i.kind === "MESSAGE").length}</span>
        </h2>
        <span>
          {waiting.length > 0 && <span className="gw-tag gw-tag-bad">{waiting.length} waiting for your team</span>}{" "}
          {open.length > waiting.length && <span className="gw-tag gw-tag-warn">{open.length - waiting.length} waiting for another team</span>}{" "}
          {fullThreadHref && (
            <Link className="muted" href={fullThreadHref}>
              Full history on the patient
            </Link>
          )}
        </span>
      </div>
      {notice?.error && (
        <p className="gw-error" role="alert">
          {notice.error}
        </p>
      )}
      {notice?.ok && <p className="notice-ok">{notice.ok}</p>}

      {canWrite && (
        <form action={postPatientMessage.bind(null, patientId)} className="pt-compose">
          <input type="hidden" name="back" value={back} />
          <textarea name="body" required rows={2} maxLength={4000} placeholder="Message a team about this patient — it stays on the patient's record" aria-label="Message" />
          <div className="pt-compose-row">
            <label>
              To
              <select name="toTeam" defaultValue={suggestTo ?? ""}>
                <option value="">Everyone on this patient (a note)</option>
                {Object.entries(THREAD_TEAMS)
                  .filter(([k]) => k !== "CREDENTIALING" || user.role === "VERIFICATION" || user.role === "ADMIN")
                  .map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
              </select>
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="needsReply" /> Needs a reply
            </label>
            <button className="btn" type="submit">
              Add to thread
            </button>
          </div>
        </form>
      )}

      {shown.length === 0 ? (
        <p className="muted">{only === "messages" ? "No messages between teams on this patient yet." : "Nothing yet."}</p>
      ) : (
        <ul className="pt-list">
          {shown.map((i) => {
            const m = i.message;
            const mine = Boolean(m && m.needsReply && !m.answeredAt && m.toTeam === user.role);
            const replyTo = m?.replyToId ? byId.get(m.replyToId) : null;
            return (
              <li key={i.key} className={`pt-item pt-${i.kind.toLowerCase()}${mine ? " pt-mine" : ""}`}>
                <div className="pt-meta">
                  <span className={`gw-tag gw-tag-${KIND[i.kind][1]}`}>{KIND[i.kind][0]}</span>
                  <strong>{i.who}</strong>
                  {i.team && <span className="muted">{i.team}</span>}
                  {m?.toTeam && <span>→ {THREAD_TEAMS[m.toTeam] ?? m.toTeam}</span>}
                  <span className="muted">
                    {formatDate(i.at)} {formatTime(i.at)}
                  </span>
                  {m?.needsReply && !m.answeredAt && <span className={`gw-tag gw-tag-${mine ? "bad" : "warn"}`}>Needs a reply</span>}
                  {m?.needsReply && m.answeredAt && (
                    <span className="gw-tag gw-tag-ok">
                      Answered{m.answeredBy ? ` by ${m.answeredBy}` : ""} {formatDate(m.answeredAt)}
                    </span>
                  )}
                  {i.link && (
                    <Link href={i.link} className="muted">
                      open
                    </Link>
                  )}
                </div>
                {replyTo && <p className="pt-quote">In reply to {replyTo.who}: {replyTo.text.slice(0, 140)}</p>}
                <p className="pt-text">{i.text}</p>
                {m && m.needsReply && !m.answeredAt && canWrite && (
                  <div className="pt-reply">
                    <form action={postPatientMessage.bind(null, patientId)}>
                      <input type="hidden" name="back" value={back} />
                      <input type="hidden" name="replyToId" value={m.id} />
                      <input name="body" required maxLength={4000} placeholder={`Reply to ${i.who}`} aria-label="Reply" />
                      <button className="btn secondary gw-mini" type="submit">
                        Reply
                      </button>
                    </form>
                    <form action={markMessageAnswered.bind(null, patientId, m.id)}>
                      <input type="hidden" name="back" value={back} />
                      <button className="btn ghost gw-mini" type="submit" title="Dealt with another way (by phone, or no longer needed)">
                        Mark dealt with
                      </button>
                    </form>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
