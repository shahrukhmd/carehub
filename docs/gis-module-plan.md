# GIS module for CareHub (standalone)

Plan dated 20 Oct 2026, from *Personic GIS: Complete Workflow* (the 19 Oct meeting write-up with screenshots) and the decisions below. GIS is its own area of CareHub, not part of the scheduler. The earlier scheduler-integrated build was reverted; its research stays in `personicgis-in-carehub.md` for reference.

## Decisions

| Question | Decision |
| --- | --- |
| Map and directions provider | Free stack by default: MapLibre GL with OpenStreetMap tiles, OSRM routing. A Google key in GIS settings switches to Google Maps, Geocoding and Directions with turn-by-turn text. |
| Link to the calendar | Fully separate. Routes and stops never create appointments. Visit types, booking and the calendar are untouched. |
| Scope | The facility (practice) the user is signed into is the scope, as State was in PersonicGIS. State remains a filter on patients. |
| Field clinicians | CareHub's provider directory, type Clinician or Rendering. No separate GIS clinician table. Each gets a GIS title: NP, LPN, MA or Clinical Team. |
| Patient status | Driven by the Patient Gateway care board, which has the same columns as the PersonicGIS chips: Ready to schedule, Confirmed, Rescheduled, Active, Active Pt Hospitalized, Pending Discharge, Discharged, Unable to see, Unseen Pt Hospitalized. |
| Share page | Public link shows stop addresses **with patient names**, the route on the map and step-by-step legs. |
| Roles | PCC (the Scheduler role in CareHub) and Admin use GIS. Changed 21 Oct from the wider set. Clinicians are not GIS users; they receive share links. |

## Navigation

A **GIS** entry in the sidebar (Front office group) with tabs, mirroring PersonicGIS:

| PersonicGIS | CareHub page |
| --- | --- |
| My Map | `/gis` cards of maps the user belongs to, All / Owned / Shared, search, sort, Create new map |
| Map page | `/gis/maps/[id]` three panes: route panel, patient sidebar, map |
| Patients | `/gis/patients` board with filters, inline assignment, bulk update, export, Resolver |
| Clinician / Provider | `/gis/providers` directory providers of type Clinician or Rendering, with GIS title and home base |
| Groups | `/gis/groups` patient and provider groups, sharing, Add Patients dialog |
| Share | `/r/[code]` public, no login |
| Settings | `/gis/settings` name display format, map provider key, region overlays |

Permission keys: `gis.view` and `gis.edit` (Admin and Scheduler, the PCC role), `gis.admin` (Admin: settings, region upload). Map and group membership roles sit on top. Per-user overrides in Settings → Users & roles can still grant or refuse the keys for one person.

## Data model

All new tables carry `practiceId`. Names are prefixed `Gis`.

- **RenderingProvider** (existing) gains `gisTitle` (NP | LPN | MA | CLINICAL_TEAM), `latitude`, `longitude`, `geocodedAt`, `geocodeError`, `gisActive`. Home address is the existing directory address. Title carries marker icon and colour.
- **Patient** (existing) gains `fullAddress`, `latitude`, `longitude`, `geocodedAt`, `geocodeSource`, `geocodeError`, `weeklySchedule` (JSON weekdays), `gisNextVisit`, `gisNote` (500 chars, rejected when longer), `npProviderId`, `lpnProviderId`, `maProviderId` (to RenderingProvider). Status is not stored; it is read from the latest `IntakeCase` (stage and careStatus) through the Gateway's board columns. Home health and referral source come from existing fields.
- **GisMap**: label, mapType PROVIDER | GENERAL, providerId (PROVIDER), maskId `MAP-XXXXXXXX` for the URL, centerLat, centerLng, zoom, ownerId, deletedAt.
- **GisMapMember**: mapId, userId, role OWNER | ADMIN | EDITOR | VIEWER, addedById. Unique per map and user.
- **GisMapPinStyle**: mapId, patientId, color. Unique per map and patient.
- **GisMapRegion**: practiceId, name, geojson, active (county boundaries uploaded as KML or GeoJSON).
- **GisRoute** (layer): mapId, label, visitDate, note, markerColor, layerColor, layerTextColor, optimize, directions (cached JSON), createdById.
- **GisRouteStop**: routeId, patientId, index, note. Unique per route and patient. Order is the index.
- **GisGroup**: name, description, color, icon, groupType PATIENT | PROVIDER, visibility PRIVATE | SHARED, sortBy, showAge, active, ownerId.
- **GisGroupMember** (userId, role), **GisGroupPatient**, **GisGroupProvider** (renderingProviderId, title).
- **GisShareLink**: shortCode, tokenHash, mapId, routeIds JSON, origin, destination, mapType, expiresAt (14 days), maxAccess (100), accessCount, createdById, expiredAt.
- Audit through `logAudit` on every create, update, delete, reorder, move, share and link open.

## Services behind one seam (`src/lib/gis/`)

- **geocode.ts**: Census by default, Google with a key. Job every 10 minutes for patients and providers with an address and no coordinates, plus on-change clearing in the patient and provider save actions. Resolver page: list of unplaced patients, re-geocode selected, search candidates and pick one by hand.
- **directions.ts**: OSRM `route` and `trip` by default, Google Directions with a key (adds turn-by-turn steps). Stops go in as stored coordinates. Cached on the route, keyed on origin, destination, stop ids and the optimise flag.
- **map component**: MapLibre by default, Google Maps JavaScript when a key is set, same props: pins, lettered stops, lines, home marker, region overlays, saved view, pin actions.

## Screens

**Patients board.** Columns: name, notes, NP, Wound Tech (MA), Wound Nurse (LPN), home health provider, status (from Gateway), next visit, schedule, county, ZIP. Filters: status, next-visit range or blank, NP, LPN, MA, ZIP, county, home health, referral source, free text over name, MRN, address and DOB. Inline assignment dropdowns filtered by title. Bulk assign. Export chosen columns (CSV now, `.xlsx` with exceljs later). Resolver. Footer with last geocode run.

**Providers.** Directory providers of type Clinician or Rendering. Set GIS title and active flag; the address is edited in the directory. Shows geocode state; a provider without a geocoded home cannot own a PROVIDER map.

**My Map.** Cards with label, type, provider, member count, your role. Create: label plus provider or none.

**Map page.**
- Left: origin field (provider home, editable), Add Layer, Settings, share and menu. My Groups list plus quick filters: Providers/Clinicians, Main Patients, Nurse Practitioner, Wound Tech, Wound Nurse. One block per layer: show/hide, name, date, kebab (edit, delete, generate link), Optimize toggle, ordered stops with drag handles and delete, destination field.
- Middle: patient sidebar with count, refresh, clear, filter; search by name, status, ZIP or county with Both / Patient / County scope; rows with checkbox, drag handle, name, status badge. Ticking a row shows its pin; rows drag into layers.
- Right: pins coloured by per-map style, then group colour, then default. Info card with name, MRN, address, status, DOB and Add to layer. One route per visible layer in its colour with lettered stops and the home marker. Footer: selected layers, total miles, layer selector, Generate Link. Optional region overlays.
- Core loop: add layer, load patients, add stops by drag, pin or sidebar, redraw, reorder by drag (full reindex in one update), move between layers (both layers reindexed), optimise (order written back), delete.
- Drag and drop with dnd-kit: patient card draggable, stop sortable, layer header droppable.

**Share page.** Routes panel with date, stop count and numbered stops showing patient name and address, toggle per route; the map with lettered stops; Step-by-Step with total distance and time and per-leg instructions (Google) or per-leg distance and time (OSRM). Each open counts; expired or exhausted links return 410. Admin list of links with expire and delete.

**Groups.** List with type, visibility and status filters. Create dialog with Basic info, Appearance (colour, icon) and Preferences (sort, show age) and live preview. Add Patients dialog with status chips, search, multi-select table with NP, MA, LPN and home health columns. Share with a role. PROVIDER groups hold clinicians; loading one shows the patients assigned to them.

**Settings.** Patient name display format, Google key, region overlay upload, share link defaults.

**Notifications.** In-app inbox for "map shared with you", "geocoding finished", "link opened". Polled unread count in the app shell.

## Differences from PersonicGIS, on purpose

- Routing uses stored coordinates, not address strings.
- Moving a stop between layers reindexes both layers.
- Ad-hoc address stops are not kept in memory; a stop is always a patient.
- Reorders and moves are audited.
- Non-members get a clean refusal, not a server error.
- The map key is never sent to the browser in a response body; the Google key is restricted by referrer.

## Build order

Status 20 Oct 2026: step 1 built on branch `carehub-telehealth-scheduler` (migrations `20261116090000_gis_base`, `20261116091000_gis_settings`; uncommitted). Pages: `/gis`, `/gis/providers`, `/gis/resolver`, `/gis/settings`; `/gis/patients` and `/gis/groups` are placeholders until their steps.

1. **Schema, permission keys, sidebar entry, provider GIS fields, patient GIS fields, geocode job, Resolver** (done). `GisSettings` holds the Google key, name format and share link defaults. The job `gis-geocode` runs every 10 minutes; the Resolver re-runs it, lists candidates from the geocoder and accepts coordinates by hand.
2. **Patients board** (done 20 Oct): `/gis/patients` with free text (name, MRN, street, DOB), status, NP, LPN, MA, ZIP, county, state, home health, referral source, next-visit range or blank, schedule day and map-pin filters; inline NP, LPN and MA pills (matching title first); per-row note, next visit and weekly schedule; bulk assign on ticked rows; CSV export with chosen columns through `/api/gis/patients/export`, audited; status chip from the latest Gateway case with a link to it; last geocoding run in the footer.
3. **Providers page and My Map** (done 20 Oct): `GisMap`, `GisMapMember`, `GisMapPinStyle`, `GisRoute` and `GisRouteStop` tables (migration `20261116092000_gis_maps_routes`); `/gis` card list with All / Owned / Shared, search and sort, Create new map (PROVIDER with a field clinician, or GENERAL) with a `MAP-XXXXXXXX` mask id; `/gis/maps/[id]` shell with the clinician's home base on MapLibre and a centre saved as Editors pan; `/gis/maps/[id]/settings` with name, type, provider, members, share as Admin / Editor / Viewer, role change, remove, leave and Owner delete. Shared helpers in `src/lib/gis/guard.ts` and `src/lib/gis/maps.ts`; map canvas in `src/components/GisMapView.tsx` (`maplibre-gl`).
4. **Map page** (done 20 Oct): `/gis/maps/[id]` with three panes. Left: origin, Add layer (name, date, pin, layer and text colours), My Groups quick filters (Providers / Clinicians, Main Patients, Nurse Practitioner, Wound Tech, Wound Nurse), one block per layer with show/hide, edit and delete, Optimize toggle, lettered stops with per-leg miles and minutes, remove, Add selected, Redraw, Steps, destination. Middle: patient sidebar with count, refresh, clear, search by name, status, ZIP or county with Both / Patient / County scope, rows with a checkbox (pin on the map) and drag handle. Right: MapLibre with pins (per-map colour, then group colour, then default), one line per visible layer, lettered stops, the home marker, a footer with layers shown and total miles, and a step-by-step panel. Drag a row onto a layer or between stops to add; drag a stop within its layer to reorder, or onto another layer to move (both layers reindexed). Directions recompute after every stop change through `src/lib/gis/directions.ts` (OSRM, or Google with turn-by-turn when a key is set). Actions in `route-actions.ts` return results to the workspace client component (`src/components/GisWorkspace.tsx`).
5. **Share links and the public page** (done 20 Oct): `GisShareLink` (migration `20261116093000_gis_share_links`) keeps only a hash of the 10-character code plus a hint. **Generate link** in the map footer shares the ticked layers and shows the URL once with Copy and Open. `/r/[code]` opens without login in the patient-facing shell: a Routes panel with each layer's date, distance, numbered stops with patient name, address, phone and a Navigate link, a toggle per layer, the map with lettered stops and the drive, and a Step-by-Step panel per layer. Each open counts; expired or used-up links show a notice. `/gis/links` lists links with masked code, map and layers, creator, usage, expiry and state, with expire, delete and purge-expired. Link life and open cap come from GIS settings.
6. **Groups** (done 20 Oct): `GisGroup`, `GisGroupMember`, `GisGroupPatient`, `GisGroupProvider` (migration `20261116094000_gis_groups`). `/gis/groups` lists cards with type, visibility and status filters and search; Create new group with name, description, colour, icon, visibility, sort field, show age and type; a group page with Overview, Patients (or Clinicians), Members and Settings tabs; the Add Patients dialog with status chips, search and a multi-select table showing NP, MA, LPN and home health; remove selected; share by role; activate or deactivate on your maps; Owner delete. On the map page, My Groups lists the user's active, visible groups under the quick filters; loading one fills the sidebar with its patients (a PROVIDER group resolves to the patients assigned to its clinicians) and pins take the group colour.
7. **Settings, region overlays, notifications, Excel export** (done 20 Oct): `GisRegion` and `GisNotification` (migration `20261116095000_gis_regions_notifications`). GIS settings upload KML, KMZ or GeoJSON overlays (`src/lib/gis/kml.ts` converts KML; the repo's zip reader opens KMZ), list them, switch them on or off and remove them; active overlays draw on every map with a toggle in the left pane. Notifications go to the recipient when a map or group is shared, to the runner when a manual geocoding run finishes, and to a link's creator on its first open and when it is used up; the Notifications tab lists them with mark read, mark all read and clear read, and the GIS home shows the unread count. The patients board exports to Excel (`src/lib/gis/xlsx-write.ts`, a dependency-free .xlsx writer with a green bold header row) or CSV.
