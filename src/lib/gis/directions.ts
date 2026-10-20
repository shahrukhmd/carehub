import "server-only";
import { prisma } from "@/lib/prisma";
import { gisGoogleKey } from "@/lib/gis/settings";
import type { Directions, DirectionsLeg } from "@/lib/gis/shared";

// Driving directions behind one seam. OSRM's public demo server (no key) by default; Google Directions, with
// turn-by-turn steps, when the practice has a key. Stops go in as stored coordinates, never as address strings.

export type Point = { lat: number; lng: number };
const OSRM = process.env.OSRM_URL ?? "https://router.project-osrm.org";
const coords = (points: Point[]) => points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");

type Drive = Pick<Directions, "provider" | "geometry" | "legs" | "distanceM" | "durationS">;

export async function drive(practiceId: string, points: Point[]): Promise<Drive> {
  if (points.length < 2) throw new Error("A route needs at least two points");
  const key = await gisGoogleKey(practiceId);
  if (key) return google(key, points, false).then((r) => r.drive);
  const r = await fetch(`${OSRM}/route/v1/driving/${coords(points)}?overview=full&geometries=geojson&steps=true`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Routing service returned ${r.status}`);
  const d = (await r.json()) as { code: string; message?: string; routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs: { distance: number; duration: number; steps?: { distance: number; duration: number; name: string; maneuver: { type: string; modifier?: string } }[] }[] }[] };
  if (d.code !== "Ok" || !d.routes?.[0]) throw new Error(d.message ?? `Routing: ${d.code}`);
  const best = d.routes[0];
  const legs: DirectionsLeg[] = best.legs.map((l) => ({
    distanceM: l.distance,
    durationS: l.duration,
    steps: (l.steps ?? []).filter((s) => s.maneuver.type !== "arrive" || true).map((s) => ({ text: osrmStep(s), distanceM: s.distance, durationS: s.duration })),
  }));
  return { provider: "OSRM", geometry: best.geometry.coordinates, legs, distanceM: best.distance, durationS: best.duration };
}

function osrmStep(s: { name: string; maneuver: { type: string; modifier?: string } }) {
  const road = s.name ? ` onto ${s.name}` : "";
  const m = s.maneuver.modifier ? s.maneuver.modifier.replace(/ /g, " ") : "";
  switch (s.maneuver.type) {
    case "depart":
      return `Head ${m}${road}`.trim();
    case "arrive":
      return "Arrive at the stop";
    case "turn":
    case "end of road":
    case "fork":
      return `Turn ${m}${road}`;
    case "continue":
    case "new name":
      return `Continue${road}`;
    case "roundabout":
    case "rotary":
      return `Take the roundabout${road}`;
    case "merge":
      return `Merge ${m}${road}`;
    case "on ramp":
      return `Take the ramp ${m}${road}`;
    case "off ramp":
      return `Take the exit ${m}${road}`;
    default:
      return `${s.maneuver.type} ${m}${road}`.trim();
  }
}

// The best order to visit the middle points, keeping the first and last fixed. Returns indexes into `points`.
export async function optimize(practiceId: string, points: Point[]): Promise<number[]> {
  if (points.length < 4) return points.map((_, i) => i);
  const key = await gisGoogleKey(practiceId);
  if (key) return google(key, points, true).then((r) => r.order);
  const r = await fetch(`${OSRM}/trip/v1/driving/${coords(points)}?source=first&destination=last&roundtrip=false&overview=false`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Routing service returned ${r.status}`);
  const d = (await r.json()) as { code: string; message?: string; waypoints?: { waypoint_index: number }[] };
  if (d.code !== "Ok" || !d.waypoints) throw new Error(d.message ?? `Routing: ${d.code}`);
  const order = new Array<number>(points.length);
  d.waypoints.forEach((w, i) => (order[w.waypoint_index] = i));
  return order;
}

// ---- Google Directions ----
type GoogleResp = { status: string; error_message?: string; routes?: { overview_polyline: { points: string }; waypoint_order?: number[]; legs: { distance: { value: number }; duration: { value: number }; steps: { html_instructions: string; distance: { value: number }; duration: { value: number } }[] }[] }[] };

async function google(key: string, points: Point[], optimizeWaypoints: boolean): Promise<{ drive: Drive; order: number[] }> {
  const p = new URLSearchParams({ origin: `${points[0].lat},${points[0].lng}`, destination: `${points[points.length - 1].lat},${points[points.length - 1].lng}`, mode: "driving", key });
  const middle = points.slice(1, -1);
  if (middle.length) p.set("waypoints", `${optimizeWaypoints ? "optimize:true|" : ""}${middle.map((m) => `${m.lat},${m.lng}`).join("|")}`);
  const r = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${p}`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Google Directions returned ${r.status}`);
  const d = (await r.json()) as GoogleResp;
  if (d.status !== "OK" || !d.routes?.[0]) throw new Error(d.error_message ?? `Google Directions: ${d.status}`);
  const best = d.routes[0];
  const legs: DirectionsLeg[] = best.legs.map((l) => ({ distanceM: l.distance.value, durationS: l.duration.value, steps: l.steps.map((s) => ({ text: s.html_instructions.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), distanceM: s.distance.value, durationS: s.duration.value })) }));
  const order = [0, ...(best.waypoint_order ?? middle.map((_, i) => i)).map((i) => i + 1), points.length - 1];
  return { drive: { provider: "GOOGLE", geometry: decodePolyline(best.overview_polyline.points), legs, distanceM: legs.reduce((s, l) => s + l.distanceM, 0), durationS: legs.reduce((s, l) => s + l.durationS, 0) }, order };
}

// Google's encoded polyline -> [lng, lat] pairs.
function decodePolyline(s: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  while (i < s.length) {
    for (const which of ["lat", "lng"] as const) {
      let shift = 0;
      let result = 0;
      let b: number;
      do {
        b = s.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === "lat") lat += delta;
      else lng += delta;
    }
    out.push([lng / 1e5, lat / 1e5]);
  }
  return out;
}

// ---- Route layers: the drive and its stored directions ----

async function routeWithStops(routeId: string) {
  return prisma.gisRoute.findUnique({ where: { id: routeId }, include: { map: { include: { provider: true } }, stops: { orderBy: { index: "asc" }, include: { patient: { select: { id: true, latitude: true, longitude: true } } } } } });
}

// Points for a layer: the clinician's home base -> placed stops -> home base. The start and end of every drive is
// the map's provider address; without a geocoded home base there are no directions.
function drivePoints(r: NonNullable<Awaited<ReturnType<typeof routeWithStops>>>) {
  const placed = r.stops.filter((s) => s.patient.latitude != null && s.patient.longitude != null);
  const home: Point | null = r.map.provider?.latitude != null && r.map.provider?.longitude != null ? { lat: r.map.provider.latitude, lng: r.map.provider.longitude } : null;
  const stopPoints = placed.map((s) => ({ lat: s.patient.latitude!, lng: s.patient.longitude! }));
  return { placed, home, points: home && stopPoints.length ? [home, ...stopPoints, home] : [] };
}

// Recomputes and stores a layer's directions (called after every stop change). Returns null when there is nothing
// to route yet; never throws for routing failures (the layer keeps no directions and the UI says so).
export async function refreshDirections(routeId: string): Promise<Directions | null> {
  const r = await routeWithStops(routeId);
  if (!r) return null;
  const { placed, home, points } = drivePoints(r);
  if (points.length < 2) {
    await prisma.gisRoute.update({ where: { id: r.id }, data: { directions: null } });
    return null;
  }
  try {
    const d = await drive(r.map.practiceId, points);
    const directions: Directions = { ...d, computedAt: new Date().toISOString(), stopIds: placed.map((s) => s.id), fromHome: Boolean(home) };
    await prisma.gisRoute.update({ where: { id: r.id }, data: { directions: JSON.stringify(directions) } });
    return directions;
  } catch (err) {
    console.error("[gis] directions failed", err);
    await prisma.gisRoute.update({ where: { id: r.id }, data: { directions: null } });
    return null;
  }
}

// The best stop order for a layer (first and last fixed on a GENERAL map), written back as the new indexes.
export async function optimizeRouteOrder(routeId: string) {
  const r = await routeWithStops(routeId);
  if (!r) throw new Error("Route not found");
  const { placed, home, points } = drivePoints(r);
  if (placed.length < 3) return r.stops.map((s) => s.id);
  const order = await optimize(r.map.practiceId, points);
  if (!home) throw new Error("The map's clinician has no geocoded home address yet");
  const placedOrder = order.filter((i) => i > 0 && i < points.length - 1).map((i) => placed[i - 1].id);
  const unplaced = r.stops.filter((s) => !placed.some((p) => p.id === s.id)).map((s) => s.id);
  const ids = [...placedOrder, ...unplaced];
  await prisma.$transaction(ids.map((id, index) => prisma.gisRouteStop.update({ where: { id }, data: { index } })));
  return ids;
}
