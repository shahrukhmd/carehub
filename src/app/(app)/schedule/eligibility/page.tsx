import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney, formatTime, patientName } from "@/lib/format";
import { ELIGIBILITY_ROLES, appointmentsForEligibility, nextBusinessDay } from "@/lib/eligibility-batch";
import { checkAll, checkOne, setAutoEligibility } from "./actions";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const TONE: Record<string, string> = { ACTIVE: "ok", INACTIVE: "bad", ERROR: "bad", UNKNOWN: "warn" };

export default async function EligibilityPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; done?: string; error?: string }> }) {
  const user = await requireUser(ELIGIBILITY_ROLES);
  const sp = await searchParams;
  const def = nextBusinessDay();
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? new Date(`${sp.from}T00:00:00`) : def;
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? new Date(`${sp.to}T00:00:00`) : from;
  const [appts, settings] = await Promise.all([
    appointmentsForEligibility(user.practiceId, from, new Date(to.getTime() + 86_400_000)),
    prisma.practiceSettings.findUnique({ where: { practiceId: user.practiceId } }),
  ]);
  const done = sp.done?.split("|").map(Number);
  const week = Date.now() - 7 * 86_400_000;
  const counts = { current: 0, problem: 0, unchecked: 0, selfPay: 0 };
  for (const a of appts) {
    const c = a.eligibilityChecks[0];
    if (!a.patient.insurances.length) counts.selfPay++;
    else if (!c || c.checkedAt.getTime() < week) counts.unchecked++;
    else if (c.status === "ACTIVE") counts.current++;
    else counts.problem++;
  }

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/schedule">Schedule</Link>
          </p>
          <h1>Batch eligibility</h1>
          <p className="muted" style={{ margin: 0 }}>
            Check insurance for every upcoming visit at once, so problems are fixed before the patient arrives.
          </p>
        </div>
      </div>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {done && (
        <p className={done[3] ? "gw-error" : "notice-ok"}>
          {done[0]} checked · {done[1]} already current · {done[2]} self-pay{done[3] ? ` · ${done[3]} need attention (see below)` : ""}.
        </p>
      )}
      <form action={checkAll} className="cn-inline panel">
        <label className="checkbox-inline">
          From <input type="date" name="from" defaultValue={iso(from)} />
        </label>
        <label className="checkbox-inline">
          To <input type="date" name="to" defaultValue={iso(to)} />
        </label>
        <label className="checkbox-inline">
          <input type="checkbox" name="force" /> Re-check ones done this week
        </label>
        <button className="btn" type="submit">
          Check all
        </button>
        <Link className="btn ghost" href={`/schedule/eligibility?from=${iso(from)}&to=${iso(to)}`}>
          Show
        </Link>
      </form>
      <section className="grid-stats">
        <div className="stat">
          <span>Visits</span>
          <strong>{appts.length}</strong>
        </div>
        <div className="stat">
          <span>Active coverage</span>
          <strong>{counts.current}</strong>
        </div>
        <div className="stat">
          <span>Need attention</span>
          <strong>{counts.problem}</strong>
        </div>
        <div className="stat">
          <span>Not checked this week</span>
          <strong>{counts.unchecked}</strong>
        </div>
        <div className="stat">
          <span>No insurance on file</span>
          <strong>{counts.selfPay}</strong>
        </div>
      </section>
      <section className="panel">
        {appts.length === 0 ? (
          <p className="muted">No visits in this range.</p>
        ) : (
          <table className="cn-table">
            <thead>
              <tr>
                <th>Visit</th>
                <th>Patient</th>
                <th>Insurance</th>
                <th>Eligibility</th>
                <th>Copay</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {appts.map((a) => {
                const ins = a.patient.insurances[0];
                const c = a.eligibilityChecks[0];
                const stale = c && c.checkedAt.getTime() < week;
                return (
                  <tr key={a.id}>
                    <td>
                      {formatDate(a.startsAt)} {formatTime(a.startsAt)}
                      <div className="muted cn-small">{a.provider.name}</div>
                    </td>
                    <td>
                      <Link href={`/patients/${a.patientId}`}>{patientName(a.patient)}</Link>
                    </td>
                    <td className="cn-small">{ins ? `${ins.payer.name} · ${ins.memberId}` : <span className="gw-missing">Self-pay / none on file</span>}</td>
                    <td>
                      {c ? (
                        <>
                          <span className={`gw-tag gw-tag-${TONE[c.status] ?? "info"}`}>{c.status.toLowerCase()}</span>
                          <div className="muted cn-small">
                            {formatDate(c.checkedAt)}
                            {stale ? " · out of date" : ""}
                            {c.planName ? ` · ${c.planName}` : ""}
                          </div>
                          {c.payerMessage && <div className="muted cn-small">{c.payerMessage}</div>}
                          {c.deductibleRemainingCents !== null && <div className="muted cn-small">Deductible left {formatMoney(c.deductibleRemainingCents)}</div>}
                        </>
                      ) : (
                        <span className="muted">Not checked</span>
                      )}
                    </td>
                    <td>{a.copayDueCents !== null ? formatMoney(a.copayDueCents) : c?.copayCents !== null && c?.copayCents !== undefined ? formatMoney(c.copayCents) : "—"}</td>
                    <td>
                      {ins && (
                        <form action={checkOne.bind(null, a.id)}>
                          <input type="hidden" name="from" value={iso(from)} />
                          <input type="hidden" name="to" value={iso(to)} />
                          <button className="btn ghost gw-mini" type="submit">
                            {c ? "Re-check" : "Check"}
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      {user.role === "ADMIN" && (
        <form action={setAutoEligibility} className="cn-inline panel">
          <label className="checkbox-inline">
            <input type="checkbox" name="eligibilityAuto" defaultChecked={settings?.eligibilityAuto} /> Check the next business day&apos;s appointments automatically every evening
          </label>
          <button className="btn ghost gw-mini" type="submit">
            Save
          </button>
          <span className="muted cn-small">Runs after 6 pm through the connected clearinghouse; problems show here and on the schedule.</span>
        </form>
      )}
    </div>
  );
}
