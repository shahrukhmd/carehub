import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { can, rolesFor } from "@/lib/permissions";
import { formatDate, formatTime, patientName, US_STATES } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import {
  RESERVATION_STATUSES,
  STATE_NAMES,
  STATE_ZONE,
  TELEHEALTH_SUFFIXES,
  TELEHEALTH_ZONES,
  WINDOW_STATUS_LABEL,
  dateInZone,
  dateKeyInZone,
  parseLicenses,
  timeInZone,
  timeKeyInZone,
  windowSummary,
  zoneLabel,
} from "@/lib/telehealth";
import {
  addTelehealthAvailability,
  cancelTelehealthReservation,
  confirmTelehealthReservation,
  deleteTelehealthAvailability,
  deleteTelehealthProvider,
  moveTelehealthReservation,
  saveTelehealthProvider,
  setTelehealthOutcome,
  setTelehealthProviderStatus,
  updateTelehealthAvailability,
} from "./actions";

const TABS = [
  ["doctors", "Doctors"],
  ["availability", "Availability"],
  ["reservations", "Reservations"],
] as const;
type Tab = (typeof TABS)[number][0];

type SearchParams = { tab?: string; provider?: string; edit?: string; error?: string; ok?: string };
const DAY = 86_400_000;

// Telehealth scheduler admin: the doctors who take telehealth visits, the hours they are online (availability
// windows) and every reservation booked into those hours. Booking itself happens on the scheduler when the
// encounter type is Telehealth Initial Wound Care.
export default async function TelehealthAdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser(rolesFor("schedule.view"));
  const sp = await searchParams;
  const tab: Tab = (TABS.some(([t]) => t === sp.tab) ? sp.tab : "doctors") as Tab;
  const canSetup = can(user, "telehealth.setup");
  const canConfirm = can(user, "telehealth.confirm");
  const isAdmin = can(user, "settings.admin");
  const now = new Date();

  const [practice, providers, clinicians] = await Promise.all([
    prisma.practice.findUnique({ where: { id: user.practiceId }, select: { state: true } }),
    prisma.telehealthProvider.findMany({
      where: { practiceId: user.practiceId },
      include: { user: { select: { id: true, name: true, specialty: true } }, _count: { select: { reservations: { where: { status: { not: "CANCELLED" }, endsAt: { gt: now } } } } } },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.user.findMany({ where: { practiceId: user.practiceId, active: true, role: { in: ["CLINICIAN", "ADMIN"] } }, select: { id: true, name: true, specialty: true }, orderBy: { name: "asc" } }),
  ]);
  const editing = sp.edit ? providers.find((p) => p.id === sp.edit) ?? null : null;
  const providerFilter = sp.provider && providers.some((p) => p.id === sp.provider) ? sp.provider : "";
  const defaultZone = (practice?.state && STATE_ZONE[practice.state]) || "America/New_York";

  const windows =
    tab === "availability"
      ? await prisma.telehealthAvailability.findMany({
          where: { practiceId: user.practiceId, endsAt: { gte: new Date(now.getTime() - 7 * DAY) }, ...(providerFilter ? { providerId: providerFilter } : {}) },
          include: { provider: { include: { user: { select: { name: true } } } }, reservations: { select: { id: true, startsAt: true, endsAt: true, status: true } } },
          orderBy: [{ startsAt: "asc" }],
          take: 400,
        })
      : [];

  const reservations =
    tab === "reservations"
      ? await prisma.telehealthReservation.findMany({
          where: { practiceId: user.practiceId, endsAt: { gte: new Date(now.getTime() - 30 * DAY) }, ...(providerFilter ? { providerId: providerFilter } : {}) },
          include: { patient: { select: { id: true, firstName: true, lastName: true, mrn: true } }, provider: { include: { user: { select: { name: true } } } }, appointment: { select: { id: true, status: true, encounter: { select: { id: true } } } } },
          orderBy: { startsAt: "asc" },
          take: 400,
        })
      : [];
  const recents =
    tab === "reservations"
      ? await prisma.telehealthReservation.findMany({
          where: { practiceId: user.practiceId },
          include: { patient: { select: { firstName: true, lastName: true } }, provider: { include: { user: { select: { name: true } } } } },
          orderBy: { updatedAt: "desc" },
          take: 5,
        })
      : [];
  const staffIds = [...new Set(reservations.flatMap((r) => [r.reservedById, r.confirmedById]).filter((x): x is string => Boolean(x)))];
  const staff = new Map((staffIds.length ? await prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]));

  const tabHref = (t: Tab, extra: Record<string, string> = {}) => {
    const q = new URLSearchParams({ tab: t, ...(providerFilter ? { provider: providerFilter } : {}), ...extra });
    return `/schedule/telehealth?${q.toString()}`;
  };
  const doctorLabel = (p: { suffix: string; user: { name: string } }) => (p.suffix === "Dr." ? `Dr. ${p.user.name}` : `${p.user.name} (${p.suffix})`);

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/schedule">Scheduler</Link>
          </p>
          <h1>Telehealth scheduler</h1>
        </div>
        <Link className="btn secondary" href={`/schedule?bookType=TELE_INIT#book`}>
          Book a telehealth visit
        </Link>
      </div>
      <nav className="view-tabs st-tabs" aria-label="Telehealth">
        {TABS.map(([k, l]) => (
          <Link key={k} href={tabHref(k)} className={`view-tab${tab === k ? " active" : ""}`}>
            {l}
          </Link>
        ))}
      </nav>
      {sp.ok && <p className="th-ok">{sp.ok}</p>}
      {sp.error && (
        <p className="gw-error th-error" role="alert">
          {sp.error}
        </p>
      )}

      {tab === "doctors" && (
        <div className="two-col">
          <section className="panel">
            <div className="gw-section-head">
              <h2>Telehealth doctors</h2>
              <span className="muted">{providers.filter((p) => p.status === "ACTIVE").length} active</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Doctor</th>
                  <th>Specialty</th>
                  <th>Licensed states</th>
                  <th>Break rule</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => {
                  const licenses = parseLicenses(p.stateLicenses);
                  return (
                    <tr key={p.id}>
                      <td>
                        <strong>{doctorLabel(p)}</strong>
                        {p._count.reservations > 0 && <div className="muted cn-small">{p._count.reservations} upcoming</div>}
                      </td>
                      <td>{p.specialty ?? p.user.specialty ?? "—"}</td>
                      <td>{licenses.length ? licenses.join(", ") : <span className="gw-missing">None</span>}</td>
                      <td>{p.breakAfterBlocks ? `Break after ${p.breakAfterBlocks} blocks (windows ≥ ${p.breakMinWindowMin} min)` : "—"}</td>
                      <td>
                        <StatusBadge value={p.status} />
                      </td>
                      <td>
                        {canSetup && (
                          <div className="stack">
                            <Link className="btn ghost gw-mini" href={tabHref("doctors", { edit: p.id })}>
                              Edit
                            </Link>
                            <form action={setTelehealthProviderStatus.bind(null, p.id, p.status === "ACTIVE" ? "INACTIVE" : "ACTIVE")}>
                              <button className="btn ghost gw-mini" type="submit">
                                {p.status === "ACTIVE" ? "Set inactive" : "Set active"}
                              </button>
                            </form>
                            {isAdmin && (
                              <form action={deleteTelehealthProvider.bind(null, p.id)}>
                                <button className="btn ghost gw-mini" type="submit">
                                  Remove
                                </button>
                              </form>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {providers.length === 0 && (
                  <tr>
                    <td colSpan={6}>No telehealth doctors yet. Add one on the right.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          {canSetup && (
            <form className="panel stack" action={saveTelehealthProvider}>
              <h2>{editing ? `Edit ${editing.user.name}` : "Add doctor"}</h2>
              <p className="muted">A telehealth doctor is one of the practice&apos;s clinician logins plus the licences the booking check uses.</p>
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <label>
                Clinician
                <select name="userId" required defaultValue={editing?.userId ?? ""}>
                  <option value="" disabled>
                    Pick a clinician…
                  </option>
                  {clinicians
                    .filter((c) => c.id === editing?.userId || !providers.some((p) => p.userId === c.id))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.specialty ? ` · ${c.specialty}` : ""}
                      </option>
                    ))}
                </select>
              </label>
              <div className="form-grid">
                <label>
                  Professional suffix
                  <select name="suffix" defaultValue={editing?.suffix ?? "Dr."}>
                    {TELEHEALTH_SUFFIXES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Specialty
                  <input name="specialty" defaultValue={editing?.specialty ?? ""} placeholder="Wound care" />
                </label>
                <label>
                  Status
                  <select name="status" defaultValue={editing?.status ?? "ACTIVE"}>
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                  </select>
                </label>
                <label>
                  Break after (bookable blocks)
                  <input name="breakAfterBlocks" type="number" min="0" max="24" defaultValue={editing?.breakAfterBlocks ?? ""} placeholder="None" />
                </label>
                <label>
                  Breaks only in windows of at least (min)
                  <input name="breakMinWindowMin" type="number" min="0" max="1440" step="10" defaultValue={editing?.breakMinWindowMin ?? 300} />
                </label>
              </div>
              <fieldset className="stack">
                <legend>State licences</legend>
                <div className="th-states">
                  {US_STATES.map((s) => (
                    <label key={s} className="checkbox-inline" title={STATE_NAMES[s]}>
                      <input type="checkbox" name="stateLicenses" value={s} defaultChecked={editing ? parseLicenses(editing.stateLicenses).includes(s) : false} /> {s}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="vw-view-links">
                <button className="btn" type="submit">
                  {editing ? "Save doctor" : "Add doctor"}
                </button>
                {editing && (
                  <Link className="btn ghost" href={tabHref("doctors")}>
                    Cancel
                  </Link>
                )}
              </div>
            </form>
          )}
        </div>
      )}

      {tab === "availability" && (
        <div className="two-col">
          <section className="panel">
            <div className="gw-section-head">
              <h2>Online hours</h2>
              <form method="get" className="vw-view-links">
                <input type="hidden" name="tab" value="availability" />
                <select name="provider" defaultValue={providerFilter} aria-label="Doctor">
                  <option value="">All doctors</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {doctorLabel(p)}
                    </option>
                  ))}
                </select>
                <button className="btn ghost gw-mini" type="submit">
                  Show
                </button>
              </form>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Doctor</th>
                  <th>Date</th>
                  <th>Window</th>
                  <th>Booked</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {windows.map((w) => {
                  const s = windowSummary(w, w.reservations);
                  const live = w.reservations.filter((r) => r.status !== "CANCELLED").length;
                  return (
                    <tr key={w.id} className={w.endsAt < now ? "sc-cancelled" : undefined}>
                      <td>{doctorLabel(w.provider)}</td>
                      <td>{dateInZone(w.startsAt, w.timezone)}</td>
                      <td>
                        {timeInZone(w.startsAt, w.timezone)}–{timeInZone(w.endsAt, w.timezone)} {zoneLabel(w.timezone)}
                        <div className="muted cn-small">{s.durationMin} min · {s.availableMin} min free</div>
                      </td>
                      <td>{live ? `${live} visit${live === 1 ? "" : "s"}` : "—"}</td>
                      <td>
                        <span className="th-window-status">{WINDOW_STATUS_LABEL[s.status]}</span>
                      </td>
                      <td>
                        {canSetup && (
                          <div className="stack">
                            <details className="sc-cancel">
                              <summary>Edit</summary>
                              <form action={updateTelehealthAvailability.bind(null, w.id)} className="stack">
                                <input name="date" type="date" defaultValue={dateKeyInZone(w.startsAt, w.timezone)} required aria-label="Date" />
                                <input name="startTime" type="time" defaultValue={timeKeyInZone(w.startsAt, w.timezone)} required aria-label="Start" />
                                <input name="endTime" type="time" defaultValue={timeKeyInZone(w.endsAt, w.timezone)} required aria-label="End" />
                                <select name="timezone" defaultValue={w.timezone} aria-label="Time zone">
                                  {TELEHEALTH_ZONES.map((z) => (
                                    <option key={z.iana} value={z.iana}>
                                      {z.label} · {z.name}
                                    </option>
                                  ))}
                                </select>
                                <button className="btn ghost gw-mini" type="submit">
                                  Save
                                </button>
                              </form>
                            </details>
                            <form action={deleteTelehealthAvailability.bind(null, w.id)}>
                              <button className="btn ghost gw-mini" type="submit">
                                Remove
                              </button>
                            </form>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {windows.length === 0 && (
                  <tr>
                    <td colSpan={6}>No online hours yet{providerFilter ? " for this doctor" : ""}. Add a window on the right.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          {canSetup && (
            <form className="panel stack" action={addTelehealthAvailability}>
              <h2>Add availability</h2>
              <p className="muted">One window per date. Give a to-date to add the same hours on every weekday through it (weekends are skipped). Windows for a doctor may not overlap or touch; back-to-back hours go in as one window.</p>
              <label>
                Doctor
                <select name="providerId" required defaultValue={providerFilter}>
                  <option value="" disabled>
                    Pick a doctor…
                  </option>
                  {providers
                    .filter((p) => p.status === "ACTIVE")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {doctorLabel(p)}
                      </option>
                    ))}
                </select>
              </label>
              <div className="form-grid">
                <label>
                  Time zone
                  <select name="timezone" defaultValue={defaultZone}>
                    {TELEHEALTH_ZONES.map((z) => (
                      <option key={z.iana} value={z.iana}>
                        {z.label} · {z.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Date
                  <input name="date" type="date" required defaultValue={dateKeyInZone(now, defaultZone)} />
                </label>
                <label>
                  To date (optional, batch)
                  <input name="toDate" type="date" />
                </label>
                <label>
                  Start time
                  <input name="startTime" type="time" defaultValue="09:00" required />
                </label>
                <label>
                  End time
                  <input name="endTime" type="time" defaultValue="17:00" required />
                </label>
              </div>
              <button className="btn" type="submit">
                Add availability
              </button>
            </form>
          )}
        </div>
      )}

      {tab === "reservations" && (
        <div className="stack">
          <section className="panel">
            <div className="gw-section-head">
              <h2>Reservations</h2>
              <form method="get" className="vw-view-links">
                <input type="hidden" name="tab" value="reservations" />
                <select name="provider" defaultValue={providerFilter} aria-label="Doctor">
                  <option value="">All doctors</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {doctorLabel(p)}
                    </option>
                  ))}
                </select>
                <button className="btn ghost gw-mini" type="submit">
                  Show
                </button>
              </form>
            </div>
            {reservations.length === 0 && <p className="muted">No telehealth reservations{providerFilter ? " for this doctor" : ""}.</p>}
            {providers
              .filter((p) => reservations.some((r) => r.providerId === p.id))
              .map((p) => {
                const list = reservations.filter((r) => r.providerId === p.id);
                const live = list.filter((r) => !["CANCELLED", "COMPLETED", "MISSED"].includes(r.status));
                const licenses = parseLicenses(p.stateLicenses);
                return (
                  <section key={p.id} className="th-group">
                    <div className="th-group-head">
                      <div>
                        <h3>{doctorLabel(p)}</h3>
                        <span className="muted cn-small">
                          {p.specialty ?? p.user.specialty ?? "Telehealth"} · Licensed in {licenses.length ? licenses.join(", ") : "no states"}
                        </span>
                      </div>
                      <span className="muted">
                        {live.length} upcoming · {list.length} total
                      </span>
                    </div>
                    <div className="th-cards">
                      {list.map((r) => {
                        const licensed = licenses.includes(r.stateCode);
                        const open = !["CANCELLED", "COMPLETED", "MISSED"].includes(r.status);
                        const mayChange = open && (r.status !== "CONFIRMED" || canConfirm) && !r.appointment?.encounter;
                        return (
                          <article key={r.id} className={`th-card th-card-${r.status.toLowerCase()}`}>
                            <div className="th-card-head">
                              <div>
                                <strong>{dateInZone(r.startsAt, r.timezone)}</strong>
                                <div className="muted cn-small">
                                  {timeInZone(r.startsAt, r.timezone)}–{timeInZone(r.endsAt, r.timezone)} {zoneLabel(r.timezone)}
                                </div>
                              </div>
                              <StatusBadge value={r.status} label={RESERVATION_STATUSES[r.status] ?? r.status} />
                            </div>
                            <dl className="th-card-facts">
                              <div>
                                <dt>Patient</dt>
                                <dd>
                                  <Link href={`/patients/${r.patient.id}`}>{patientName(r.patient)}</Link> <span className="muted cn-small">· {r.patient.mrn}</span>
                                </dd>
                              </div>
                              <div>
                                <dt>State</dt>
                                <dd>
                                  {STATE_NAMES[r.stateCode] ?? r.stateCode} ({r.stateCode}){!licensed && <span className="gw-missing cn-small"> · Not licensed</span>}
                                </dd>
                              </div>
                              <div>
                                <dt>Notes</dt>
                                <dd>{r.notes}</dd>
                              </div>
                              <div>
                                <dt>Booked</dt>
                                <dd className="muted cn-small">
                                  {r.reservedById ? `Reserved by ${staff.get(r.reservedById) ?? "staff"}` : "Reserved"}
                                  {r.confirmedById && ` · Confirmed by ${staff.get(r.confirmedById) ?? "staff"}`}
                                  {r.cancelReason && ` · ${r.cancelReason}`}
                                </dd>
                              </div>
                            </dl>
                            <div className="th-card-actions">
                              {r.status === "RESERVED" && canConfirm && (
                                <form action={confirmTelehealthReservation.bind(null, r.id)}>
                                  <button className="btn secondary gw-mini" type="submit">
                                    Confirm
                                  </button>
                                </form>
                              )}
                              {r.appointment && (
                                <Link className="btn ghost gw-mini" href={`/schedule?view=day&date=${dateKeyInZone(r.startsAt, r.timezone)}`}>
                                  On the calendar
                                </Link>
                              )}
                              {open && r.endsAt <= now && (
                                <form action={setTelehealthOutcome.bind(null, r.id)} className="vw-view-links">
                                  <select name="status" defaultValue="COMPLETED" aria-label="Outcome">
                                    <option value="COMPLETED">Completed</option>
                                    <option value="MISSED">Missed</option>
                                  </select>
                                  <button className="btn ghost gw-mini" type="submit">
                                    Set
                                  </button>
                                </form>
                              )}
                            </div>
                            {mayChange && (
                              <div className="th-card-more">
                                <details className="sc-cancel">
                                  <summary>Move / edit</summary>
                                  <form action={moveTelehealthReservation.bind(null, r.id)} className="stack">
                                    <input name="time" type="time" step="1200" defaultValue={timeKeyInZone(r.startsAt, r.timezone)} aria-label={`New start (${zoneLabel(r.timezone)})`} />
                                    <select name="stateCode" defaultValue={r.stateCode} aria-label="State">
                                      {US_STATES.map((s) => (
                                        <option key={s} value={s}>
                                          {s}
                                        </option>
                                      ))}
                                    </select>
                                    <input name="notes" defaultValue={r.notes} maxLength={150} aria-label="Notes" />
                                    <button className="btn ghost gw-mini" type="submit">
                                      Save
                                    </button>
                                  </form>
                                </details>
                                <details className="sc-cancel">
                                  <summary>Cancel</summary>
                                  <form action={cancelTelehealthReservation.bind(null, r.id)} className="stack">
                                    <input name="reason" placeholder="Reason" required aria-label="Reason" />
                                    <button className="btn ghost gw-mini" type="submit">
                                      Cancel reservation
                                    </button>
                                  </form>
                                </details>
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
          </section>

          {recents.length > 0 && (
            <section className="panel">
              <h2>Recently updated</h2>
              <ul className="rp-list">
                {recents.map((r) => (
                  <li key={r.id}>
                    <span>
                      {patientName(r.patient)} with {doctorLabel(r.provider)} · {dateInZone(r.startsAt, r.timezone)} {timeInZone(r.startsAt, r.timezone)} {zoneLabel(r.timezone)}
                    </span>
                    <span className="muted">
                      {RESERVATION_STATUSES[r.status] ?? r.status} · {formatDate(r.updatedAt)} {formatTime(r.updatedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
