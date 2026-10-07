import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/format";
import { CADENCES, CATALOG, RANGE_PRESETS, reportDef } from "@/lib/report-catalog";
import { deleteSubscription, saveSubscription, toggleSubscription } from "./actions";

const GROUPS: Record<string, string> = { ops: "Front office & operations", clinical: "Clinical & outcomes", revenue: "Revenue cycle", accounts: "Patient accounts", operations: "Operations" };
const iso = (d: Date) => d.toISOString().slice(0, 10);

// Saved views and scheduled deliveries: every report in the catalogue can be bookmarked with a date-range
// preset, or emailed daily, weekly or monthly as CSV.
export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const mine = await prisma.reportSubscription.findMany({ where: { practiceId: user.practiceId, userId: user.id }, orderBy: [{ cadence: "asc" }, { createdAt: "desc" }] });
  const allowed = CATALOG.filter((r) => can(user, r.permission));
  const link = (s: (typeof mine)[number]) => {
    const def = reportDef(s.reportKey);
    const { from, to } = (RANGE_PRESETS[s.rangePreset] ?? RANGE_PRESETS.LAST_7).range();
    return def ? `${def.href}&from=${iso(from)}&to=${iso(to)}` : "/reports";
  };

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/reports">Reports</Link>
          </p>
          <h1>My saved views &amp; subscriptions</h1>
        </div>
      </div>
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      <div className="two-col">
        <section className="panel">
          <h2>Mine</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Report</th>
                <th>Range</th>
                <th>Delivery</th>
                <th>Last sent</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {mine.map((s) => (
                <tr key={s.id} className={s.active ? undefined : "muted"}>
                  <td>
                    <Link href={link(s)}>{s.name}</Link>
                  </td>
                  <td className="cn-small">{reportDef(s.reportKey)?.label ?? s.reportKey}</td>
                  <td className="cn-small">{RANGE_PRESETS[s.rangePreset]?.label ?? s.rangePreset}</td>
                  <td className="cn-small">{s.cadence === "NONE" ? "Saved view" : `${CADENCES[s.cadence] ?? s.cadence} by email${s.active ? "" : " (paused)"}`}</td>
                  <td className="cn-small">{s.lastSentAt ? formatDate(s.lastSentAt) : "—"}</td>
                  <td className="cn-inline">
                    {s.cadence !== "NONE" && (
                      <form action={toggleSubscription.bind(null, s.id)}>
                        <button className="btn ghost gw-mini" type="submit">
                          {s.active ? "Pause" : "Resume"}
                        </button>
                      </form>
                    )}
                    <form action={deleteSubscription.bind(null, s.id)}>
                      <button className="btn ghost gw-mini" type="submit">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {mine.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Nothing saved yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
        <form className="panel stack" action={saveSubscription}>
          <h2>Add</h2>
          <label>
            Report
            <select name="reportKey" required defaultValue="">
              <option value="">Pick a report…</option>
              {Object.entries(GROUPS).map(([g, label]) => (
                <optgroup key={g} label={label}>
                  {allowed
                    .filter((r) => r.group === g)
                    .map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="form-grid gw-grid-3">
            <label>
              Date range
              <select name="rangePreset" defaultValue="LAST_7">
                {Object.entries(RANGE_PRESETS).map(([k, p]) => (
                  <option key={k} value={k}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Delivery
              <select name="cadence" defaultValue="NONE">
                <option value="NONE">Saved view only</option>
                {Object.entries(CADENCES).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l} by email
                  </option>
                ))}
              </select>
            </label>
            <label>
              Name (optional)
              <input name="name" maxLength={80} />
            </label>
          </div>
          <p className="muted cn-small">Emails go to {user.email}. Without an email provider connected they land in Settings → Message log. Every delivery is logged.</p>
          <button className="btn" type="submit">
            Save
          </button>
        </form>
      </div>
    </div>
  );
}
