import Link from "next/link";
import { formatDate } from "@/lib/format";
import { loadWaitingForTeam } from "@/lib/patient-thread";

// What other teams are waiting on from this user's team: unanswered messages on patients, and open tasks. Shown at
// the top of each team's own worklist, so there is no separate inbox to check.
export async function TeamWaiting({ user }: { user: { id: string; practiceId: string; role: string } }) {
  const rows = await loadWaitingForTeam(user);
  if (rows.length === 0) return null;
  return (
    <details className="panel tw-panel" open>
      <summary>
        <strong>Waiting for your team</strong> <span className="pill">{rows.length}</span>
        <span className="muted"> — messages other teams left on a patient for you. Reply on the patient to clear them.</span>
      </summary>
      <table className="tw-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="tw-who">
                <Link href={r.href}>
                  <strong>{r.patient}</strong>
                </Link>
                <div className="muted">{r.mrn}</div>
              </td>
              <td>
                {r.text}
                <div className="muted">
                  {r.from} · {formatDate(r.at)}
                </div>
              </td>
              <td className="tw-age">
                <span className={`gw-tag gw-tag-${r.days >= 2 ? "bad" : r.days >= 1 ? "warn" : "muted"}`}>{r.days === 0 ? "today" : `${r.days} day${r.days === 1 ? "" : "s"}`}</span>
              </td>
              <td className="tw-act">
                <Link className="btn secondary gw-mini" href={r.href}>
                  {r.kind === "TASK" ? "Open" : "Reply"}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
