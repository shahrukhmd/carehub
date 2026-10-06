import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatTime, patientName } from "@/lib/format";
import { FLOW_ROLES, FLOW_STAGES, flowTimes, minutesBetween } from "@/lib/flow";
import { visitTypeNames } from "@/lib/scheduler-setup";
import { AutoRefresh } from "@/components/AutoRefresh";
import { flowStep } from "./actions";

type Search = { date?: string; locationId?: string; providerId?: string; privacy?: string; error?: string };

const mins = (n: number | null) => (n === null ? "—" : n < 60 ? `${n} min` : `${Math.floor(n / 60)} h ${n % 60} min`);
const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
};

export default async function FlowBoardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(FLOW_ROLES);
  const sp = await searchParams;
  const day = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? new Date(`${sp.date}T00:00:00`) : new Date(new Date().setHours(0, 0, 0, 0));
  const end = new Date(day.getTime() + 86_400_000);
  const isToday = day.toDateString() === new Date().toDateString();
  const privacy = sp.privacy === "1";
  const [appts, locations, providers, types] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        practiceId: user.practiceId,
        startsAt: { gte: day, lt: end },
        ...(sp.locationId ? { locationId: sp.locationId } : {}),
        ...(sp.providerId ? { providerId: sp.providerId } : {}),
      },
      include: { patient: true, provider: true, location: true, encounter: { select: { id: true, status: true } }, events: { orderBy: { at: "asc" } } },
      orderBy: { startsAt: "asc" },
    }),
    prisma.location.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { memberships: { some: { practiceId: user.practiceId, role: "CLINICIAN" } } }, orderBy: { name: "asc" } }),
    visitTypeNames(user.practiceId),
  ]);
  const now = new Date();
  const rows = appts.map((a) => {
    const status = a.status;
    const t = flowTimes(a.events);
    const stage = FLOW_STAGES.find(([, , s]) => s.includes(status))?.[0] ?? "expected";
    const since = stage === "waiting" ? t.arrived : stage === "room" ? t.roomed : null;
    return { a, t, stage, waitNow: since ? minutesBetween(since, now) : null, late: stage === "expected" && a.startsAt < now };
  });
  const seen = rows.filter((r) => r.stage === "out");
  const stats = {
    wait: avg(rows.map((r) => minutesBetween(r.t.arrived, r.t.roomed))),
    total: avg(seen.map((r) => minutesBetween(r.t.arrived, r.t.out))),
    noShows: rows.filter((r) => r.a.status === "NO_SHOW").length,
  };
  const name = (p: { firstName: string; lastName: string }) => (privacy ? `${p.firstName[0]}. ${p.lastName[0]}.` : patientName(p));
  const q = (extra: Record<string, string>) => {
    const u = new URLSearchParams({ ...(sp.date ? { date: sp.date } : {}), ...(sp.locationId ? { locationId: sp.locationId } : {}), ...(sp.providerId ? { providerId: sp.providerId } : {}), ...(privacy ? { privacy: "1" } : {}), ...extra });
    return `/flow?${u}`;
  };

  return (
    <div className="stack">
      {isToday && <AutoRefresh seconds={30} />}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">Front desk</p>
          <h1>Patient flow board</h1>
        </div>
        <form className="cn-inline" method="get" style={{ margin: 0 }}>
          <input type="date" name="date" defaultValue={day.toISOString().slice(0, 10)} aria-label="Date" />
          <select name="locationId" defaultValue={sp.locationId ?? ""} aria-label="Location">
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <select name="providerId" defaultValue={sp.providerId ?? ""} aria-label="Provider">
            <option value="">All providers</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {privacy && <input type="hidden" name="privacy" value="1" />}
          <button className="btn secondary" type="submit">
            Show
          </button>
          <Link className="btn ghost" href={q({ privacy: privacy ? "0" : "1" })}>
            {privacy ? "Show names" : "Initials only"}
          </Link>
        </form>
      </div>
      <section className="grid-stats">
        <div className="stat">
          <span>Patients today</span>
          <strong>{rows.filter((r) => r.stage !== "missed").length}</strong>
        </div>
        <div className="stat">
          <span>Seen</span>
          <strong>{seen.length}</strong>
        </div>
        <div className="stat">
          <span>Average wait (arrived → room)</span>
          <strong>{mins(stats.wait)}</strong>
        </div>
        <div className="stat">
          <span>Average visit (arrived → out)</span>
          <strong>{mins(stats.total)}</strong>
        </div>
        <div className="stat">
          <span>No-shows</span>
          <strong>{stats.noShows}</strong>
        </div>
      </section>
      <div className="fb-board">
        {FLOW_STAGES.map(([key, label]) => {
          const list = rows.filter((r) => r.stage === key);
          return (
            <section key={key} className={`fb-col fb-${key}`}>
              <h2>
                {label} <span className="muted">{list.length}</span>
              </h2>
              {list.length === 0 && <p className="muted cn-small">—</p>}
              {list.map(({ a, t, waitNow, late }) => (
                <article key={a.id} className={`fb-card${waitNow !== null && waitNow >= 20 ? " fb-long" : ""}${late ? " fb-late" : ""}`}>
                  <div className="fb-top">
                    <strong>{name(a.patient)}</strong>
                    <span className="muted">{formatTime(a.startsAt)}</span>
                  </div>
                  <div className="muted cn-small">
                    {types[a.visitType] ?? a.visitType} · {a.provider.name}
                    {sp.locationId ? "" : ` · ${a.location.name}`}
                  </div>
                  <div className="cn-small fb-times">
                    {t.arrived && <span>Arrived {formatTime(t.arrived)}</span>}
                    {t.roomed && <span>Roomed {formatTime(t.roomed)}</span>}
                    {t.out && <span>Out {formatTime(t.out)}</span>}
                    {t.room && <span>Room {t.room}</span>}
                    {waitNow !== null && <span className="fb-wait">{key === "waiting" ? "Waiting" : "In room"} {mins(waitNow)}</span>}
                    {late && <span className="fb-wait">Late</span>}
                    {a.status === "NO_SHOW" && <span>No-show</span>}
                    {a.status === "CANCELLED" && <span>Cancelled</span>}
                  </div>
                  <div className="cn-actions">
                    {key === "expected" && (
                      <>
                        <form action={flowStep.bind(null, a.id, "arrive")}>
                          <button className="btn secondary gw-mini" type="submit">
                            Arrived
                          </button>
                        </form>
                        {late && (
                          <form action={flowStep.bind(null, a.id, "noshow")}>
                            <button className="btn ghost gw-mini" type="submit">
                              No-show
                            </button>
                          </form>
                        )}
                      </>
                    )}
                    {(key === "waiting" || key === "room") && (
                      <form action={flowStep.bind(null, a.id, "room")} className="fb-room">
                        <input name="room" placeholder="Room" defaultValue={t.room ?? ""} aria-label="Room" />
                        <button className="btn secondary gw-mini" type="submit">
                          {key === "waiting" ? "Room" : "Move"}
                        </button>
                      </form>
                    )}
                    {key === "room" && (
                      <form action={flowStep.bind(null, a.id, "out")}>
                        <button className="btn secondary gw-mini" type="submit">
                          Check out
                        </button>
                      </form>
                    )}
                    {(key === "waiting" || key === "room" || key === "out") && (
                      <Link className="btn ghost gw-mini" href={`/checkout?appointmentId=${a.id}`}>
                        {a.copayDueCents ? `Copay $${(a.copayDueCents / 100).toFixed(0)}` : "Payment"}
                      </Link>
                    )}
                    {a.encounter ? (
                      <Link className="btn ghost gw-mini" href={`/encounters/${a.encounter.id}`}>
                        Chart
                      </Link>
                    ) : (
                      a.status === "NO_SHOW" && (
                        <form action={flowStep.bind(null, a.id, "back")}>
                          <button className="btn ghost gw-mini" type="submit">
                            Undo
                          </button>
                        </form>
                      )
                    )}
                  </div>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
