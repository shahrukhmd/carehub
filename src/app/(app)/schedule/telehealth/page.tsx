import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { can, rolesFor } from "@/lib/permissions";
import { formatDate, formatTime, patientName, US_STATES } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { TELEHEALTH_DOCTOR_WHERE } from "@/lib/telehealth-server";
import {
  RESERVATION_STATUSES,
  STATE_NAMES,
  STATE_ZONE,
  TELEHEALTH_ZONES,
  WINDOW_STATUS_LABEL,
  dateInZone,
  dateKeyInZone,
  doctorName,
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
  moveTelehealthReservation,
  saveTelehealthDoctor,
  setTelehealthOutcome,
  updateTelehealthAvailability,
} from "./actions";

const TABS = [
  ["doctors", "Doctors"],
  ["availability", "Availability"],
  ["reservations", "Reservations"],
] as const;
type Tab = (typeof TABS)[number][0];

type SearchParams = { tab?: string; provider?: string; error?: string; ok?: string };
const DAY = 86_400_000;
const PROVIDERS_DIRECTORY = "/settings/directories?section=providers";

// Telehealth scheduler admin. A telehealth doctor is a provider from the directory (Settings -> Directories ->
// Providers) with the Rendering type, physicians and NPs alike; this page holds their telehealth licences, the hours they are
// online (availability windows, each with its own break rule) and every reservation booked into those hours. Booking
// itself happens on the scheduler when the encounter type is Telehealth Initial Wound Care.
export default async function TelehealthAdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser(rolesFor("schedule.view"));
  const sp = await searchParams;
  const tab: Tab = (TABS.some(([t]) => t === sp.tab) ? sp.tab : "doctors") as Tab;
  const canSetup = can(user, "telehealth.setup");
  const canConfirm = can(user, "telehealth.confirm");
  const now = new Date();

  const [practice, directory] = await Promise.all([
    prisma.practice.findUnique({ where: { id: user.practiceId }, select: { state: true } }),
    prisma.renderingProvider.findMany({
      where: { practiceId: user.practiceId, ...TELEHEALTH_DOCTOR_WHERE },
      include: {
        telehealthProfile: { include: { _count: { select: { reservations: { where: { status: { not: "CANCELLED" }, endsAt: { gt: now } } } } } } },
        user: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);
  // One row per doctor, whether or not they have a telehealth profile yet.
  const doctors = directory.map((rp) => ({
    rpId: rp.id,
    profileId: rp.telehealthProfile?.id ?? null,
    name: doctorName(rp),
    specialty: rp.specialty,
    licenses: rp.telehealthProfile ? parseLicenses(rp.telehealthProfile.stateLicenses) : rp.licenseState ? [rp.licenseState] : [],
    status: rp.telehealthProfile?.status ?? "ACTIVE",
    hasLogin: Boolean(rp.userId),
    upcoming: rp.telehealthProfile?._count.reservations ?? 0,
  }));
  const byProfile = new Map(doctors.filter((d) => d.profileId).map((d) => [d.profileId!, d]));
  const providerFilter = sp.provider && doctors.some((d) => d.rpId === sp.provider) ? sp.provider : "";
  const filterProfileId = providerFilter ? (doctors.find((d) => d.rpId === providerFilter)?.profileId ?? "none") : null;
  const defaultZone = (practice?.state && STATE_ZONE[practice.state]) || "America/New_York";

  const windows =
    tab === "availability"
      ? await prisma.telehealthAvailability.findMany({
          where: { practiceId: user.practiceId, endsAt: { gte: new Date(now.getTime() - 7 * DAY) }, ...(filterProfileId ? { providerId: filterProfileId } : {}) },
          include: { reservations: { select: { id: true, startsAt: true, endsAt: true, status: true } } },
          orderBy: [{ startsAt: "asc" }],
          take: 400,
        })
      : [];

  const reservations =
    tab === "reservations"
      ? await prisma.telehealthReservation.findMany({
          where: { practiceId: user.practiceId, endsAt: { gte: new Date(now.getTime() - 30 * DAY) }, ...(filterProfileId ? { providerId: filterProfileId } : {}) },
          include: { patient: { select: { id: true, firstName: true, lastName: true, mrn: true } }, appointment: { select: { id: true, status: true, encounter: { select: { id: true } } } } },
          orderBy: { startsAt: "asc" },
          take: 400,
        })
      : [];
  const recents =
    tab === "reservations"
      ? await prisma.telehealthReservation.findMany({
          where: { practiceId: user.practiceId },
          include: { patient: { select: { firstName: true, lastName: true } } },
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
  const nameOfProfile = (profileId: string) => byProfile.get(profileId)?.name ?? "Former doctor";

  const doctorFilter = (t: Tab) => (
    <form method="get" className="vw-view-links">
      <input type="hidden" name="tab" value={t} />
      <select name="provider" defaultValue={providerFilter} aria-label="Doctor">
        <option value="">All doctors</option>
        {doctors.map((d) => (
          <option key={d.rpId} value={d.rpId}>
            {d.name}
          </option>
        ))}
      </select>
      <button className="btn ghost gw-mini" type="submit">
        Show
      </button>
    </form>
  );

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
        <section className="panel">
          <div className="gw-section-head">
            <h2>Telehealth doctors</h2>
            <span className="muted">{doctors.filter((d) => d.status === "ACTIVE").length} active</span>
          </div>
          <p className="muted">
            Every active provider in the directory with the <strong>Rendering</strong> type is a telehealth doctor, nurse practitioners included. Add or change providers under{" "}
            <Link href={PROVIDERS_DIRECTORY}>Settings → Directories → Providers</Link>; here you keep their telehealth licences and whether they take telehealth visits.
          </p>
          <table>
            <thead>
              <tr>
                <th>Doctor</th>
                <th>Specialty</th>
                <th>Licensed states</th>
                <th>Login</th>
                <th>Telehealth</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {doctors.map((d) => (
                <tr key={d.rpId}>
                  <td>
                    <strong>{d.name}</strong>
                    {d.upcoming > 0 && <div className="muted cn-small">{d.upcoming} upcoming</div>}
                  </td>
                  <td>{d.specialty ?? "—"}</td>
                  <td>{d.licenses.length ? d.licenses.join(", ") : <span className="gw-missing">None</span>}</td>
                  <td>{d.hasLogin ? "Linked" : <span className="gw-missing">Not linked — can&apos;t be booked</span>}</td>
                  <td>
                    <StatusBadge value={d.status} />
                  </td>
                  <td>
                    {canSetup && (
                      <details className="sc-cancel">
                        <summary>Edit</summary>
                        <form action={saveTelehealthDoctor.bind(null, d.rpId)} className="stack">
                          <select name="status" defaultValue={d.status} aria-label="Takes telehealth visits">
                            <option value="ACTIVE">Takes telehealth visits</option>
                            <option value="INACTIVE">Not available for telehealth</option>
                          </select>
                          <fieldset className="stack">
                            <legend>State licences</legend>
                            <div className="th-states">
                              {US_STATES.map((s) => (
                                <label key={s} className="checkbox-inline" title={STATE_NAMES[s]}>
                                  <input type="checkbox" name="stateLicenses" value={s} defaultChecked={d.licenses.includes(s)} /> {s}
                                </label>
                              ))}
                            </div>
                          </fieldset>
                          <button className="btn ghost gw-mini" type="submit">
                            Save
                          </button>
                        </form>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
              {doctors.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    No Rendering providers yet. Set them up under <Link href={PROVIDERS_DIRECTORY}>Settings → Directories → Providers</Link>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {tab === "availability" && (
        <div className="two-col">
          <section className="panel">
            <div className="gw-section-head">
              <h2>Online hours</h2>
              {doctorFilter("availability")}
            </div>
            <table>
              <thead>
                <tr>
                  <th>Doctor</th>
                  <th>Date</th>
                  <th>Window</th>
                  <th>Break rule</th>
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
                      <td>{nameOfProfile(w.providerId)}</td>
                      <td>{dateInZone(w.startsAt, w.timezone)}</td>
                      <td>
                        {timeInZone(w.startsAt, w.timezone)}–{timeInZone(w.endsAt, w.timezone)} {zoneLabel(w.timezone)}
                        <div className="muted cn-small">
                          {s.durationMin} min · {s.availableMin} min free
                        </div>
                      </td>
                      <td>{w.breakAfterBlocks ? `Break after ${w.breakAfterBlocks} blocks` : "—"}</td>
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
                                <input name="breakAfterBlocks" type="number" min="0" max="24" defaultValue={w.breakAfterBlocks ?? ""} placeholder="Break after N blocks" aria-label="Break after (bookable blocks)" />
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
                    <td colSpan={7}>No online hours yet{providerFilter ? " for this doctor" : ""}. Add a window on the right.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          {canSetup && (
            <form className="panel stack" action={addTelehealthAvailability}>
              <h2>Add availability</h2>
              <p className="muted">
                One window per date. Give a to-date to add the same hours on every weekday through it (weekends are skipped). Windows for a doctor may not overlap or touch; back-to-back hours go in as one window.
              </p>
              <label>
                Doctor
                <select name="renderingProviderId" required defaultValue={providerFilter}>
                  <option value="" disabled>
                    Pick a doctor…
                  </option>
                  {doctors
                    .filter((d) => d.status === "ACTIVE")
                    .map((d) => (
                      <option key={d.rpId} value={d.rpId}>
                        {d.name}
                        {d.hasLogin ? "" : " (no login — not bookable)"}
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
                <label>
                  Break after (bookable blocks)
                  <input name="breakAfterBlocks" type="number" min="0" max="24" placeholder="None" />
                </label>
              </div>
              <p className="muted cn-small">Break rule: after that many consecutive bookable 20-minute blocks, the next block is kept free as a break (e.g. 6 = a break every 2 hours).</p>
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
              {doctorFilter("reservations")}
            </div>
            {reservations.length === 0 && <p className="muted">No telehealth reservations{providerFilter ? " for this doctor" : ""}.</p>}
            {[...new Set(reservations.map((r) => r.providerId))]
              .map((profileId) => ({ profileId, doctor: byProfile.get(profileId) ?? null }))
              .sort((a, b) => (a.doctor?.name ?? "").localeCompare(b.doctor?.name ?? ""))
              .map(({ profileId, doctor }) => {
                const list = reservations.filter((r) => r.providerId === profileId);
                const live = list.filter((r) => !["CANCELLED", "COMPLETED", "MISSED"].includes(r.status));
                const licenses = doctor?.licenses ?? [];
                return (
                  <details key={profileId} className="th-group" open>
                    <summary className="th-group-head">
                      <div>
                        <h3>{doctor?.name ?? "Former doctor"}</h3>
                        <span className="muted cn-small">
                          {doctor?.specialty ?? "Telehealth"} · Licensed in {licenses.length ? licenses.join(", ") : "no states"}
                        </span>
                      </div>
                      <span className="muted">
                        {live.length} upcoming · {list.length} total
                      </span>
                    </summary>
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
                  </details>
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
                      {patientName(r.patient)} with {nameOfProfile(r.providerId)} · {dateInZone(r.startsAt, r.timezone)} {timeInZone(r.startsAt, r.timezone)} {zoneLabel(r.timezone)}
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
