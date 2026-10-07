import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { rolesFor } from "@/lib/permissions";
import { MONITOR_CHECKS } from "@/lib/report-catalog";
import { SettingsNav } from "../settings-nav";
import { runMonitoringNow, saveMonitoringRules } from "./actions";

const when = (d: Date | null | undefined) => (d ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");

// Monitoring rules: built-in data-quality checks the practice switches on, with a threshold and recipients.
// They run every morning (Automation runs → Monitoring) and raise a task plus an email when a check trips.
export default async function MonitoringPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser(rolesFor("settings.admin"));
  const sp = await searchParams;
  const rules = await prisma.monitoringRule.findMany({ where: { practiceId: user.practiceId } });
  const rule = (key: string) => rules.find((r) => r.checkKey === key);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link>
          </p>
          <h1>Monitoring rules</h1>
        </div>
        <form action={runMonitoringNow}>
          <button className="btn secondary" type="submit">
            Run all checks now
          </button>
        </form>
      </div>
      <SettingsNav current="monitoring" />
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      <form action={saveMonitoringRules} className="panel stack">
        <p className="muted">
          Each check runs every morning for this practice. At or over the threshold it raises a task for the billing team and emails the recipients (comma-separated). The
          last result is shown so you can see what it would catch before switching it on.
        </p>
        <table>
          <thead>
            <tr>
              <th>On</th>
              <th>Check</th>
              <th>Alert at</th>
              <th>Email recipients</th>
              <th>Last run</th>
            </tr>
          </thead>
          <tbody>
            {MONITOR_CHECKS.map((c) => {
              const r = rule(c.key);
              return (
                <tr key={c.key}>
                  <td>
                    <input type="checkbox" name={`active:${c.key}`} defaultChecked={r?.active ?? false} aria-label={`Enable ${c.label}`} />
                  </td>
                  <td>
                    <strong>{c.label}</strong>
                    <div className="muted cn-small">{c.about}</div>
                  </td>
                  <td>
                    <input name={`threshold:${c.key}`} type="number" min={1} defaultValue={r?.threshold ?? c.defaultThreshold} style={{ width: "5rem" }} /> <span className="muted cn-small">{c.unit}</span>
                  </td>
                  <td>
                    <input name={`recipients:${c.key}`} defaultValue={r?.recipients ?? ""} placeholder="billing@…, manager@…" />
                  </td>
                  <td className="cn-small">
                    {when(r?.lastRunAt)}
                    {r?.lastRunAt ? (
                      <div>
                        <span className={`gw-tag gw-tag-${(r.lastCount ?? 0) >= r.threshold ? "warn" : "ok"}`}>{r.lastCount ?? 0}</span> {r.lastDetail}
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button className="btn" type="submit">
          Save rules
        </button>
      </form>
    </>
  );
}
