import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { rolesFor } from "@/lib/permissions";
import { jobStatus } from "@/lib/jobs";
import { SettingsNav } from "../settings-nav";
import { runJobNow } from "./actions";

const when = (d: Date | null | undefined) => (d ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

// The background jobs: schedule, last run, a run log, and a button to run one now.
export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireUser(rolesFor("settings.admin"));
  const sp = await searchParams;
  const jobs = await jobStatus();
  const scheduler = process.env.CAREHUB_AUTOMATIONS === "off" ? "off (CAREHUB_AUTOMATIONS=off)" : process.env.DATABASE_URL?.startsWith("postgres") ? "on (pg-boss)" : "off (needs PostgreSQL)";

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link>
          </p>
          <h1>Automation runs</h1>
        </div>
        <span className="muted">Scheduler: {scheduler}</span>
      </div>
      <SettingsNav current="automations" />
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th>Schedule</th>
              <th>Last run</th>
              <th>Result</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.key}>
                <td>
                  <strong>{j.label}</strong>
                  <div className="muted cn-small">{j.about}</div>
                </td>
                <td className="cn-small">
                  <code>{j.cron}</code>
                </td>
                <td className="cn-small">
                  {when(j.last?.startedAt)}
                  {j.last ? <div className="muted">{j.last.triggeredBy === "MANUAL" ? "run by hand" : "scheduled"}</div> : null}
                </td>
                <td className="cn-small">
                  {j.last ? (
                    <>
                      <span className={`gw-tag gw-tag-${j.last.status === "OK" ? "ok" : j.last.status === "FAILED" ? "bad" : "warn"}`}>{j.last.status === "OK" ? "OK" : j.last.status === "FAILED" ? "Failed" : "Running"}</span>{" "}
                      {j.last.summary ?? j.last.error ?? ""}
                    </>
                  ) : (
                    <span className="muted">never run</span>
                  )}
                </td>
                <td>
                  <form action={runJobNow.bind(null, j.key)}>
                    <button className="btn secondary" type="submit">
                      Run now
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <h2>Recent runs</h2>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Job</th>
              <th>Trigger</th>
              <th>Status</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {jobs
              .flatMap((j) => j.recent.map((r) => ({ ...r, label: j.label })))
              .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
              .slice(0, 40)
              .map((r) => (
                <tr key={r.id}>
                  <td className="cn-small">{when(r.startedAt)}</td>
                  <td>{r.label}</td>
                  <td className="cn-small">{r.triggeredBy === "MANUAL" ? "by hand" : "schedule"}</td>
                  <td>
                    <span className={`gw-tag gw-tag-${r.status === "OK" ? "ok" : r.status === "FAILED" ? "bad" : "warn"}`}>{r.status}</span>
                  </td>
                  <td className="cn-small">{r.summary ?? r.error ?? ""}</td>
                </tr>
              ))}
            {jobs.every((j) => j.recent.length === 0) && (
              <tr>
                <td colSpan={5} className="muted">
                  No runs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
