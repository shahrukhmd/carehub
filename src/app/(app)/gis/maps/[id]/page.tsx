import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { can, rolesFor } from "@/lib/permissions";
import { formatDate } from "@/lib/format";
import { toDateParam } from "@/lib/schedule";
import { atLeast, MAP_ROLE_LABEL, openMap } from "@/lib/gis/maps";
import { fullAddress } from "@/lib/gis/geocode";
import { gisStatusKey } from "@/lib/gis/board";
import { parseDirections, type Layer, type SidebarPatient } from "@/lib/gis/shared";
import { displayName, FIELD_PROVIDER_WHERE, getGisSettings, GIS_TITLE_COLOR, gisTitleLabel, type GisTitle } from "@/lib/gis/settings";
import { groupPatientIds, myGroups } from "@/lib/gis/groups";
import { GisWorkspace } from "@/components/GisWorkspace";
import type { GisPin } from "@/components/GisMapView";
import { saveMapCenter } from "../../map-actions";
import { addStops, createLayer, deleteLayer, moveStop, redrawDirections, removeStop, reorderStops, setOptimize, updateLayer, updateStopNote } from "../../route-actions";
import { createShareLink } from "../../share-actions";

// Quick filters in the left pane (PersonicGIS "My Groups" provider-type filters). Saved groups join them in step 6.
const QUICK = [
  ["providers", "Providers / Clinicians"],
  ["main", "Main Patients"],
  ["np", "Nurse Practitioner"],
  ["ma", "Wound Tech"],
  ["lpn", "Wound Nurse (LPN)"],
] as const;
const QUICK_COLOR: Record<string, string> = { main: "#2563eb", np: "#2563eb", ma: "#d97706", lpn: "#16a34a", providers: "#111827" };

// The map page: route layers on the left, the patient sidebar in the middle, the map on the right.
export default async function GisMapPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string; load?: string }> }) {
  const user = await requireUser(rolesFor("gis.view"));
  const { id } = await params;
  const sp = await searchParams;
  const opened = await openMap(user.id, user.practiceId, id);
  if (!opened) notFound();
  const { map, role } = opened;
  const canEdit = can(user, "gis.edit") && atLeast(role, "EDITOR");
  const settings = await getGisSettings(user.practiceId);
  // My Groups: the user's active groups shown on their maps, plus the provider-type quick filters.
  const groups = (await myGroups(user.id, user.practiceId)).filter((g) => g.active && g.visibleOnMap);
  const groupLoad = sp.load?.startsWith("g:") ? groups.find((g) => g.id === sp.load!.slice(2)) ?? null : null;
  const load = groupLoad ? sp.load! : QUICK.some(([k]) => k === sp.load) ? sp.load! : null;

  // Home base and origin text.
  const prov = map.provider;
  const base: GisPin | null =
    map.mapType === "PROVIDER" && prov && prov.latitude != null && prov.longitude != null
      ? { id: prov.id, lat: prov.latitude, lng: prov.longitude, color: GIS_TITLE_COLOR[(prov.gisTitle as GisTitle) ?? "NP"] ?? "#111827", label: "⌂", title: prov.name, lines: [`${gisTitleLabel(prov.gisTitle)} · home base`, fullAddress(prov)] }
      : null;
  const origin = map.mapType === "PROVIDER" && prov ? `${prov.name} · ${fullAddress(prov) || "no address"}${prov.latitude == null ? " (not geocoded)" : ""}` : "First stop of each layer";

  // The sidebar: patients for the chosen quick filter. A PROVIDER map's role filters follow its clinician; a
  // GENERAL map's show every patient assigned in that role.
  const roleWhere = (field: "npProviderId" | "lpnProviderId" | "maProviderId") => (map.mapType === "PROVIDER" && map.providerId ? { [field]: map.providerId } : { [field]: { not: null } });
  const where = groupLoad ? { id: { in: await groupPatientIds(groupLoad.id) } } : load === "main" ? {} : load === "np" ? roleWhere("npProviderId") : load === "ma" ? roleWhere("maProviderId") : load === "lpn" ? roleWhere("lpnProviderId") : null;
  const patients: SidebarPatient[] =
    where && load !== "providers"
      ? (
          await prisma.patient.findMany({
            where: { practiceId: user.practiceId, status: "ACTIVE", ...where },
            include: { npProvider: { select: { name: true } }, lpnProvider: { select: { name: true } }, maProvider: { select: { name: true } }, intakeCases: { orderBy: { createdAt: "desc" }, take: 1, select: { stage: true, careStatus: true } } },
            orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
            take: 3000,
          })
        ).map((p) => ({ id: p.id, name: displayName(p, settings.nameFormat), mrn: p.mrn, address: fullAddress(p), statusKey: gisStatusKey(p.intakeCases[0]), zip: p.zip, county: p.county, lat: p.latitude, lng: p.longitude, dob: formatDate(p.dob), np: p.npProvider?.name ?? null, lpn: p.lpnProvider?.name ?? null, ma: p.maProvider?.name ?? null }))
      : [];
  // "Providers / Clinicians": the field clinicians' home bases as pins, listed in the sidebar as rows.
  const clinicianRows: SidebarPatient[] =
    load === "providers"
      ? (await prisma.renderingProvider.findMany({ where: { practiceId: user.practiceId, ...FIELD_PROVIDER_WHERE, gisActive: true, gisTitle: { not: null } }, orderBy: { name: "asc" } })).map((c) => ({ id: `c-${c.id}`, name: `${c.name} · ${gisTitleLabel(c.gisTitle)}`, mrn: c.credential ?? "", address: fullAddress(c), statusKey: "active", zip: c.zip, county: null, lat: c.latitude, lng: c.longitude, dob: "", np: null, lpn: null, ma: null }))
      : [];

  const layers: Layer[] = map.routes.map((r) => ({
    id: r.id,
    label: r.label,
    visitDate: toDateParam(r.visitDate),
    note: r.note,
    markerColor: r.markerColor,
    layerColor: r.layerColor,
    layerTextColor: r.layerTextColor,
    optimize: r.optimize,
    directions: parseDirections(r.directions),
    stops: r.stops.map((s) => ({ id: s.id, patientId: s.patientId, index: s.index, note: s.note, name: displayName(s.patient, settings.nameFormat), address: fullAddress(s.patient), lat: s.patient.latitude, lng: s.patient.longitude })),
  }));
  const pinStyles = Object.fromEntries(map.pinStyles.map((s) => [s.patientId, s.color]));
  const regions = (await prisma.gisRegion.findMany({ where: { practiceId: user.practiceId, active: true }, select: { id: true, color: true, geojson: true } })).map((r) => ({ id: r.id, color: r.color, geojson: JSON.parse(r.geojson) as GeoJSON.FeatureCollection }));
  const view = map.centerLat != null && map.centerLng != null ? { lat: map.centerLat, lng: map.centerLng, zoom: map.zoom ?? 10 } : null;

  return (
    <div className="gis-map-page">
      <div className="gis-map-head">
        <div>
          <p className="muted cn-small">
            <Link href="/gis">My maps</Link> · {map.maskId} · you are {MAP_ROLE_LABEL[role]}
            {map.mapType === "GENERAL" ? " · general map" : ""}
          </p>
          <h1>{map.label}</h1>
        </div>
        <Link className="btn ghost" href="/gis">
          ‹ Back
        </Link>
      </div>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.ok && (
        <p className="sc-closed" role="status">
          {sp.ok}
        </p>
      )}
      <GisWorkspace
        mapId={map.id}
        mapType={map.mapType}
        origin={origin}
        base={base}
        layers={layers}
        patients={load === "providers" ? clinicianRows : patients}
        loaded={groupLoad ? { key: load!, label: groupLoad.name, color: groupLoad.color } : load ? { key: load, label: QUICK.find(([k]) => k === load)![1], color: QUICK_COLOR[load] } : null}
        quickFilters={[
          ...QUICK.map(([k, label]) => ({ key: k, label, href: `/gis/maps/${map.id}?load=${k}`, active: k === load, color: QUICK_COLOR[k] })),
          ...groups.map((g) => ({ key: `g:${g.id}`, label: g.name, href: `/gis/maps/${map.id}?load=g:${g.id}`, active: load === `g:${g.id}`, color: g.color })),
        ]}
        pinStyles={pinStyles}
        view={view}
        canEdit={canEdit}
        todayParam={toDateParam(new Date())}
        regions={regions}
        actions={{ createLayer, updateLayer, deleteLayer, addStops, removeStop, reorderStops, moveStop, updateStopNote, setOptimize, redrawDirections, createShareLink, saveMapCenter: saveMapCenter.bind(null, map.id) }}
      />
    </div>
  );
}
