import { notFound } from "next/navigation";
import { openShareLink } from "@/lib/gis/share";
import { fullAddress } from "@/lib/gis/geocode";
import { parseDirections, type Layer } from "@/lib/gis/shared";
import { toDateParam } from "@/lib/schedule";
import { GIS_TITLE_COLOR, gisTitleLabel, type GisTitle } from "@/lib/gis/settings";
import { PortalShell } from "../../portal-shell";
import { SharedRoutes } from "./shared-routes";
import type { GisPin } from "@/components/GisMapView";

// The field clinician's view of a shared route, no login: the layers with their numbered stops, the map with the
// drive drawn, and step-by-step legs. Expired or used-up links show a short notice (HTTP 410).
export default async function SharedRoutePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const opened = await openShareLink(code);
  if (!opened) notFound();
  const { link, state, routes } = opened;
  const practice = link.map.practice;
  const brand = practice.connectSettings;
  if (state !== "ACTIVE") {
    return (
      <PortalShell brand={brand} fallbackName={practice.name}>
        <div className="pp-card pp-center">
          <h1>This route link is no longer available</h1>
          <p className="pp-muted">{state === "EXPIRED" ? "It has expired. Ask the coordinator for a new link." : "It has been opened the maximum number of times. Ask the coordinator for a new link."}</p>
        </div>
      </PortalShell>
    );
  }
  const prov = link.map.provider;
  // The drive starts and ends at the clinician's home address.
  const base: GisPin | null =
    prov && prov.latitude != null && prov.longitude != null
      ? { id: prov.id, lat: prov.latitude, lng: prov.longitude, color: GIS_TITLE_COLOR[(prov.gisTitle as GisTitle) ?? "NP"] ?? "#111827", label: "⌂", title: prov.name, lines: [`${gisTitleLabel(prov.gisTitle)} · start and end of the route`, fullAddress(prov)] }
      : null;
  const layers: Layer[] = routes.map((r) => ({
    id: r.id,
    label: r.label,
    visitDate: toDateParam(r.visitDate),
    note: r.note,
    markerColor: r.markerColor,
    layerColor: r.layerColor,
    layerTextColor: r.layerTextColor,
    optimize: r.optimize,
    directions: parseDirections(r.directions),
    stops: r.stops.map((s) => ({ id: s.id, patientId: s.patientId, index: s.index, note: s.note, name: `${s.patient.lastName}, ${s.patient.firstName}`, address: fullAddress(s.patient), lat: s.patient.latitude, lng: s.patient.longitude })),
  }));
  const phones = Object.fromEntries(routes.flatMap((r) => r.stops.map((s) => [s.id, s.patient.phone ?? ""])));
  return (
    <PortalShell brand={brand} fallbackName={practice.name} wide>
      <SharedRoutes mapLabel={link.map.label} origin={prov ? `${prov.name} · ${fullAddress(prov)}` : "the clinician's home address"} base={base} layers={layers} phones={phones} expires={toDateParam(link.expiresAt)} />
    </PortalShell>
  );
}
