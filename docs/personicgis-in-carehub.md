# Bringing PersonicGIS into the CareHub Scheduler

Research notes, 16 Oct 2026. Source: *PersonicGIS Functional Specification* (26 pages, read from the PersonicGIS code base) compared against the CareHub code on branch `carehub-telehealth-scheduler`. This is a plan for discussion, not an implementation. The plan is expected to change before any code is written.

**Direction:** PersonicGIS is not added as a separate module. Its features are folded into the existing **Scheduler** page (`/schedule`) and its sub-pages, the same way the telehealth scheduler was: a header button, a view tab, a sub-page with tabs, and new actions on visit rows. Field staff planning home visits and front office booking clinic visits then work in one place.

**Two rules decided on 16 Oct 2026:**

1. **GIS applies to every visit type except** Medical Records Entry, Communication Log, Data Entry, Provider Orders, Principal Care Management, and all Telehealth types. Every other type is a field visit: it is geocoded, plotted, routable and bookable from a route. See section 3.
2. **Field visits carry a date, not a time.** The clock time and length inputs disappear from booking for field types; the order of the day comes from the route. See section 4.

## 1. The short version

- **About a third of the PersonicGIS checklist already exists in CareHub**: tenant scoping, login and security policy, a permission map with per-user overrides, user management, an audit log, a cron job runner with a run log, address standardisation through the US Census geocoder, no-login token pages, CSV export, provider and care-team records, and a scheduler with Day / Week / List / Capacity views, filters by physician, site and encounter type, saved filter sets, provider availability and a booking panel.
- **The genuinely new work is the GIS core**: patient coordinates, a background geocoding job, map and route tables, the map canvas, directions, patient and provider groups, pin colours, drawn regions, and public route share links.
- **What the scheduler gains that PersonicGIS never had**: a route stop can book a real home-visit appointment, routes respect provider availability and the capacity grid, and the week's booked visits can be seen on a map with the same filters as the calendar.
- **Several PersonicGIS features should not be copied**: Databricks and CRM sync (CareHub is the EMR), encrypted pagination cursors, client-side decryption of the Google Maps key, Azure AD only login, the SCIM stub, the keep-alive worker, Socket.IO.
- **One external decision**: the mapping provider. Google Maps JavaScript, Geocoding and Directions bill per use. CareHub already calls the free Census geocoder, and open alternatives exist for tiles and routing. Recommendation: build behind an adapter seam like `src/lib/clearinghouse/`, start with free providers, switch to Google per practice when a key is configured in Scheduler admin.

## 2. Where each piece lives on the Scheduler page

The screenshot of `/schedule` today shows these surfaces. Each becomes an entry point.

| Scheduler surface today | What it becomes |
| --- | --- |
| Header buttons: **Batch eligibility**, **Manage availability**, **Telehealth**, **Scheduler admin** | Add a **Field routes** button (shown when the practice has field visits switched on, as **Telehealth** is shown only when the telehealth visit type exists). It opens `/schedule/routes`. |
| View tabs: **Day / Week / List / Capacity** | Add a **Map** view. It plots the visits in the current date range by the patient's geocoded address, coloured by the scheduler's colour mode (status, type or physician), with provider home markers. Switched on per practice by a `showMapView` flag in `SchedulerSettings`, exactly like `showCapacityView`. |
| Filter bar: **Physician, Site of service, Encounter type, Show missed & cancelled, saved filter sets** | The same filters drive the Map view and the Field routes pages. Saved `CalendarFilterSet`s can carry the map's layer and colour choices. Two new filters appear only on field pages: patient state and county. |
| Visit rows: **Visit info, Open chart, Check in, Confirm, Start encounter, Mark missed** | On field-type rows add **Add to route** (pick a route dated the same day, or create one) and **Show on map**. The WHEN column shows the date only for field visits, with "Route · <label> · stop 3 of 8" under the detail when the visit is on a route, as telehealth rows show their reservation line. Excluded types keep their time. |
| **Schedule encounter** panel (right) | Choosing a field type hides **Visit date & time**'s clock part and **Length (min)**; only the date remains. Booking from a route stop pre-fills the patient, the physician from the route's provider, the date from the route, place of service **12 Home** by default, and site of service the provider's base location. Eligibility and authorization checks run as today; the time-overlap conflict check is skipped for date-only visits (section 4). |
| **Capacity** view | Field providers' days show route counts next to clinic visit counts, so a coordinator can see which days have room for a route. |
| **Scheduler admin** (`/settings/scheduling`) | New section **Field routes**: enable, map provider and key, default origin per provider, field status list, provider title styles (NP / LPN / MA colours), share link expiry and open limit. |
| Sub-navigation tabs: **Scheduler, Flow board, Checkout, Eligibility checks, Recalls** | Optionally add **Field routes** here too (`AppShell.tsx`, Front office group), gated by the new permission. The header button alone is enough for a first version. |

### The `/schedule/routes` sub-page

Built like `/schedule/telehealth`, which has **Doctors / Availability / Reservations** tabs over one server page with server actions. Suggested tabs:

| Tab | PersonicGIS equivalent | Content |
| --- | --- | --- |
| **Field board** | Patient board | The practice's patients as a table: MRN, name, DOB, address, county, state, field status, care group, referral source, home health, last and next visit (from appointments), weekly schedule, NP / LPN / MA, note. Inline edits, bulk assign, add to group, colour pins, export. |
| **Maps** | Routes page / map list | The user's maps (owned and shared) with create, edit, share, members. Opening one shows the canvas with pins, filters, layers, groups, regions, places search. |
| **Routes** | Visits | Routes grouped by provider and date: stops in order, drag to reorder, notes, directions summary (distance, duration, stops), **Book visits** to create the appointments for every stop, and **Share link**. |
| **Groups** | Groups | Patient groups and provider groups, with members and map visibility toggles. |
| **Share links** | Admin share links page | Links in the practice with masked code, creator, opens used, status, expire / delete / purge expired. |
| **Geocoding** | Resolve coordinates | Patients and providers without coordinates, last job run, "Run now", manual re-geocode for one patient. Could instead sit in Settings → Automation runs, where the job log already is. |

The public viewer for a share link is a token page under the patient route group, `src/app/(patient)/r/[code]/page.tsx`, like the survey and kiosk pages: no login, addresses only, no names.

## 3. Scope: which visit types are GIS visits

The practice's visit types are seeded from `DEFAULT_VISIT_TYPES` in `src/lib/scheduler.ts` and owned per practice in the `VisitType` table. GIS behaviour is a flag on the type, not a new type, so no "Home Visit" type is added.

| Code | Name | GIS field visit |
| --- | --- | --- |
| `INIT_WOUND`, `EST_WOUND`, `WOUND_CARE`, `ACTIGRAFT`, `ABI`, `HBO`, `TCOM`, `PROV_MIST`, `NPWCN_MIST`, `NON_PROVIDER`, `SNF_EST`, `SURVEILLANCE` | Wound-care and procedure visits | **Yes** |
| `NEW`, `FOLLOW_UP`, `SICK`, `WELL`, `AWV`, `PHYSICAL`, `CHRONIC`, `WELL_CHILD` | General and primary-care visits (specialty packs) | **Yes** |
| `RECORDS` | Medical Records Entry | No |
| `COMM_LOG` | Communication Log | No |
| `DATA_ENTRY` | Data Entry | No |
| `PROVIDER_ORDERS` | Provider Orders | No |
| `PCM` | Principal Care Management | No |
| `TELE_INIT`, `TELE_EST`, `TELE` | Telehealth (all) | No |

How it works:

- `VisitType.fieldVisit Boolean @default(true)`, seeded `false` for the eight excluded codes. Editable per type in Scheduler admin → Visit types, so a practice can exclude more.
- Everything GIS keys off that flag: the **Map** view plots only field-type visits; **Add to route**, **Show on map** and the route line appear only on field-type rows; the booking panel switches to date-only mode when a field type is chosen; the **Routes** tab's **Book visits** uses the route's chosen field type (default: the patient's last field type, else Established Wound Care).
- Excluded types behave exactly as today: timed, on the calendar, no map, no route.
- Telehealth stays on its own reservation flow; nothing in this plan touches `TelehealthReservation`.

## 4. Date-only field visits

PersonicGIS plans a route for a day, not for clock slots, and the practice wants CareHub's field visits to match. Today `Appointment.startsAt` and `endsAt` are required and drive the Day and Week grids, the overlap conflict check in `src/lib/schedule-conflicts.ts`, auto check-in, reminder text, capacity counts and the Flow board.

Proposed shape, keeping the columns so nothing else breaks:

- `Appointment.allDay Boolean @default(false)`. A field visit is booked with `allDay = true`, `startsAt` at local midnight of the visit date and `endsAt` at the end of that day. Nothing in the UI shows those times.
- `Appointment.routeStopId String? @unique` links the visit to its stop; the stop's `index` is the order of the day.
- **Booking panel**: for a field type the input is a date picker; the clock part and **Length (min)** are hidden. The type's `durationMin` is still used, but only as a drive-plan estimate on the route (not shown as a slot).
- **Day and Week views**: all-day visits render in an "All day" band at the top of each day, ordered by route and stop index, then patient name. The **List** view shows the date only in WHEN.
- **Conflict check**: skipped for all-day visits (no overlap concept). A provider double-booked on a day is allowed; the Capacity view and route stop count are the signal instead.
- **Auto check-in** (`SchedulerSettings.autoCheckIn`): skips all-day visits, since there is no start time to count down from.
- **Reminders and confirmations** (Patient Connect): the template shows the date and the provider; the time token is blank for all-day visits. Offset hours count from the start of the day.
- **Capacity view**: counts all-day visits as visits; a route adds its stop count to the day.
- **Flow board and Checkout**: unchanged; they key off status, not time.
- **Reports** that bucket by hour ignore all-day visits or put them in a "no time" bucket.

Decided 16 Oct 2026: date-only applies to field visits only. The six excluded types and all telehealth types keep their clock times, so telehealth windows, the overlap conflict check and timed admin tasks are untouched.

## 5. How the two systems differ structurally

| Topic | PersonicGIS | CareHub | Consequence |
| --- | --- | --- | --- |
| Tenant / scope | US **State** rows; users hold a list of state codes; a per-request encrypted header picks the active state and every query filters by it | **Practice** with **Membership** per user and a practice switcher; `Patient.state`, `Location.state`, `TelehealthProvider.stateLicenses` (JSON list) | Scope GIS objects by `practiceId`; state is a **filter**. If one practice spans several states and people must be confined to some, add `allowedStates` JSON on `Membership`, in the style of `stateLicenses`. The spec's "UNS" bucket becomes "patients whose state is blank or not in the practice's list". |
| Identity | Azure AD SSO only, JWT pinned to IP | Password login, lockout, 2FA, idle timeout, organisation IP allowlist, server-side sessions | Keep CareHub's auth. Login history is already in `AuditLog` (`LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGIN_LOCKED`, `LOGIN_BLOCKED_IP`). |
| Permissions | ~120 flat `RESOURCE:ACTION` keys, roles are data | Flat keys with role defaults in `src/lib/permissions.ts`, per-user overrides in `Membership.permissions` | Reuse `schedule.view` for the Map view. Add `schedule.routes.view`, `schedule.routes.edit`, `schedule.routes.share`, `schedule.field.assign` (NP / LPN / MA), `schedule.field.geocode`. Roles stay code-defined. |
| Per-object sharing | Map and Group membership OWNER / ADMIN / EDITOR / VIEWER | None yet | New `RouteMapMember` and `FieldGroupMember` tables plus one helper that returns the caller's role on a map or group. |
| Patient source | Pulled from a warehouse and a CRM, upsert by MRN | CareHub **is** the EMR | No sync module. Last and next visit are queries over `Appointment`. Address changes are detected in the patient edit action, which nulls the coordinates. |
| Visits | A "visit" is a route, unrelated to any calendar | `Appointment` with provider, location, visit type, status, flow events, eligibility, telehealth mirror | A route stop may create a date-only `Appointment` of a field type and keep its id, as `TelehealthReservation.appointmentId` does. Cancel, miss and check-in then work from the calendar. |
| Background work | node-cron with a Schedule table; progress in module variables | pg-boss registry in `src/lib/jobs.ts`, `JobRun`, Settings → Automation runs with "Run now" | Register a `geocode` job; progress is a count query shown with the existing `AutoRefresh` component. |
| Realtime | Socket.IO | None; `router.refresh()` polling | Permission changes already apply on the next request because `getCurrentUser` re-reads the membership. In-app notifications poll an unread count; Server-Sent Events later if wanted. |
| Audit | Activity log with old/new JSON, IP, user agent | `AuditLog` via `logAudit(...)`, Settings → Audit | Reuse. Put old/new JSON in `detail`. |
| Public links | Encrypted payload, short code, 14-day expiry, access limit | Token pages under `src/app/(patient)/` | Same pattern for `/r/[code]`. |
| Export | ExcelJS `.xlsx` with styled header | `toCsv` in `src/lib/report-catalog.ts`; nothing writes `.xlsx` | CSV comes free; styled `.xlsx` needs `exceljs` (MIT). |
| Tables | AG Grid Enterprise (licensed) | Hand-rolled server tables, `InlineSelect`, `SelectAll`, `PatientSearchPanel` | Field board as a server page with URL-param filters and inline server actions, as the UltraMist tracker does. TanStack Table (MIT) if a richer grid is wanted later. |

## 6. Feature-by-feature mapping

Numbers follow the spec's replication checklist. "Have" means CareHub already has it, "Extend" means an existing piece grows, "New" means net-new code.

| # | Spec feature | Spec priority | CareHub status | How it fits the Scheduler |
| --- | --- | --- | --- | --- |
| 1 | State scoping | Must | Have (as Practice) | Practice scope; state and county filters on field pages. Optional `Membership.allowedStates`. |
| 2 | Azure AD SSO, login history | Must | Have (different mechanism) | Keep as is. |
| 3 | RBAC | Must | Have | New `schedule.routes.*` and `schedule.field.*` keys; header button, view tab and row actions hide by key as **Telehealth** does with `telehealth.setup` / `telehealth.confirm`. |
| 4 | Patient model and sync | Must | Have most fields; sync not needed | Existing: `mrn`, names, `dob`, address parts, `county`, `homeHealthCompany`, `homeHealthNurse`, `referringPhysicianId`, `status`. New: coordinates, weekly schedule, field note, field status, care group, three provider assignments. |
| 5 | Geocoding pipeline | Must | Partly have | `src/lib/address-validator.ts` already gets coordinates from the Census geocoder and discards them. Keep them. New `geocode` job in `JOBS`; geocode on patient and provider save; Google as optional provider. Surface on the **Geocoding** tab or Automation runs. |
| 6 | Patient board grid | Must | New page, existing patterns | **Field board** tab. The Gateway's PCC "Patient care board" (`CareStatusControl`) is a close cousin and should share the status list. |
| 7 | Filters and paging | Must | Pattern exists | URL search params as `/schedule` does today (`providerId`, `locationId`, `visitType`, `showMissed`, `filter`); Prisma `distinct` for dropdowns; Prisma cursor paging. |
| 8 | Provider assignment NP / LPN / MA | Must | Have the shape | Three nullable FKs on `Patient` to `RenderingProvider` for board and map speed, mirrored into `CareTeamMember` so the chart's care team shows them. Bulk assign on the Field board. The **Physician** filter on the calendar maps to the NP. |
| 9 | Providers and titles | Must | Have | `RenderingProvider` has name, `credential`, `title`, `npi`, address, `userId`. Add coordinates and `titleCode`. Title styles live in Scheduler admin → Field routes. |
| 10 | Maps | Must | New | **Maps** tab: `RouteMap` + `RouteMapMember`. PROVIDER maps bind to a `RenderingProvider` whose home is the route origin; GENERAL maps use first and last stop. |
| 11 | Map canvas | Must | New, largest piece | One client component used by both the **Map** view (visits in the date range) and the **Maps** tab (all geocoded patients). Pins by status or per-map colour, provider markers, filter panel, layers, group overlays, regions, places search, info window with **Book visit** and **Add to route**. |
| 12 | Routes and stops | Must | New | **Routes** tab: `Route` (mapId, providerId, visitDate, visitTypeCode, label, note, config JSON) and `RouteStop` (routeId, patientId, index, note, appointmentId). Reorder by drag = one bulk index action. Directions behind `src/lib/gis/directions.ts`. **Book visits** creates date-only appointments of the route's field type through the existing booking action; the overlap conflict check is skipped, eligibility runs. |
| 13 | Patient groups | Should | New | **Groups** tab: `FieldGroup`, `FieldGroupPatient`, `FieldGroupMember`. Add from Field board selection or the map. |
| 14 | Provider groups | Should | New | `FieldGroupProvider`; the group's patients are a query over the three assignment columns. |
| 15 | Pin colours per map | Should | New | `RouteMapPinStyle` (mapId, patientId, colour), upsert. |
| 16 | Regions | Should | New | `RouteMapRegion` with GeoJSON polygons, drawn on the canvas, toggled per map. |
| 17 | Secure share links | Should | Pattern exists | `RouteShareLink` (codeHash, routeIds, expiresAt, maxAccess, accessCount, createdById). Public `/r/[code]` page: addresses only, no names. Admin list on the **Share links** tab. Audit creation and every open. |
| 18 | Excel export | Should | Partly have | Column picker + `toCsv` today; `exceljs` for the styled header. Audit row with the filters used. |
| 19 | Activity log | Should | Have | `logAudit` from every action with `entityType` `RouteMap`, `Route`, `RouteStop`, `FieldGroup`, `RouteShareLink`. |
| 20 | Notifications | Should | Partly have | No per-user inbox yet (`SystemMessage` banners, `Task`, `PatientMessage` exist). Add `Notification` + `UserNotification` with a bell in `AppShell` for "map shared with you", "geocoding finished", "route link opened", "route visits booked". |
| 21 | User management | Should | Have | Settings → Users & roles covers it. Only `allowedStates` would be new. |
| 22 | Automation schedules | Nice | Have (static registry) | The `geocode` job in `JOBS`; skip the schedule editor. |
| 23 | IP access control | Nice | Partly have | `Organization.ipAllowlist` at login. Per-request STRICT mode only if exposed outside the office. |
| 24 | Server log viewer | Nice | Skip | Host logs. |
| 25 | FAQs and docs | Nice | Partly have | Settings → Documentation. |
| 26 | Settings page | Nice | Have | Field settings go under Scheduler admin. |
| 27 | Realtime role refresh | Nice | Have for free | Membership re-read per request. |
| 28 | SCIM | Skip | Skip | Non-working stub in the source. |
| 29 | Keep-alive worker | Skip | Skip | Hosting workaround. |

## 7. Proposed data model additions

All new tables carry `practiceId` with cascade delete, following every other CareHub model.

- `VisitType`: `fieldVisit Boolean @default(true)`, seeded `false` for `RECORDS`, `COMM_LOG`, `DATA_ENTRY`, `PROVIDER_ORDERS`, `PCM`, `TELE_INIT`, `TELE_EST`, `TELE`.
- `Appointment`: `allDay Boolean @default(false)` and `routeStopId String? @unique` (section 4).
- `Patient`: `latitude Float?`, `longitude Float?`, `geocodedAt DateTime?`, `geocodeSource String?`, `geocodeError String?`, `weeklySchedule String?` (JSON weekdays), `fieldNote String?` (500 chars, rejected when too long), `fieldStatus String?`, `careGroup String?`, `npProviderId`, `lpnProviderId`, `maProviderId` (FKs to `RenderingProvider`, `onDelete: SetNull`).
- `RenderingProvider`: `latitude`, `longitude`, `geocodedAt`, `titleCode String?`.
- `SchedulerSettings`: `showMapView Boolean`, `fieldRoutesEnabled Boolean`, `mapProvider String` (OPEN | GOOGLE), `fieldStatuses String` (JSON list), `providerTitleStyles String` (JSON), `shareLinkDays Int @default(14)`, `shareLinkMaxOpens Int @default(100)`.
- New: `RouteMap`, `RouteMapMember`, `RouteMapRegion`, `RouteMapPinStyle`, `Route`, `RouteStop`, `FieldGroup`, `FieldGroupMember`, `FieldGroupPatient`, `FieldGroupProvider`, `RouteShareLink`, `Notification`, `UserNotification`.

Indexes to plan for: `Patient(practiceId, state)`, `Patient(practiceId, latitude, longitude)`, the three provider FKs, `RouteStop(routeId, index)`, `Route(practiceId, visitDate)`, `RouteShareLink(codeHash)`.

## 8. Provider seam and cost

Follow the clearinghouse pattern: `src/lib/gis/index.ts` exports `geocode(address)`, `directions(origin, stops, destination, options)` and a client map adapter, chosen by `SchedulerSettings.mapProvider` and environment variables.

| Capability | Free default | Paid option | Note |
| --- | --- | --- | --- |
| Geocoding | US Census geocoder (already wired, no key) | Google Geocoding | Census is US-only and slower; fine for a background job. Cache by normalised address. |
| Map tiles and canvas | MapLibre GL + OpenStreetMap tiles | Google Maps JavaScript | Places Autocomplete and Street View exist only on Google. |
| Directions and waypoint optimisation | OSRM or OpenRouteService | Google Directions | OSRM's `trip` service approximates Google's optimiser. |

A Google key, when used, is restricted by HTTP referrer in Google Cloud and passed from a server component. The spec's AES wrapping of the key adds no security.

## 9. Suggested build order (to be revised)

Status 19 Oct 2026: steps 1 to 7 are built on branch `carehub-telehealth-scheduler` (migrations `20261116090000_field_visits_gis_base`, `20261116100000_scheduler_map_view`, `20261116110000_field_board_routes`, `20261116120000_route_maps`; uncommitted). Permission keys: `schedule.routes.view`, `schedule.routes.edit`, `schedule.field.assign`. Not built: groups, regions, share links, notifications, `.xlsx` export.

1. **Schema, permissions, settings** (done, minus keys and settings): `VisitType.fieldVisit`, `Appointment.allDay`, coordinates on `Patient` and `RenderingProvider`; Field visit column in Scheduler admin → Visit types.
2. **Date-only booking for field types** (done): the booking panel switches to a date picker for field types, visits store as local midnight to end of day, the calendar prints "Field visit" instead of a time, the overlap and hours checks are skipped, auto check-in skips them, reminders and confirmation pages print the date only.
3. **Geocoding job** (done): the Census call keeps coordinates, `geocode` job every 10 minutes with "Run now" in Automation runs, coordinates cleared when a patient or provider address changes, failures recorded with a reason and retried after a week. `GOOGLE_MAPS_API_KEY` switches to Google Geocoding.
4. **Map view on the calendar** (done): the **Map** tab beside Capacity (switch in Scheduler admin → General), plotting the week's field visits at the patient's coordinates with the calendar's filters and colour mode, physician home bases, popups linking to the chart, and a list of field visits that have no pin yet. Built on MapLibre GL with OpenStreetMap tiles (`maplibre-gl` dependency, no key); Google Maps can replace the style behind the same component. Seed patients now carry real street addresses so the demo map has pins.
5. **Field board** (done, except export): `/schedule/routes?tab=board` with search, state, county, ZIP, status, NP / LPN / MA, schedule-day and map-pin filters, 100 rows a page, inline status and assignment pills, a per-row schedule, care group and note form, bulk assign and bulk **Add to route**, **Geocode now** per patient. CSV export still to do.
6. **Maps and canvas** (done 19 Oct): `RouteMap` boards with members and roles, per-map pin colours, saved centre; a route may belong to a board (its form has a Map board select) or stay loose. Migration `20261116120000_route_maps`.
7. **Routes** (done): `/schedule/routes?tab=routes` with `Route` (provider, date, field visit type, label, colour) and `RouteStop` (integer order, note, appointment). Stops come from the patient picker, the board's bulk action, or **Add to route** on a calendar row. Drag the letter or use the arrows to reorder (whole order saved in one bulk update, audited). **Get directions** and **Optimise order** through `src/lib/gis/directions.ts` (OSRM public server by default, Google Directions with a key), drive drawn on the map from and back to the provider's geocoded home base with per-leg miles and minutes. **Book visits** creates date-only field visits (place of service 12) with an eligibility check; the calendar row then shows "Route · label · stop n of m".
8. **Groups, pin colours, regions**.
9. **Share links and the public viewer**.
10. **Notifications inbox** and `.xlsx` export polish.

Steps 1 to 3 and 5 need no mapping provider decision. Step 4 onward needs tiles; step 7 needs directions.

## 10. PersonicGIS map workflow, step by step, in CareHub terms

Taken from a read of the PersonicGIS backend and built bundle (17 Oct 2026). "Now" is what CareHub does today on this branch; "Planned" is the routes work still to build.

| PersonicGIS step | Now in CareHub | Planned for routes |
| --- | --- | --- |
| **1. Patients arrive by Databricks, Conduit or chunk upload, upsert by MRN; address change clears coordinates** | Not needed. Patients are registered or imported into CareHub itself. `updatePatient` clears the coordinates when street, city, state or ZIP changes (`addressChanged` in `src/lib/geocode.ts`). | Nothing more. |
| **1b. Geocoding after each sync, one Google call per address into `coordination`** | The `geocode` job (every 10 minutes, Run now in Automation runs) geocodes every patient and provider with an address and no coordinates through the Census geocoder, Google when `GOOGLE_MAPS_API_KEY` is set. Failures keep a reason and retry after a week. A patient without coordinates never gets a pin; the Map view lists them under the map. | Field board gets a Re-geocode action per patient. |
| **2. Map = saved board (PROVIDER or GENERAL, state, centre, members OWNER/ADMIN/EDITOR/VIEWER)** | Done (19 Oct): **Maps** tab with `RouteMap` (label, PROVIDER or GENERAL, provider, saved centre and zoom, owner) and `RouteMapMember` (role). Share with a colleague as Admin, Editor or Viewer; change roles; remove; leave. `mapRoleFor` in `src/lib/route-maps.ts` guards every route and stop write on a map (Editor and above); routes on maps a user is not a member of are hidden from them. Loose routes without a map keep the practice-wide permission keys. | State is a filter, not a scope (section 3). |
| **2b. Visit = one route layer (date, label, colours, isOptimize)** | Nothing yet. | `Route` (mapId, providerId, visitDate, visitTypeCode, label, config JSON with markerColor, layerColor, layerTextColor, optimize). |
| **2c. VisitPatientRelation = waypoint with integer `index`** | Nothing yet. | `RouteStop` (routeId, patientId, index, note, appointmentId). The order is the integer, as in PersonicGIS. The `appointmentId` is the CareHub addition: a stop can be a real date-only field visit. |
| **2d. MapPatientStyle = per-map pin colour** | Done (19 Oct): `RouteMapPinStyle` set from the field board's bulk bar ("Colour pins on a map", or clear). The colour wins over the route colour on the map board, the route page and its patient layer. | Group colour waits for groups. |
| **3. Opening a map: one call returns map, nurse with home location, visits with sorted waypoints; origin and destination from the nurse's home (PROVIDER) or first and last stop (GENERAL); centre saved on pan** | Done (19 Oct): the Maps tab loads the board with every route, its stops in order and its directions in one query, and draws them all in their colours with the provider's home base. The map opens where it was left; panning saves the centre and zoom a second after the move, for Editors and above. | |
| **4. Patient pins from the sidebar: load all state patients with coordinates and styles, filter by zip, county, provider, group, status, search; "add to layer" from the info window** | Done (17 Oct): **Show patients on the map** on a route adds every geocoded patient matching the board's filters as grey pins; the popup has **Add to route** (server action from the pin) and **Book a visit**. | Group filter waits for groups. |
| **5. Route drawing: Directions per layer, waypoints passed as address strings, optimizeWaypoints from the layer flag, cached per input set, custom polylines and lettered markers, per-leg distance and duration** | Nothing yet. | Same shape behind `src/lib/gis/directions.ts`: Google Directions when a key exists, else OSRM. Difference: stops are sent as stored lat/lng, not address strings, so the router never re-resolves an address differently from the geocoder. One request per route, cached by a key of origin, destination, stop ids and the optimize flag. |
| **6. Changing a route: create and edit layer, add stop at the end, remove stop, temporary raw address, optimize rewrites stored order** | Nothing yet. | Server actions on the Routes tab for each. Optimize writes the returned order back with one bulk index update, as PersonicGIS does. The never-saved raw-address stop is dropped: a stop is always a patient. |
| **7. Drag and drop: dnd-kit with sidebar cards, sortable stops, droppable layer headers; same-layer reorder sends a bulk index update; cross-layer move reindexes only the moved stop** | Done (17 Oct) with native HTML drag and drop, no dnd-kit: drag a stop's letter within the route to reorder (whole order saved), or onto another route listed under the stops to move it; a **Move to…** select does the same without dragging. A move reindexes both routes in full and clears both routes' directions. A booked stop moves with its visit only when "move the booked visit too" is ticked; the visit takes the target route's date and provider. | Dragging a patient card from the board onto a route is not built; the board's bulk **Add to route** covers it. |
| **8. Permissions and audit: writes need OWNER/ADMIN/EDITOR; map, visit and waypoint creates and updates logged; reorders not logged** | Permission keys and `logAudit` exist; nothing GIS-specific yet. | `schedule.routes.*` keys plus the per-map role. Every write, including reorders and moves, goes through `logAudit` with before and after order in `detail`. |

## 11. Defects in PersonicGIS not to carry over

- Notes over 500 characters saved as `false`: validate with zod and return an error.
- Regions endpoint referenced an undefined database handle: regions are a normal Prisma table here.
- Group notification queries used wrong column names: Prisma relations, no hand-written SQL.
- Bulk state creation notified user id 1: no hard-coded recipients.
- Map-share notification printed the raw role name: format the message.
- JWT and user cookies not httpOnly: CareHub's session cookie already is.

## 12. Open questions

- Does one practice cover several states with people who must be limited to some of them? Decides whether `Membership.allowedStates` is needed.
- Is a Google Maps billing account available, or does the first version run on the free stack?
- Should **Book visits** from a route be the default, or should routes stay planning-only until a coordinator confirms? Booking creates real appointments that drive eligibility checks, reminders and the flow board.
- Existing timed field-type appointments: leave them as they are, or convert them to all-day in the migration?
- Online booking (`VisitType.onlineBooking`): patients pick a slot today. Should field types be excluded from online booking, or offer date-only online booking?
- Who owns the field status list (NP In Person Weekly, Telehealth Biweekly, SNF, Surveillance, UltraMist…): the Gateway care board, the Field board, or one shared `SchedulerSettings` list?
- Should **Field routes** appear in the Scheduler sub-navigation tabs, or only as a header button?
