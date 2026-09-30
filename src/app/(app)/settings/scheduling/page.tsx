import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSchedulerSettings, getVisitTypes } from "@/lib/scheduler-setup";
import {
  CALENDAR_STATUSES,
  COLOR_MODES,
  PREVIEW_FIELDS,
  TIME_OPTIONS,
  parseJson,
  parseOfficeHours,
  type ColorPair,
} from "@/lib/scheduler";
import { DAY_NAMES } from "@/lib/schedule";
import { SettingsNav } from "../settings-nav";
import {
  addCancellationReason,
  addResource,
  addVisitType,
  deleteFilterSet,
  removeCancellationReason,
  saveColorCoding,
  saveFilterSet,
  saveGeneralScheduling,
  saveOfficeHours,
  savePreviewFields,
  saveVisitTypes,
  updateResource,
  importHolidays,
  addClosure,
  deleteClosure,
} from "./actions";
import { DEFAULT_HOLIDAYS, holidaysFor } from "@/lib/holidays";
import { formatDate } from "@/lib/format";

const TABS: [string, string][] = [
  ["types", "Visit type & time"],
  ["colors", "Color coding"],
  ["preview", "Visit info"],
  ["hours", "Office hours"],
  ["cancel", "Cancellation reasons"],
  ["filters", "Calendar filters"],
  ["general", "General"],
  ["resources", "Resources"],
  ["holidays", "Holidays & closures"],
  ["schedules", "Provider & clinician schedules"],
];

function Chip({ c, label }: { c: ColorPair; label: string }) {
  return (
    <span className="sa-chip" style={{ color: c.text, background: c.bg }}>
      {label}
    </span>
  );
}

export default async function SchedulingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; saved?: string; error?: string; location?: string; year?: string }>;
}) {
  const user = await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "types";
  const [settings, types, locations, physicians, reasons, filters] = await Promise.all([
    getSchedulerSettings(user.practiceId),
    getVisitTypes(user.practiceId, { includeInactive: true }),
    prisma.location.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" }, include: { resources: { orderBy: { name: "asc" } } } }),
    prisma.user.findMany({ where: { practiceId: user.practiceId, role: { in: ["CLINICIAN", "ADMIN"] }, active: true }, orderBy: { name: "asc" } }),
    prisma.cancellationReason.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: [{ name: "asc" }] }),
    prisma.calendarFilterSet.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" } }),
  ]);
  const statusColors = parseJson<Record<string, ColorPair>>(settings.statusColors, {});
  const physicianColors = parseJson<Record<string, ColorPair>>(settings.physicianColors, {});
  const previewFields = new Set(parseJson<string[]>(settings.previewFields, []));
  const loc = locations.find((l) => l.id === sp.location) ?? locations.find((l) => l.id === settings.defaultLocationId) ?? locations[0];
  const hours = parseOfficeHours(loc?.officeHours);
  const billable = types.filter((t) => t.billable);
  const nonBillable = types.filter((t) => !t.billable);
  const typeName = new Map(types.map((t) => [t.code, t.name]));
  const physName = new Map(physicians.map((p) => [p.id, p.name]));

  const typeRows = (list: typeof types) =>
    list.map((t) => (
      <tr key={t.id} className={t.active ? undefined : "muted"}>
        <td>
          <input name={`name_${t.id}`} defaultValue={t.name} aria-label="Visit type name" className="sa-name" />
          <div className="muted">{t.code}</div>
        </td>
        <td>
          <input name={`dur_${t.id}`} type="number" min={5} max={480} step={5} defaultValue={t.durationMin ?? ""} className="st-num" aria-label={`${t.name} minutes`} />
        </td>
        <td>
          <input type="checkbox" name={`bill_${t.id}`} defaultChecked={t.billable} aria-label={`${t.name} billable`} />
        </td>
        <td className="sa-colors">
          <input type="color" name={`text_${t.id}`} defaultValue={t.textColor} aria-label={`${t.name} text colour`} />
          <input type="color" name={`bg_${t.id}`} defaultValue={t.bgColor} aria-label={`${t.name} background colour`} />
          <Chip c={{ text: t.textColor, bg: t.bgColor }} label="Preview" />
        </td>
        <td>
          <input name={`order_${t.id}`} type="number" defaultValue={t.sortOrder} className="st-num" aria-label={`${t.name} order`} />
        </td>
        <td>
          <input type="checkbox" name={`active_${t.id}`} defaultChecked={t.active} aria-label={`${t.name} active`} />
        </td>
      </tr>
    ));

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link>
          </p>
          <h1>Scheduler admin</h1>
        </div>
        <Link className="btn secondary" href="/schedule">
          Open schedule
        </Link>
      </div>
      <SettingsNav current="scheduling" />
      <nav className="view-tabs st-tabs" aria-label="Scheduler admin">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/settings/scheduling?tab=${k}`} className={`view-tab${tab === k ? " active" : ""}`}>
            {l}
          </Link>
        ))}
      </nav>
      {sp.saved && <p className="notice-ok">Saved.</p>}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}

      {tab === "types" && (
        <>
          <form action={saveVisitTypes} className="panel stack">
            <h2>Encounter type and time</h2>
            <p className="muted">Default length of each visit type (fills the booking length), whether it&apos;s billable, and its colour on the calendar.</p>
            {[
              ["Encounter types", billable],
              ["Non-billable interactions", nonBillable],
            ].map(([title, list]) => (
              <div key={title as string} className="table-scroll">
                <h3>{title as string}</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Encounter type</th>
                      <th>Duration (min)</th>
                      <th>Billable</th>
                      <th>Colour (text / background)</th>
                      <th>Order</th>
                      <th>Active</th>
                    </tr>
                  </thead>
                  <tbody>{typeRows(list as typeof types)}</tbody>
                </table>
              </div>
            ))}
            <div className="form-actions">
              <button className="btn" type="submit">
                Save
              </button>
            </div>
          </form>
          <form action={addVisitType} className="panel form-grid gw-grid-3">
            <label>
              New visit type
              <input name="name" required placeholder="e.g. Hyperbaric Oxygen Treatment" />
            </label>
            <label>
              Duration (min)
              <input name="durationMin" type="number" min={5} max={480} step={5} />
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="nonBillable" /> Non-billable interaction
            </label>
            <button className="btn secondary" type="submit">
              Add visit type
            </button>
          </form>
        </>
      )}

      {tab === "colors" && (
        <form action={saveColorCoding} className="panel stack">
          <h2>Scheduler color coding</h2>
          <div className="st-checks">
            {Object.entries(COLOR_MODES).map(([k, l]) => (
              <label key={k} className="checkbox-inline">
                <input type="radio" name="colorMode" value={k} defaultChecked={settings.colorMode === k} /> {l}
              </label>
            ))}
          </div>
          <p className="muted">Choose what the schedule is coloured by; each list below keeps its own colours.</p>
          <div className="sa-color-grid">
            <div>
              <h3>Encounter status</h3>
              <table>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Text</th>
                    <th>Background</th>
                    <th>Preview</th>
                  </tr>
                </thead>
                <tbody>
                  {CALENDAR_STATUSES.map(([key, label, def]) => {
                    const c = statusColors[key] ?? def;
                    return (
                      <tr key={key}>
                        <td>{label}</td>
                        <td>
                          <input type="color" name={`st_text_${key}`} defaultValue={c.text} aria-label={`${label} text`} />
                        </td>
                        <td>
                          <input type="color" name={`st_bg_${key}`} defaultValue={c.bg} aria-label={`${label} background`} />
                        </td>
                        <td>
                          <Chip c={c} label={label} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div>
              <h3>Encounter type</h3>
              <table>
                <tbody>
                  {types
                    .filter((t) => t.active)
                    .map((t) => (
                      <tr key={t.id}>
                        <td>{t.name}</td>
                        <td>
                          <input type="color" name={`ty_text_${t.id}`} defaultValue={t.textColor} aria-label={`${t.name} text`} />
                        </td>
                        <td>
                          <input type="color" name={`ty_bg_${t.id}`} defaultValue={t.bgColor} aria-label={`${t.name} background`} />
                        </td>
                        <td>
                          <Chip c={{ text: t.textColor, bg: t.bgColor }} label={t.name} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <h3>Physician</h3>
              <table>
                <tbody>
                  {physicians.map((p) => {
                    const c = physicianColors[p.id] ?? { text: "#ffffff", bg: "#2f5fa8" };
                    return (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td>
                          <input type="color" name={`ph_text_${p.id}`} defaultValue={c.text} aria-label={`${p.name} text`} />
                        </td>
                        <td>
                          <input type="color" name={`ph_bg_${p.id}`} defaultValue={c.bg} aria-label={`${p.name} background`} />
                        </td>
                        <td>
                          <Chip c={c} label={p.name} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="form-actions">
            <button className="btn" type="submit">
              Save colours
            </button>
          </div>
        </form>
      )}

      {tab === "preview" && (
        <form action={savePreviewFields} className="panel stack">
          <h2>Encounter information preview</h2>
          <p className="muted">
            Always shown: provider, patient, encounter type, status and visit notes. Tick the extra details to show when a visit is opened on the schedule.
          </p>
          <div className="sa-preview">
            <div className="st-checks sa-preview-list">
              {Object.entries(PREVIEW_FIELDS).map(([k, l]) => (
                <label key={k} className="checkbox-inline">
                  <input type="checkbox" name="fields" value={k} defaultChecked={previewFields.has(k)} /> {l}
                </label>
              ))}
            </div>
            <div className="sa-preview-box">
              <p className="muted">Provider names · Patient name · Encounter type · Finalized · Encounter notes</p>
              <hr />
              {[...previewFields].map((k) => (
                <p key={k}>{PREVIEW_FIELDS[k]}</p>
              ))}
            </div>
          </div>
          <div className="form-actions">
            <button className="btn" type="submit">
              Save
            </button>
          </div>
        </form>
      )}

      {tab === "hours" && loc && (
        <form action={saveOfficeHours.bind(null, loc.id)} className="panel stack">
          <div className="gw-section-head">
            <h2>Office hours</h2>
          </div>
          <p className="sa-sites">
            Site of service:{" "}
            {locations.map((l) => (
              <Link key={l.id} href={`/settings/scheduling?tab=hours&location=${l.id}`} className={l.id === loc.id ? "sa-current" : undefined}>
                {l.name}
              </Link>
            ))}
          </p>
          <div className="st-checks">
            <label className="checkbox-inline">
              <input type="checkbox" name="showNonOfficeHours" defaultChecked={loc.showNonOfficeHours} /> Show non-office hours on the calendar
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="promptOutsideHours" defaultChecked={loc.promptOutsideHours} /> Prompt when scheduling outside of office hours
            </label>
          </div>
          <table className="sa-hours">
            <thead>
              <tr>
                <th>Day</th>
                <th>Start time</th>
                <th>End time</th>
              </tr>
            </thead>
            <tbody>
              {hours.map((h) => (
                <tr key={h.day}>
                  <td>{DAY_NAMES[h.day]}</td>
                  <td>
                    <select name={`start_${h.day}`} defaultValue={h.closed ? "CLOSED" : h.start} aria-label={`${DAY_NAMES[h.day]} start`}>
                      <option value="CLOSED">Closed all day</option>
                      {TIME_OPTIONS.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select name={`end_${h.day}`} defaultValue={h.end} aria-label={`${DAY_NAMES[h.day]} end`}>
                      {TIME_OPTIONS.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <label style={{ maxWidth: "14rem" }}>
            Time increment
            <select name="slotMinutes" defaultValue={String(loc.slotMinutes)}>
              {[5, 10, 15, 20, 30, 60].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </label>
          {locations.length > 1 && (
            <fieldset className="gw-fieldset">
              <legend>Copy to site of service</legend>
              <div className="st-checks">
                {locations
                  .filter((l) => l.id !== loc.id)
                  .map((l) => (
                    <label key={l.id} className="checkbox-inline">
                      <input type="checkbox" name="copyTo" value={l.id} /> {l.name}
                    </label>
                  ))}
              </div>
            </fieldset>
          )}
          <div className="form-actions">
            <button className="btn" type="submit">
              Save office hours
            </button>
          </div>
        </form>
      )}

      {tab === "cancel" && (
        <div className="two-col">
          <section className="panel">
            <h2>Cancellation reasons</h2>
            <table>
              <tbody>
                {reasons.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td style={{ textAlign: "right" }}>
                      <form action={removeCancellationReason.bind(null, r.id)}>
                        <button className="btn ghost gw-mini" type="submit">
                          Delete
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <form action={addCancellationReason} className="panel stack">
            <h2>Add a cancellation reason</h2>
            <input name="name" required aria-label="Cancellation reason" />
            <button className="btn" type="submit">
              Add
            </button>
          </form>
        </div>
      )}

      {tab === "filters" && (
        <div className="two-col">
          <section className="panel">
            <h2>Saved calendar filters</h2>
            <p className="muted">Filter sets appear in the schedule&apos;s &ldquo;Calendar filter&rdquo; list.</p>
            {filters.length === 0 && <p className="muted">None yet.</p>}
            <ul className="rp-list">
              {filters.map((f) => (
                <li key={f.id}>
                  <strong>{f.name}</strong>
                  <span className="muted">
                    {[
                      f.description,
                      f.locationId ? locations.find((l) => l.id === f.locationId)?.name : "All sites",
                      f.providerIds ? f.providerIds.split(",").map((id) => physName.get(id) ?? "?").join(", ") : "All physicians",
                      f.visitTypes ? f.visitTypes.split(",").map((c) => typeName.get(c) ?? c).join(", ") : "All types",
                      `${f.view} view`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <form action={deleteFilterSet.bind(null, f.id)}>
                    <button className="btn ghost gw-mini" type="submit">
                      Delete
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
          <form action={saveFilterSet} className="panel stack" id="new-filter">
            <h2>Edit filter set</h2>
            <label>
              Filter set name
              <input name="name" required />
            </label>
            <label>
              Filter set description
              <input name="description" />
            </label>
            <label>
              Filter by site of service
              <select name="locationId" defaultValue="">
                <option value="">Select all</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="gw-fieldset">
              <legend>Filter by physician(s)</legend>
              <div className="st-checks">
                {physicians.map((p) => (
                  <label key={p.id} className="checkbox-inline">
                    <input type="checkbox" name="providerIds" value={p.id} /> {p.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="gw-fieldset">
              <legend>Filter by encounter type(s)</legend>
              <div className="st-checks">
                {types
                  .filter((t) => t.active)
                  .map((t) => (
                    <label key={t.id} className="checkbox-inline">
                      <input type="checkbox" name="visitTypes" value={t.code} /> {t.name}
                    </label>
                  ))}
              </div>
            </fieldset>
            <div className="st-checks">
              Schedule day view:
              {["day", "week", "list"].map((v) => (
                <label key={v} className="checkbox-inline">
                  <input type="radio" name="view" value={v} defaultChecked={v === "day"} /> {v === "week" ? "Work week" : v === "list" ? "List view" : "Day"}
                </label>
              ))}
            </div>
            <div className="vw-step-actions">
              <button className="btn secondary" type="submit" name="another" value="1">
                Save and add another
              </button>
              <button className="btn" type="submit">
                Save changes
              </button>
            </div>
          </form>
        </div>
      )}

      {tab === "general" && (
        <form action={saveGeneralScheduling} className="panel stack">
          <h2>Calendar configuration</h2>
          <div className="form-grid gw-grid-3">
            <label>
              Default site of service
              <select name="defaultLocationId" defaultValue={settings.defaultLocationId ?? ""}>
                <option value="">—</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="st-checks st-rules">
            <label className="checkbox-inline">
              <input type="checkbox" name="showWeekends" defaultChecked={settings.showWeekends} /> Show Saturday and Sunday in week view
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="showPosDropdown" defaultChecked={settings.showPosDropdown} /> Show POS code dropdown on schedule visit
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="showCapacityView" defaultChecked={settings.showCapacityView} /> Show capacity view
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="autoCheckIn" defaultChecked={settings.autoCheckIn} /> Automatically check in same-day visits
              <input name="autoCheckInMinutes" type="number" min={0} max={240} defaultValue={settings.autoCheckInMinutes} className="st-num" aria-label="Minutes before start" />{" "}
              min before start
            </label>
          </div>
          <h3>Encounter start time</h3>
          <div className="st-checks">
            <label className="checkbox-inline">
              <input type="radio" name="startTimeMode" value="CURRENT" defaultChecked={settings.startTimeMode === "CURRENT"} /> Use current computer time
            </label>
            <label className="checkbox-inline">
              <input type="radio" name="startTimeMode" value="FIXED" defaultChecked={settings.startTimeMode === "FIXED"} /> Use specific time
              <select name="startTimeFixed" defaultValue={settings.startTimeFixed} aria-label="Default start time">
                {TIME_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <h3>Conflicts &amp; authorizations</h3>
          <div className="st-checks st-rules">
            <label className="checkbox-inline">
              <input type="checkbox" name="showConflicts" defaultChecked={settings.showConflicts} /> Show conflicts for double booking
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="allowCrossSiteConflicts" defaultChecked={settings.allowCrossSiteConflicts} /> Allow conflicting provider schedules across
              sites of service
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="defaultAuthorizations" defaultChecked={settings.defaultAuthorizations} /> Default authorizations when scheduling
            </label>
          </div>
          <div className="form-actions">
            <button className="btn" type="submit">
              Save
            </button>
          </div>
        </form>
      )}

      {tab === "resources" && loc && (
        <section className="panel stack">
          <h2>Scheduler resources</h2>
          <p className="muted">
            Equipment or rooms that limit how many visits can run at once (e.g. MIST ultrasound units). Booking warns when a resource is full.
          </p>
          <p className="sa-sites">
            Site of service:{" "}
            {locations.map((l) => (
              <Link key={l.id} href={`/settings/scheduling?tab=resources&location=${l.id}`} className={l.id === loc.id ? "sa-current" : undefined}>
                {l.name}
              </Link>
            ))}
          </p>
          <table>
            <thead>
              <tr>
                <th>Resource</th>
                <th>Maximum units</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loc.resources.map((r) => (
                <tr key={r.id}>
                  <td colSpan={4}>
                    <form action={updateResource.bind(null, r.id)} className="sa-resource-row">
                      <input name="name" defaultValue={r.name} aria-label="Resource name" />
                      <input name="maxUnits" type="number" min={1} max={99} defaultValue={r.maxUnits} className="st-num" aria-label="Maximum units" />
                      <input type="checkbox" name="active" defaultChecked={r.active} aria-label="Active" />
                      <button className="btn ghost gw-mini" type="submit">
                        Save
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {loc.resources.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No resources active at this location.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <form action={addResource} className="vw-inline">
            <input type="hidden" name="locationId" value={loc.id} />
            <input name="name" required placeholder="Resource (e.g. MIST unit)" aria-label="New resource name" />
            <input name="maxUnits" type="number" min={1} max={99} defaultValue={1} className="st-num" aria-label="Maximum units" />
            <button className="btn secondary gw-mini" type="submit">
              Add resource
            </button>
          </form>
        </section>
      )}

      {tab === "holidays" && <HolidaysTab practiceId={user.practiceId} locations={locations} year={Number(sp.year) || new Date().getFullYear()} />}

      {tab === "schedules" && (
        <section className="panel stack">
          <h2>Provider &amp; clinician schedules</h2>
          <p className="muted">
            Working days and hours for each physician and clinician at each site of service. The schedule warns when a visit is booked outside them.
          </p>
          <Link className="btn" href="/schedule/availability">
            Manage schedules →
          </Link>
        </section>
      )}
    </div>
  );
}

async function HolidaysTab({ practiceId, locations, year }: { practiceId: string; locations: { id: string; name: string }[]; year: number }) {
  const closures = await prisma.clinicClosure.findMany({
    where: { practiceId, date: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } },
    orderBy: { date: "asc" },
  });
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  return (
    <div className="stack">
      <section className="panel">
        <div className="cn-head">
          <h2>Closed days in {year}</h2>
          <nav className="cn-filters">
            {[year - 1, year, year + 1].map((y) => (
              <Link key={y} href={`/settings/scheduling?tab=holidays&year=${y}`} className={y === year ? "active" : ""}>
                {y}
              </Link>
            ))}
          </nav>
        </div>
        <p className="muted">The schedule shows these days as closed and warns when a visit is booked on one (unless the closure allows booking, e.g. on-call clinic).</p>
        {closures.length === 0 ? (
          <p className="muted">No closed days yet — import holidays below.</p>
        ) : (
          <table className="cn-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Reason</th>
                <th>Location</th>
                <th>Booking</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {closures.map((c) => (
                <tr key={c.id}>
                  <td>{formatDate(c.date)} <span className="muted">{c.date.toLocaleDateString("en-US", { weekday: "short" })}</span></td>
                  <td>
                    {c.name} <span className="cn-tag">{c.kind === "HOLIDAY" ? "holiday" : "closure"}</span>
                  </td>
                  <td>{c.locationId ? locName.get(c.locationId) : "All locations"}</td>
                  <td>{c.allowBooking ? "Allowed" : "Blocked (warning)"}</td>
                  <td>
                    <form action={deleteClosure.bind(null, c.id)}>
                      <button className="btn ghost gw-mini" type="submit">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="panel">
        <h2>Import US holidays</h2>
        <form action={importHolidays} className="stack">
          <div className="cn-inline">
            <select name="year" defaultValue={year} aria-label="Year">
              {[year - 1, year, year + 1, year + 2].map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
            <select name="locationId" defaultValue="" aria-label="Location">
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="cn-types">
            {holidaysFor(year).map(([name, date]) => (
              <label key={name} className="checkbox-inline">
                <input type="checkbox" name="holiday" value={name} defaultChecked={DEFAULT_HOLIDAYS.includes(name)} /> {name}{" "}
                <span className="muted cn-small">{formatDate(date)}</span>
              </label>
            ))}
          </div>
          <div>
            <button className="btn secondary" type="submit">
              Import selected holidays
            </button>
          </div>
        </form>
      </section>
      <section className="panel">
        <h2>Add a closure</h2>
        <form action={addClosure} className="form-grid gw-grid-3">
          <label>
            From
            <input type="date" name="from" required />
          </label>
          <label>
            To (optional)
            <input type="date" name="to" />
          </label>
          <label>
            Reason
            <input name="name" required placeholder="Staff training, weather, office move…" />
          </label>
          <label>
            Location
            <select name="locationId" defaultValue="">
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-inline">
            <input type="checkbox" name="allowBooking" /> Still allow booking
          </label>
          <button className="btn" type="submit">
            Add closure
          </button>
        </form>
      </section>
    </div>
  );
}
