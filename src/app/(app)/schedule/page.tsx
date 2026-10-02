import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { cancelAppointment, createAppointment, startEncounter, updateAppointmentStatus } from "@/app/actions";
import { checkEligibility, createReservedTime, deleteReservedTime } from "@/app/(app)/schedule/actions";
import { StatusBadge } from "@/components/StatusBadge";
import { prisma } from "@/lib/prisma";
import { recordFlow } from "@/lib/flow";
import { closuresBetween } from "@/lib/holidays";
import { formatDate, formatMoney, formatTime, patientName } from "@/lib/format";
import { requireUser } from "@/lib/auth";
import { placeOfServiceLabel } from "@/lib/superbill";
import { addDays, DAY_ABBR, parseDateParam, startOfDay, startOfWeek, toDateParam } from "@/lib/schedule";
import { getSchedulerSettings, getVisitTypes, visitTypeNames } from "@/lib/scheduler-setup";
import { CALENDAR_STATUSES, PREVIEW_FIELDS, parseJson, parseOfficeHours, timeLabel, type ColorPair } from "@/lib/scheduler";
import { visitStatusLabel } from "@/lib/visit-workflow";

const ALL_VIEWS = ["day", "week", "list", "capacity"] as const;
type View = (typeof ALL_VIEWS)[number];

type SearchParams = {
  view?: string;
  date?: string;
  providerId?: string;
  locationId?: string;
  visitType?: string;
  showMissed?: string;
  filter?: string;
  next?: string;
  patientId?: string;
  returnTo?: string;
  bookWith?: string;
  bookLocation?: string;
  bookStart?: string;
  bookType?: string;
  conflicts?: string;
  bookLen?: string;
  bookStaff?: string;
  bookSup?: string;
  bookAuth?: string;
  bookPos?: string;
  bookRoom?: string;
  bookNotes?: string;
  bookRecur?: string;
  bookRecurEnd?: string;
  bookDays?: string;
  bookCollab?: string;
  bookAcct?: string;
  bookRes?: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export default async function SchedulePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "CLINICIAN", "SCHEDULER"]);
  const sp = await searchParams;
  const [settings, visitTypes, typeNames, filterSets] = await Promise.all([
    getSchedulerSettings(user.practiceId),
    getVisitTypes(user.practiceId),
    visitTypeNames(user.practiceId),
    prisma.calendarFilterSet.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" } }),
  ]);
  const VIEWS = ALL_VIEWS.filter((v) => v !== "capacity" || settings.showCapacityView);

  // A saved calendar filter fills in site, physicians, types and view.
  const filterSet = filterSets.find((f) => f.id === sp.filter);
  const locationFilter = sp.locationId ?? filterSet?.locationId ?? undefined;
  const providerFilter = sp.providerId ? [sp.providerId] : filterSet?.providerIds ? filterSet.providerIds.split(",") : [];
  const typeFilter = sp.visitType ? [sp.visitType] : filterSet?.visitTypes ? filterSet.visitTypes.split(",") : [];
  const requested = sp.view ?? filterSet?.view;
  const view: View = (VIEWS as readonly string[]).includes(requested ?? "") ? (requested as View) : "week";
  const anchor = parseDateParam(sp.date);
  const showMissed = sp.showMissed === "1";

  // Automatically check in same-day visits shortly before they start.
  if (settings.autoCheckIn) {
    const now = new Date();
    const due = await prisma.appointment.findMany({
      where: {
        practiceId: user.practiceId,
        status: { in: ["SCHEDULED", "CONFIRMED"] },
        startsAt: { gte: startOfDay(now), lte: new Date(now.getTime() + settings.autoCheckInMinutes * 60_000) },
      },
      select: { id: true },
    });
    if (due.length) {
      await prisma.appointment.updateMany({ where: { id: { in: due.map((d) => d.id) } }, data: { status: "CHECKED_IN" } });
      await recordFlow(due.map((d) => d.id), "CHECKED_IN", null);
    }
  }

  const [patients, providers, locations, collaborators, resources] = await Promise.all([
    prisma.patient.findMany({ where: { practiceId: user.practiceId, status: { notIn: ["INACTIVE", "DECEASED"] } }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }),
    prisma.user.findMany({ where: { practiceId: user.practiceId, role: "CLINICIAN" }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: { name: "asc" } }),
    prisma.renderingProvider.findMany({ where: { practiceId: user.practiceId, isRendering: true, status: "ACTIVE" }, orderBy: { name: "asc" } }),
    prisma.schedulerResource.findMany({ where: { practiceId: user.practiceId, active: true }, include: { location: true }, orderBy: { name: "asc" } }),
  ]);
  const [clinicalStaff, supervisors, approvedAuths, reasons] = await Promise.all([
    prisma.membership.findMany({
      where: { practiceId: user.practiceId, role: { in: ["CLINICIAN", "FRONT_DESK"] }, user: { active: true } },
      include: { user: true },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.renderingProvider.findMany({ where: { practiceId: user.practiceId, isSupervising: true, status: "ACTIVE" }, orderBy: { name: "asc" } }),
    // Approved prior auths from the Patient Gateway, to attach to the visit.
    prisma.intakeCase.findMany({
      where: { practiceId: user.practiceId, authStatus: "APPROVED", ...(sp.patientId ? { patientId: sp.patientId } : {}) },
      include: { patient: true, payer: true },
      orderBy: { authEndDate: "asc" },
    }),
    prisma.cancellationReason.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: { name: "asc" } }),
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
  const weekendHidden = (d: Date) => (view === "week" || view === "capacity") && !settings.showWeekends && (d.getDay() === 0 || d.getDay() === 6);

  const apptWhere: Prisma.AppointmentWhereInput = {
    practiceId: user.practiceId,
    startsAt: { gte: rangeStart, lt: rangeEnd },
    ...(providerFilter.length ? { providerId: { in: providerFilter } } : {}),
    ...(locationFilter ? { locationId: locationFilter } : {}),
    ...(typeFilter.length ? { visitType: { in: typeFilter } } : {}),
    ...(showMissed ? {} : { status: { notIn: ["NO_SHOW", "CANCELLED"] } }),
  };
  const reservedWhere: Prisma.ReservedTimeWhereInput = {
    practiceId: user.practiceId,
    startsAt: { gte: rangeStart, lt: rangeEnd },
    ...(providerFilter.length ? { providerId: { in: providerFilter } } : {}),
    ...(locationFilter ? { locationId: locationFilter } : {}),
  };

  const [appointments, reservedTimes] = await Promise.all([
    prisma.appointment.findMany({
      where: apptWhere,
      include: {
        patient: { include: { insurances: { where: { active: true }, include: { payer: true } } } },
        provider: true,
        location: true,
        encounter: true,
        clinicalStaff: true,
        supervisingProvider: true,
        collaboratingProvider: true,
        resource: true,
        intakeCase: true,
        eligibilityChecks: { orderBy: { checkedAt: "desc" }, take: 1 },
      },
      orderBy: { startsAt: "asc" },
    }),
    prisma.reservedTime.findMany({ where: reservedWhere, include: { provider: true, location: true }, orderBy: { startsAt: "asc" } }),
  ]);
  const creatorIds = [...new Set(appointments.map((a) => a.createdById).filter((x): x is string => Boolean(x)))];
  const creators = new Map(
    (creatorIds.length ? await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name])
  );
  // Visits already booked against each auth (for "remaining authorizations").
  const authIds = [...new Set(appointments.map((a) => a.intakeCaseId).filter((x): x is string => Boolean(x)))];
  const authUsed = new Map(
    (authIds.length
      ? await prisma.appointment.groupBy({ by: ["intakeCaseId"], where: { intakeCaseId: { in: authIds }, status: { notIn: ["CANCELLED", "NO_SHOW"] } }, _count: { _all: true } })
      : []
    ).map((g) => [g.intakeCaseId!, g._count._all])
  );

  // Patient's next appointment lookup.
  const nextQuery = sp.next?.trim();
  const nextResults = nextQuery
    ? await prisma.patient.findMany({
        where: {
          practiceId: user.practiceId,
          OR: [{ lastName: { contains: nextQuery } }, { firstName: { contains: nextQuery } }, { mrn: { contains: nextQuery } }],
        },
        include: {
          appointments: {
            where: { startsAt: { gte: new Date() }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
            orderBy: { startsAt: "asc" },
            take: 1,
            include: { provider: true, location: true },
          },
        },
        take: 8,
      })
    : [];

  const statusColors = parseJson<Record<string, ColorPair>>(settings.statusColors, {});
  const physicianColors = parseJson<Record<string, ColorPair>>(settings.physicianColors, {});
  const typeColors = new Map(visitTypes.map((t) => [t.code, { text: t.textColor, bg: t.bgColor }]));
  const defaultStatus = new Map(CALENDAR_STATUSES.map(([k, , c]) => [k, c]));
  const statusLabel = new Map(CALENDAR_STATUSES.map(([k, l]) => [k, l]));
  const previewFields = parseJson<string[]>(settings.previewFields, []).filter((f) => f in PREVIEW_FIELDS);

  const days = Array.from({ length: 7 }, (_, i) => addDays(rangeStart, i)).filter((d) => !weekendHidden(d));

  let capacityProviders: typeof providers = [];
  const availabilityMap = new Map<string, Set<number>>();
  const bookedCounts = new Map<string, number>();
  if (view === "capacity") {
    capacityProviders = providerFilter.length ? providers.filter((p) => providerFilter.includes(p.id)) : providers;
    const availability = await prisma.providerAvailability.findMany({
      where: { practiceId: user.practiceId, ...(locationFilter ? { locationId: locationFilter } : {}) },
    });
    for (const a of availability) {
      if (!availabilityMap.has(a.providerId)) availabilityMap.set(a.providerId, new Set());
      availabilityMap.get(a.providerId)!.add(a.dayOfWeek);
    }
    for (const a of appointments) {
      if (a.status === "CANCELLED") continue;
      const key = `${a.providerId}-${toDateParam(a.startsAt)}`;
      bookedCounts.set(key, (bookedCounts.get(key) ?? 0) + 1);
    }
  }

  type Row =
    | { time: Date; kind: "appt"; appt: (typeof appointments)[number] }
    | { time: Date; kind: "reserved"; reserved: (typeof reservedTimes)[number] };
  const rows: Row[] = [
    ...appointments.map((appt): Row => ({ time: appt.startsAt, kind: "appt", appt })),
    ...reservedTimes.map((reserved): Row => ({ time: reserved.startsAt, kind: "reserved", reserved })),
  ]
    .filter((r) => !weekendHidden(r.time))
    .sort((a, b) => a.time.getTime() - b.time.getTime());

  function link(overrides: Partial<SearchParams & { view: View }>) {
    const params = new URLSearchParams();
    params.set("view", overrides.view ?? view);
    params.set("date", overrides.date ?? toDateParam(anchor));
    if (sp.filter && overrides.filter !== "") params.set("filter", sp.filter);
    if (sp.providerId) params.set("providerId", sp.providerId);
    if (sp.locationId) params.set("locationId", sp.locationId);
    if (sp.visitType) params.set("visitType", sp.visitType);
    if (showMissed) params.set("showMissed", "1");
    return `/schedule?${params.toString()}`;
  }
  const rangeStep = view === "day" ? 1 : view === "list" ? 30 : 7;

  // Booking defaults: the anchor day at the practice's start time (or now), at the default site.
  const bookDefault = (() => {
    if (sp.bookStart) return sp.bookStart;
    const d = new Date(anchor);
    if (settings.startTimeMode === "CURRENT" && toDateParam(d) === toDateParam(new Date())) {
      const now = new Date();
      const slot = 15;
      d.setHours(now.getHours(), Math.ceil(now.getMinutes() / slot) * slot, 0, 0);
    } else {
      const [h, m] = settings.startTimeFixed.split(":").map(Number);
      d.setHours(h, m, 0, 0);
    }
    return localInput(d);
  })();
  const bookLocation = sp.bookLocation ?? settings.defaultLocationId ?? locations[0]?.id;
  const defaultAuth = sp.bookAuth ?? (settings.defaultAuthorizations && sp.patientId && approvedAuths.length === 1 ? approvedAuths[0].id : "");

  const colorFor = (a: (typeof appointments)[number]): ColorPair | null => {
    const st = a.encounter?.status ?? a.status;
    if (settings.colorMode === "STATUS") return statusColors[st] ?? defaultStatus.get(st) ?? null;
    if (settings.colorMode === "TYPE") return typeColors.get(a.visitType) ?? null;
    if (settings.colorMode === "PHYSICIAN") return physicianColors[a.providerId] ?? null;
    return null;
  };

  const preview = (a: (typeof appointments)[number]) => {
    const primary = a.patient.insurances.find((i) => i.rank === "PRIMARY") ?? a.patient.insurances[0];
    const used = a.intakeCaseId ? (authUsed.get(a.intakeCaseId) ?? 0) : 0;
    const copay = a.eligibilityChecks[0]?.copayCents ?? a.intakeCase?.copayCents ?? null;
    const value: Record<string, string | null> = {
      createdBy: a.createdById ? (creators.get(a.createdById) ?? null) : null,
      dob: formatDate(a.patient.dob),
      phone: a.patient.phone,
      accountNumber: a.accountNumber,
      mrn: a.patient.mrn,
      emergencyName: a.patient.emergencyContactName,
      emergencyPhone: a.patient.emergencyContactPhone,
      primaryInsurance: primary?.payer.name ?? "Self-pay",
      policyNumber: primary?.memberId ?? null,
      authCount: a.intakeCase?.authVisitsApproved != null ? String(a.intakeCase.authVisitsApproved) : null,
      authRemaining: a.intakeCase?.authVisitsApproved != null ? String(Math.max(0, a.intakeCase.authVisitsApproved - used)) : null,
      authStart: a.intakeCase?.authStartDate ? formatDate(a.intakeCase.authStartDate) : null,
      authEnd: a.intakeCase?.authEndDate ? formatDate(a.intakeCase.authEndDate) : null,
      copay: copay != null ? formatMoney(copay) : null,
      visitStatus: a.encounter ? (visitStatusLabel[a.encounter.status] ?? a.encounter.status) : (statusLabel.get(a.status) ?? a.status),
      preferredLanguage: a.patient.preferredLanguage,
      clinician: a.clinicalStaff?.name ?? null,
      supervisor: [a.supervisingProvider?.name, a.collaboratingProvider ? `${a.collaboratingProvider.name} (collaborating)` : null].filter(Boolean).join(", ") || null,
      room: a.room,
      resource: a.resource?.name ?? null,
    };
    return previewFields.map((f) => [PREVIEW_FIELDS[f], value[f]] as const).filter(([, v]) => v);
  };

  const hoursNote = (() => {
    const loc = locations.find((l) => l.id === (locationFilter ?? bookLocation));
    if (!loc?.officeHours) return null;
    const h = parseOfficeHours(loc.officeHours)[anchor.getDay()];
    return `${loc.name}: ${h.closed ? `closed on ${DAY_ABBR[h.day]}` : `${timeLabel(h.start)}–${timeLabel(h.end)}`} · ${loc.slotMinutes}-min slots`;
  })();

  const closures = await closuresBetween(user.practiceId, rangeStart, rangeEnd);
  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Practice management</p>
          <h1>Schedule</h1>
        </div>
        <div className="vw-view-links">
          <form className="sc-next" method="get">
            <input name="next" defaultValue={nextQuery ?? ""} placeholder="Patient's next appointment" aria-label="Find a patient's next appointment" />
          </form>
          <Link className="btn secondary" href="/schedule/eligibility">
            Batch eligibility
          </Link>
          <Link className="btn secondary" href="/schedule/availability">
            Manage availability
          </Link>
          {user.role === "ADMIN" && (
            <Link className="btn ghost" href="/settings/scheduling">
              Scheduler admin
            </Link>
          )}
        </div>
      </div>

      {closures.length > 0 && (
        <p className="sc-closed" role="status">
          Clinic closed:{" "}
          {closures.map((c) => `${c.date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} — ${c.name}${c.allowBooking ? " (booking allowed)" : ""}`).join(" · ")}
        </p>
      )}

      {nextQuery && (
        <section className="panel">
          <div className="gw-section-head">
            <h2>Next appointment — &ldquo;{nextQuery}&rdquo;</h2>
            <Link className="muted" href={link({})}>
              Close
            </Link>
          </div>
          {nextResults.length === 0 ? (
            <p className="muted">No matching patients.</p>
          ) : (
            <ul className="rp-list">
              {nextResults.map((p) => (
                <li key={p.id}>
                  <Link href={`/patients/${p.id}`}>
                    {patientName(p)} · {p.mrn}
                  </Link>
                  <span className="muted">
                    {p.appointments[0]
                      ? `${formatDate(p.appointments[0].startsAt)} ${formatTime(p.appointments[0].startsAt)} · ${typeNames[p.appointments[0].visitType] ?? p.appointments[0].visitType} · ${p.appointments[0].provider.name} · ${p.appointments[0].location.name}`
                      : "No upcoming appointment"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

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
          <Link className="btn ghost" href={link({ date: toDateParam(new Date()) })}>
            Today
          </Link>
        </div>
      </div>

      <form className="panel schedule-filters" method="get">
        <input type="hidden" name="view" value={view} />
        <input type="hidden" name="date" value={toDateParam(anchor)} />
        {filterSets.length > 0 && (
          <label>
            Calendar filter
            <select name="filter" defaultValue={sp.filter ?? ""}>
              <option value="">— None —</option>
              {filterSets.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Physician
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
          Site of service
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
          Encounter type
          <select name="visitType" defaultValue={sp.visitType ?? ""}>
            <option value="">All</option>
            {visitTypes.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-inline">
          <input type="checkbox" name="showMissed" value="1" defaultChecked={showMissed} />
          Show missed &amp; cancelled
        </label>
        <button className="btn secondary" type="submit">
          Apply filters
        </button>
        <Link className="btn ghost" href={`/schedule?view=${view}&date=${toDateParam(anchor)}`}>
          Clear filters
        </Link>
      </form>
      {(filterSet || hoursNote) && (
        <p className="muted sc-note">
          {filterSet ? `Filter: ${filterSet.name}${filterSet.description ? ` — ${filterSet.description}` : ""}. ` : ""}
          {hoursNote}
        </p>
      )}

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
                  {days.map((d) => {
                    const working = availabilityMap.get(p.id)?.has(d.getDay()) ?? false;
                    const count = bookedCounts.get(`${p.id}-${toDateParam(d)}`) ?? 0;
                    return (
                      <td key={d.toISOString()} className={working ? "" : "muted"}>
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
            <div className="gw-section-head">
              <h2>{view === "day" ? formatDate(anchor) : view === "list" ? "Upcoming (30 days)" : "This week"}</h2>
              <span className="muted">
                Visits (non-missed): {appointments.filter((a) => !["NO_SHOW", "CANCELLED"].includes(a.status)).length}
              </span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Patient / Detail</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Eligibility</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  if (row.kind === "reserved") {
                    return (
                      <tr key={`r-${row.reserved.id}`} className="reserved-row">
                        <td>
                          {formatDate(row.reserved.startsAt)}
                          <div className="muted">
                            {formatTime(row.reserved.startsAt)}–{formatTime(row.reserved.endsAt)} · {row.reserved.provider.name}
                            {row.reserved.location ? ` · ${row.reserved.location.name}` : ""}
                          </div>
                        </td>
                        <td>
                          <StatusBadge value="RESERVED" /> {row.reserved.title}
                        </td>
                        <td>—</td>
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
                    );
                  }
                  const a = row.appt;
                  const c = colorFor(a);
                  const st = a.encounter?.status ?? a.status;
                  const details = preview(a);
                  return (
                    <tr key={`a-${a.id}`} className={a.status === "CANCELLED" ? "sc-cancelled" : undefined}>
                      <td>
                        {formatDate(a.startsAt)}
                        <div className="muted">
                          {formatTime(a.startsAt)}–{formatTime(a.endsAt)} · {a.provider.name} · {a.location.name}
                        </div>
                      </td>
                      <td>
                        <Link href={`/patients/${a.patientId}`}>{patientName(a.patient)}</Link>
                        {a.reason && <div className="muted">{a.reason}</div>}
                        {a.cancelReason && <div className="gw-missing">Cancelled: {a.cancelReason}</div>}
                        {details.length > 0 && (
                          <details className="sc-preview">
                            <summary>Visit info</summary>
                            <dl>
                              {details.map(([label, v]) => (
                                <div key={label}>
                                  <dt>{label}</dt>
                                  <dd>{v}</dd>
                                </div>
                              ))}
                            </dl>
                          </details>
                        )}
                      </td>
                      <td>
                        {c && settings.colorMode === "TYPE" ? (
                          <span className="sa-chip" style={{ color: c.text, background: c.bg }}>
                            {typeNames[a.visitType] ?? a.visitType}
                          </span>
                        ) : (
                          (typeNames[a.visitType] ?? a.visitType)
                        )}
                      </td>
                      <td>
                        {c && settings.colorMode !== "TYPE" ? (
                          <span className="sa-chip" style={{ color: c.text, background: c.bg }}>
                            {a.encounter ? (visitStatusLabel[st] ?? st) : (statusLabel.get(st) ?? st)}
                          </span>
                        ) : (
                          <StatusBadge value={a.status} />
                        )}
                        {a.confirmedVia === "PATIENT_LINK" && a.confirmedAt ? (
                          <div className="muted" title="Confirmed by the patient from the reminder link">
                            ✓ Patient confirmed {formatDate(a.confirmedAt)}
                          </div>
                        ) : a.reminderSentAt ? (
                          <div className="muted">Reminder sent {formatDate(a.reminderSentAt)}</div>
                        ) : null}
                        {a.status !== "CANCELLED" && (
                          <Link className="muted cn-small" href={`/checkout?appointmentId=${a.id}`}>
                            {a.copayDueCents !== null ? `Copay ${formatMoney(a.copayDueCents)}` : "Check-out / payment"}
                          </Link>
                        )}
                      </td>
                      <td>
                        {a.eligibilityChecks[0] ? (
                          <>
                            <StatusBadge value={a.eligibilityChecks[0].status} />
                            {a.eligibilityChecks[0].planName && <div className="muted">{a.eligibilityChecks[0].planName}</div>}
                            {a.eligibilityChecks[0].copayCents !== null && (
                              <div className="muted">Copay ${(a.eligibilityChecks[0].copayCents / 100).toFixed(2)}</div>
                            )}
                            {a.eligibilityChecks[0].payerMessage && <div className="muted">{a.eligibilityChecks[0].payerMessage}</div>}
                          </>
                        ) : (
                          <span className="muted">Not checked</span>
                        )}
                        {a.status !== "CANCELLED" && (
                          <form action={checkEligibility.bind(null, a.id)}>
                            <button className="btn ghost" type="submit">
                              {a.eligibilityChecks[0] ? "Recheck" : "Check eligibility"}
                            </button>
                          </form>
                        )}
                      </td>
                      <td>
                        <div className="stack">
                          {["SCHEDULED", "CONFIRMED"].includes(a.status) && (
                            <form action={updateAppointmentStatus.bind(null, a.id, "CHECKED_IN")}>
                              <button className="btn secondary" type="submit">
                                Check in
                              </button>
                            </form>
                          )}
                          {a.status === "SCHEDULED" && (
                            <form action={updateAppointmentStatus.bind(null, a.id, "CONFIRMED")}>
                              <button className="btn ghost" type="submit">
                                Confirm
                              </button>
                            </form>
                          )}
                          {!["COMPLETED", "CANCELLED", "NO_SHOW"].includes(a.status) && (
                            <form action={startEncounter.bind(null, a.id)}>
                              <button className="btn" type="submit">
                                {a.encounter ? "Open chart" : "Start encounter"}
                              </button>
                            </form>
                          )}
                          {["SCHEDULED", "CONFIRMED"].includes(a.status) && (
                            <form action={updateAppointmentStatus.bind(null, a.id, "NO_SHOW")}>
                              <button className="btn ghost" type="submit">
                                Mark missed
                              </button>
                            </form>
                          )}
                          {!a.encounter && !["COMPLETED", "CANCELLED"].includes(a.status) && reasons.length > 0 && (
                            <details className="sc-cancel">
                              <summary>Cancel visit</summary>
                              <form action={cancelAppointment.bind(null, a.id)} className="stack">
                                <select name="cancelReason" required defaultValue="" aria-label="Cancellation reason">
                                  <option value="" disabled>
                                    Reason…
                                  </option>
                                  {reasons.map((r) => (
                                    <option key={r.id} value={r.name}>
                                      {r.name}
                                    </option>
                                  ))}
                                </select>
                                <input name="cancelNote" placeholder="Note (optional)" aria-label="Cancellation note" />
                                {a.seriesId && (
                                  <label className="checkbox-inline">
                                    <input type="checkbox" name="series" /> Also cancel later visits in this series
                                  </label>
                                )}
                                <button className="btn ghost gw-mini" type="submit">
                                  Cancel visit
                                </button>
                              </form>
                            </details>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6}>Nothing scheduled.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <div className="stack">
            <form className="panel stack" action={createAppointment} id="book">
              <h2>Schedule encounter</h2>
              {sp.conflicts && (
                <div className="gw-error" role="alert">
                  <strong>This visit conflicts with the following:</strong>
                  <ul>
                    {sp.conflicts.split("\n").map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                  <label className="checkbox-inline">
                    <input type="checkbox" name="acceptConflicts" /> Accept conflicts and book anyway
                  </label>
                </div>
              )}
              {sp.returnTo && <input type="hidden" name="returnTo" value={sp.returnTo} />}
              <label>
                Patient
                <select name="patientId" required defaultValue={sp.patientId}>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {patientName(p)} ({p.mrn})
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-grid">
                <label>
                  Visit date &amp; time
                  <input name="startsAt" type="datetime-local" required defaultValue={bookDefault} />
                </label>
                <label>
                  Length (min)
                  <input name="durationMinutes" type="number" min="5" max="480" step="5" defaultValue={sp.bookLen ?? ""} placeholder="From encounter type" />
                </label>
                <label>
                  Encounter type
                  <select name="visitType" defaultValue={sp.bookType ?? visitTypes.find((t) => t.code === "EST_WOUND")?.code ?? visitTypes[0]?.code}>
                    {visitTypes
                      .filter((t) => t.billable)
                      .map((t) => (
                        <option key={t.code} value={t.code}>
                          {t.name}
                          {t.durationMin ? ` (${t.durationMin} min)` : ""}
                        </option>
                      ))}
                    {visitTypes.some((t) => !t.billable) && (
                      <optgroup label="Non-billable interactions">
                        {visitTypes
                          .filter((t) => !t.billable)
                          .map((t) => (
                            <option key={t.code} value={t.code}>
                              {t.name}
                            </option>
                          ))}
                      </optgroup>
                    )}
                  </select>
                </label>
                <label>
                  Physician
                  <select name="providerId" required defaultValue={sp.bookWith}>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Clinician
                  <select name="clinicalStaffId" defaultValue={sp.bookStaff ?? ""}>
                    <option value="">—</option>
                    {clinicalStaff.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.user.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Supervising physician
                  <select name="supervisingProviderId" defaultValue={sp.bookSup ?? ""}>
                    <option value="">— Default from provider —</option>
                    {supervisors.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Collaborating physician
                  <select name="collaboratingProviderId" defaultValue={sp.bookCollab ?? ""}>
                    <option value="">—</option>
                    {collaborators.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Insurance auth
                  <select name="intakeCaseId" defaultValue={defaultAuth}>
                    <option value="">—</option>
                    {approvedAuths.map((c) => (
                      <option key={c.id} value={c.id}>
                        {sp.patientId ? "" : `${patientName(c.patient)} · `}#{c.authNumber}
                        {c.authEndDate ? ` thru ${formatDate(c.authEndDate)}` : ""}
                        {c.authVisitsApproved ? ` · ${c.authVisitsApproved} visits` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Site of service
                  <select name="locationId" required defaultValue={bookLocation}>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                {settings.showPosDropdown && (
                  <label>
                    Place of service (POS)
                    <select name="placeOfService" defaultValue={sp.bookPos ?? ""}>
                      <option value="">— From encounter type —</option>
                      {Object.entries(placeOfServiceLabel).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Room
                  <input name="room" placeholder="Room / bed" defaultValue={sp.bookRoom} />
                </label>
                {resources.length > 0 && (
                  <label>
                    Resource
                    <select name="resourceId" defaultValue={sp.bookRes ?? ""}>
                      <option value="">—</option>
                      {resources.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} · {r.location.name} (max {r.maxUnits})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Account number
                  <input name="accountNumber" defaultValue={sp.bookAcct} />
                </label>
              </div>
              <details className="vw-recurring" open={Boolean(sp.bookRecur && sp.bookRecur !== "NONE")}>
                <summary>Recurring visit</summary>
                <div className="form-grid">
                  <label>
                    Recurs
                    <select name="recurrence" defaultValue={sp.bookRecur ?? "NONE"}>
                      <option value="NONE">Does not repeat</option>
                      <option value="WEEKLY">Weekly</option>
                      <option value="BIWEEKLY">Every 2 weeks</option>
                    </select>
                  </label>
                  <label>
                    End date
                    <input name="recurrenceEnd" type="date" defaultValue={sp.bookRecurEnd} />
                  </label>
                </div>
                <div className="vw-weekdays">
                  {DAY_ABBR.map((d, i) => (
                    <label key={d} className="checkbox-inline">
                      <input type="checkbox" name="weekdays" value={i} defaultChecked={(sp.bookDays ?? "").split(",").includes(String(i))} /> {d}
                    </label>
                  ))}
                </div>
                <p className="muted">Days left blank repeat on the first visit&apos;s weekday. Up to 52 visits.</p>
              </details>
              <label>
                Visit notes
                <input name="reason" defaultValue={sp.bookNotes} />
              </label>
              <button className="btn" type="submit">
                Create
              </button>
            </form>

            <form className="panel stack" action={createReservedTime}>
              <h2>Schedule reserved time</h2>
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
                Site of service (optional)
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
