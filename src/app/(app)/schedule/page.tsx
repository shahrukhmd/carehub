import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { createAppointment, startEncounter, updateAppointmentStatus } from "@/app/actions";
import { createReservedTime, deleteReservedTime } from "@/app/(app)/schedule/actions";
import { StatusBadge } from "@/components/StatusBadge";
import { prisma } from "@/lib/prisma";
import { formatDate, formatTime, patientName, visitTypeLabel } from "@/lib/format";
import { requireUser } from "@/lib/auth";
import { addDays, DAY_ABBR, parseDateParam, startOfDay, startOfWeek, toDateParam } from "@/lib/schedule";

const VIEWS = ["day", "week", "list", "capacity"] as const;
type View = (typeof VIEWS)[number];

type SearchParams = {
  view?: string;
  date?: string;
  providerId?: string;
  locationId?: string;
  visitType?: string;
  showMissed?: string;
};

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "CLINICIAN"]);
  const sp = await searchParams;
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "week";
  const anchor = parseDateParam(sp.date);
  const showMissed = sp.showMissed === "1";

  const [patients, providers, locations] = await Promise.all([
    prisma.patient.findMany({ where: { practiceId: user.practiceId }, orderBy: { lastName: "asc" } }),
    prisma.user.findMany({
      where: { practiceId: user.practiceId, role: "CLINICIAN" },
      orderBy: { name: "asc" },
    }),
    prisma.location.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" } }),
  ]);

  let rangeStart: Date;
  let rangeEnd: Date;
  if (view === "day") {
    rangeStart = startOfDay(anchor);
    rangeEnd = addDays(rangeStart, 1);
  } else if (view === "list") {
    rangeStart = startOfDay(anchor);
    rangeEnd = addDays(rangeStart, 30);
  } else {
    rangeStart = startOfWeek(anchor);
    rangeEnd = addDays(rangeStart, 7);
  }

  const apptWhere: Prisma.AppointmentWhereInput = {
    practiceId: user.practiceId,
    startsAt: { gte: rangeStart, lt: rangeEnd },
    ...(sp.providerId ? { providerId: sp.providerId } : {}),
    ...(sp.locationId ? { locationId: sp.locationId } : {}),
    ...(sp.visitType ? { visitType: sp.visitType } : {}),
    ...(showMissed ? {} : { status: { not: "NO_SHOW" } }),
  };

  const reservedWhere: Prisma.ReservedTimeWhereInput = {
    practiceId: user.practiceId,
    startsAt: { gte: rangeStart, lt: rangeEnd },
    ...(sp.providerId ? { providerId: sp.providerId } : {}),
    ...(sp.locationId ? { locationId: sp.locationId } : {}),
  };

  const [appointments, reservedTimes] = await Promise.all([
    prisma.appointment.findMany({
      where: apptWhere,
      include: { patient: true, provider: true, location: true, encounter: true },
      orderBy: { startsAt: "asc" },
    }),
    prisma.reservedTime.findMany({
      where: reservedWhere,
      include: { provider: true, location: true },
      orderBy: { startsAt: "asc" },
    }),
  ]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(rangeStart, i));

  let capacityProviders: typeof providers = [];
  const availabilityMap = new Map<string, Set<number>>();
  const bookedCounts = new Map<string, number>();
  if (view === "capacity") {
    capacityProviders = sp.providerId ? providers.filter((p) => p.id === sp.providerId) : providers;
    const availability = await prisma.providerAvailability.findMany({
      where: {
        practiceId: user.practiceId,
        ...(sp.locationId ? { locationId: sp.locationId } : {}),
      },
    });
    for (const a of availability) {
      if (!availabilityMap.has(a.providerId)) availabilityMap.set(a.providerId, new Set());
      availabilityMap.get(a.providerId)!.add(a.dayOfWeek);
    }
    for (const a of appointments) {
      if (a.status === "CANCELLED") continue;
      const dayIndex = Math.round((startOfDay(a.startsAt).getTime() - rangeStart.getTime()) / 86400000);
      const key = `${a.providerId}-${dayIndex}`;
      bookedCounts.set(key, (bookedCounts.get(key) ?? 0) + 1);
    }
  }

  type Row =
    | { time: Date; kind: "appt"; appt: (typeof appointments)[number] }
    | { time: Date; kind: "reserved"; reserved: (typeof reservedTimes)[number] };

  const rows: Row[] = [
    ...appointments.map((appt): Row => ({ time: appt.startsAt, kind: "appt", appt })),
    ...reservedTimes.map((reserved): Row => ({ time: reserved.startsAt, kind: "reserved", reserved })),
  ].sort((a, b) => a.time.getTime() - b.time.getTime());

  function link(overrides: Partial<SearchParams & { view: View }>) {
    const params = new URLSearchParams();
    params.set("view", overrides.view ?? view);
    params.set("date", overrides.date ?? toDateParam(anchor));
    const providerId = overrides.providerId ?? sp.providerId;
    const locationId = overrides.locationId ?? sp.locationId;
    const visitType = overrides.visitType ?? sp.visitType;
    if (providerId) params.set("providerId", providerId);
    if (locationId) params.set("locationId", locationId);
    if (visitType) params.set("visitType", visitType);
    if (showMissed) params.set("showMissed", "1");
    return `/schedule?${params.toString()}`;
  }

  const rangeStep = view === "day" ? 1 : view === "list" ? 30 : 7;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Practice management</p>
          <h1>Schedule</h1>
        </div>
        <Link className="btn secondary" href="/schedule/availability">
          Manage availability
        </Link>
      </div>

      <div className="schedule-toolbar">
        <div className="view-tabs">
          {VIEWS.map((v) => (
            <Link key={v} className={`view-tab${v === view ? " active" : ""}`} href={link({ view: v })}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </Link>
          ))}
        </div>
        <div className="date-nav">
          <Link className="btn ghost" href={link({ date: toDateParam(addDays(anchor, -rangeStep)) })}>
            ← Prev
          </Link>
          <span>
            {formatDate(rangeStart)}
            {view !== "day" ? ` – ${formatDate(addDays(rangeEnd, -1))}` : ""}
          </span>
          <Link className="btn ghost" href={link({ date: toDateParam(addDays(anchor, rangeStep)) })}>
            Next →
          </Link>
        </div>
      </div>

      <form className="panel schedule-filters" method="get">
        <input type="hidden" name="view" value={view} />
        <input type="hidden" name="date" value={toDateParam(anchor)} />
        <label>
          Provider
          <select name="providerId" defaultValue={sp.providerId ?? ""}>
            <option value="">All</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Location
          <select name="locationId" defaultValue={sp.locationId ?? ""}>
            <option value="">All</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Visit type
          <select name="visitType" defaultValue={sp.visitType ?? ""}>
            <option value="">All</option>
            {Object.entries(visitTypeLabel).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-inline">
          <input type="checkbox" name="showMissed" value="1" defaultChecked={showMissed} />
          Show missed
        </label>
        <button className="btn secondary" type="submit">
          Apply filters
        </button>
      </form>

      {view === "capacity" ? (
        <section className="panel">
          <h2>
            Capacity — {formatDate(rangeStart)} – {formatDate(addDays(rangeEnd, -1))}
          </h2>
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                {days.map((d) => (
                  <th key={d.toISOString()}>
                    {DAY_ABBR[d.getDay()]} {d.getDate()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {capacityProviders.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  {days.map((d, i) => {
                    const working = availabilityMap.get(p.id)?.has(d.getDay()) ?? false;
                    const count = bookedCounts.get(`${p.id}-${i}`) ?? 0;
                    return (
                      <td key={i} className={working ? "" : "muted"}>
                        {working ? `${count} booked` : "Unavailable"}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {capacityProviders.length === 0 && (
                <tr>
                  <td colSpan={8}>No providers found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      ) : (
        <div className="two-col">
          <section className="panel">
            <h2>{view === "day" ? formatDate(anchor) : view === "list" ? "Upcoming (30 days)" : "This week"}</h2>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Patient / Detail</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) =>
                  row.kind === "appt" ? (
                    <tr key={`a-${row.appt.id}`}>
                      <td>
                        {formatDate(row.appt.startsAt)}
                        <div className="muted">
                          {formatTime(row.appt.startsAt)} · {row.appt.provider.name} · {row.appt.location.name}
                        </div>
                      </td>
                      <td>
                        <Link href={`/patients/${row.appt.patientId}`}>{patientName(row.appt.patient)}</Link>
                        <div className="muted">{row.appt.reason}</div>
                      </td>
                      <td>{visitTypeLabel[row.appt.visitType] ?? row.appt.visitType}</td>
                      <td>
                        <StatusBadge value={row.appt.status} />
                      </td>
                      <td>
                        <div className="stack">
                          {row.appt.status === "SCHEDULED" && (
                            <form action={updateAppointmentStatus.bind(null, row.appt.id, "CHECKED_IN")}>
                              <button className="btn secondary" type="submit">
                                Check in
                              </button>
                            </form>
                          )}
                          {row.appt.status !== "COMPLETED" && row.appt.status !== "CANCELLED" && (
                            <form action={startEncounter.bind(null, row.appt.id)}>
                              <button className="btn" type="submit">
                                {row.appt.encounter ? "Open chart" : "Start encounter"}
                              </button>
                            </form>
                          )}
                          {row.appt.status === "SCHEDULED" && (
                            <form action={updateAppointmentStatus.bind(null, row.appt.id, "NO_SHOW")}>
                              <button className="btn ghost" type="submit">
                                Mark missed
                              </button>
                            </form>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={`r-${row.reserved.id}`} className="reserved-row">
                      <td>
                        {formatDate(row.reserved.startsAt)}
                        <div className="muted">
                          {formatTime(row.reserved.startsAt)}–{formatTime(row.reserved.endsAt)} ·{" "}
                          {row.reserved.provider.name}
                          {row.reserved.location ? ` · ${row.reserved.location.name}` : ""}
                        </div>
                      </td>
                      <td>
                        <StatusBadge value="RESERVED" /> {row.reserved.title}
                      </td>
                      <td>—</td>
                      <td>—</td>
                      <td>
                        <form action={deleteReservedTime.bind(null, row.reserved.id)}>
                          <button className="btn ghost" type="submit">
                            Remove
                          </button>
                        </form>
                      </td>
                    </tr>
                  )
                )}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5}>Nothing scheduled.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <div className="stack">
            <form className="panel stack" action={createAppointment}>
              <h2>Book appointment</h2>
              <label>
                Patient
                <select name="patientId" required>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {patientName(p)} ({p.mrn})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Provider
                <select name="providerId" required>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Location
                <select name="locationId" required>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Start
                <input name="startsAt" type="datetime-local" required />
              </label>
              <label>
                Visit type
                <select name="visitType" defaultValue="FOLLOW_UP">
                  {Object.entries(visitTypeLabel).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Reason
                <input name="reason" />
              </label>
              <button className="btn" type="submit">
                Save to book
              </button>
            </form>

            <form className="panel stack" action={createReservedTime}>
              <h2>Reserve time</h2>
              <label>
                Provider
                <select name="providerId" required>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Location (optional)
                <select name="locationId" defaultValue="">
                  <option value="">—</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Title
                <input name="title" placeholder="Lunch, admin time, out of office" required />
              </label>
              <label>
                Start
                <input name="startsAt" type="datetime-local" required />
              </label>
              <label>
                End
                <input name="endsAt" type="datetime-local" required />
              </label>
              <button className="btn secondary" type="submit">
                Reserve
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
