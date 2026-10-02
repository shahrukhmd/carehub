import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { parseIds } from "@/lib/charge-schedules";
import { formatDate } from "@/lib/format";
import { SettingsNav } from "../settings-nav";
import { createSchedule } from "./actions";

type Search = { error?: string; ok?: string };

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const scope = (ids: string, noun: string) => {
  const n = parseIds(ids).length;
  return n === 0 ? `All ${noun}s` : `${n} ${noun}${n === 1 ? "" : "s"}`;
};

// Charge schedules: what the practice charges per billing code, by site, provider and insurance.
export default async function ChargeSchedulesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(["ADMIN", "BILLER"]);
  const sp = await searchParams;
  const schedules = await prisma.chargeSchedule.findMany({
    where: { practiceId: user.practiceId },
    include: { items: { select: { feeCents: true } } },
    orderBy: [{ active: "desc" }, { startDate: "desc" }],
  });
  const now = Date.now();

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link>
          </p>
          <h1>Charge schedules</h1>
        </div>
      </div>
      <SettingsNav current="charge-schedules" role={user.role} />
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}

      <section className="panel">
        <div className="gw-section-head">
          <h2>Schedules</h2>
          <span className="muted">A visit&apos;s charges use the schedule that covers its date, site of service, provider and primary insurance</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>In effect</th>
              <th>Sites of service</th>
              <th>Providers</th>
              <th>Insurances</th>
              <th className="num">Codes with a fee</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => {
              const ended = s.endDate && s.endDate.getTime() + 86_400_000 < now;
              const future = s.startDate.getTime() > now;
              return (
                <tr key={s.id} className={s.active && !ended ? undefined : "cm-blocked"}>
                  <td>
                    <Link href={`/settings/charge-schedules/${s.id}`}>
                      <strong>{s.name}</strong>
                    </Link>
                  </td>
                  <td>
                    {formatDate(s.startDate)} – {s.endDate ? formatDate(s.endDate) : "no end date"}
                  </td>
                  <td>{scope(s.locationIds, "site")}</td>
                  <td>{scope(s.providerIds, "provider")}</td>
                  <td>{scope(s.payerIds, "insurance")}</td>
                  <td className="num">
                    {s.items.filter((i) => i.feeCents > 0).length} of {s.items.length}
                  </td>
                  <td>
                    <span className={`gw-tag gw-tag-${!s.active ? "muted" : ended ? "muted" : future ? "info" : "ok"}`}>{!s.active ? "Switched off" : ended ? "Ended" : future ? "Starts later" : "In effect"}</span>
                  </td>
                  <td className="num">
                    <Link className="btn secondary gw-mini" href={`/settings/charge-schedules/${s.id}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              );
            })}
            {schedules.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No charge schedules yet. Until one covers a visit, charges use the fees on the practice code list (Directories → Codes &amp; fees).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="gw-section-head">
          <h2>New charge schedule</h2>
          <span className="muted">Starts with every billing code on the practice code list, at its current fee</span>
        </div>
        <form action={createSchedule} className="form-grid gw-grid-3">
          <label>
            Name
            <input name="name" required maxLength={120} placeholder="e.g. 2027 standard fees" />
          </label>
          <label>
            Start date
            <input type="date" name="startDate" required defaultValue={today()} />
          </label>
          <label>
            End date (optional)
            <input type="date" name="endDate" />
          </label>
          <div className="pv-actions">
            <label className="cm-check">
              <input type="checkbox" name="active" defaultChecked />
              Active
            </label>
            <button className="btn" type="submit">
              Create and set fees
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
