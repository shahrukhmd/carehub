"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { atLeast, mapRoleFor } from "@/lib/gis/maps";
import { optimizeRouteOrder, refreshDirections } from "@/lib/gis/directions";

// Route layers and stops on a map board. Called from the map workspace (client), so these return a result instead
// of redirecting; the workspace refreshes the page after each one. Every write needs the Editor role on the map
// and is audited. Directions are recomputed after every stop change so the line redraws at once.

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };
const fail = (error: string): ActionResult => ({ ok: false, error });
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const color = (v: string, fallback: string) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback);

type Actor = Awaited<ReturnType<typeof requireUser>>;
type MapRef = { id: string; label: string; mapType: string; practiceId: string };
type Gate = { ok: true; user: Actor; map: MapRef } | { ok: false; error: string };
type RouteRow = NonNullable<Awaited<ReturnType<typeof loadRoute>>>;
type RouteGate = { ok: true; user: Actor; map: MapRef; route: RouteRow } | { ok: false; error: string };

async function editor(mapId: string): Promise<Gate> {
  const user = await requireUser();
  if (!can(user, "gis.edit")) return { ok: false, error: "You don't have GIS edit rights" };
  const map = await prisma.gisMap.findFirst({ where: { id: mapId, practiceId: user.practiceId, deletedAt: null }, select: { id: true, label: true, mapType: true, practiceId: true } });
  if (!map) return { ok: false, error: "Map not found" };
  const role = await mapRoleFor(user.id, map.id);
  if (!atLeast(role, "EDITOR")) return { ok: false, error: "Viewers can look but not change this map. Ask the owner for the Editor role." };
  return { ok: true, user, map };
}

const loadRoute = (routeId: string) => prisma.gisRoute.findUnique({ where: { id: routeId }, include: { stops: { orderBy: { index: "asc" } } } });

async function ownRoute(routeId: string): Promise<RouteGate> {
  const r = await loadRoute(routeId);
  if (!r) return { ok: false, error: "Layer not found" };
  const e = await editor(r.mapId);
  if (!e.ok) return e;
  return { ...e, route: r };
}

const done = (mapId: string) => revalidatePath(`/gis/maps/${mapId}`);

export async function createLayer(mapId: string, fd: FormData): Promise<ActionResult> {
  const e = await editor(mapId);
  if (!e.ok) return fail(e.error);
  const label = str(fd, "label").slice(0, 80);
  if (!label) return fail("Name the layer");
  const date = str(fd, "visitDate");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("Pick the visit date");
  const r = await prisma.gisRoute.create({
    data: { mapId, label, visitDate: new Date(`${date}T00:00:00`), note: str(fd, "note").slice(0, 300) || null, markerColor: color(str(fd, "markerColor"), "#2563eb"), layerColor: color(str(fd, "layerColor"), "#dbeafe"), layerTextColor: color(str(fd, "layerTextColor"), "#1e3a8a"), createdById: e.user.id },
  });
  await logAudit(e.user.practiceId, e.user.id, "GIS_LAYER_CREATE", "GisRoute", r.id, `${label} · ${date} · map ${mapId}`);
  done(mapId);
  return { ok: true, message: `Layer "${label}" added` };
}

export async function updateLayer(routeId: string, fd: FormData): Promise<ActionResult> {
  const o = await ownRoute(routeId);
  if (!o.ok) return fail(o.error);
  const date = str(fd, "visitDate");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("Pick the visit date");
  const data = {
    label: str(fd, "label").slice(0, 80) || o.route.label,
    visitDate: date ? new Date(`${date}T00:00:00`) : o.route.visitDate,
    note: str(fd, "note").slice(0, 300) || null,
    markerColor: color(str(fd, "markerColor"), o.route.markerColor),
    layerColor: color(str(fd, "layerColor"), o.route.layerColor),
    layerTextColor: color(str(fd, "layerTextColor"), o.route.layerTextColor),
  };
  await prisma.gisRoute.update({ where: { id: routeId }, data });
  await logAudit(o.user.practiceId, o.user.id, "GIS_LAYER_UPDATE", "GisRoute", routeId, JSON.stringify({ before: { label: o.route.label, visitDate: o.route.visitDate, note: o.route.note }, after: data }).slice(0, 1000));
  done(o.map.id);
  return { ok: true, message: "Layer saved" };
}

export async function deleteLayer(routeId: string): Promise<ActionResult> {
  const o = await ownRoute(routeId);
  if (!o.ok) return fail(o.error);
  await prisma.gisRoute.delete({ where: { id: routeId } });
  await logAudit(o.user.practiceId, o.user.id, "GIS_LAYER_DELETE", "GisRoute", routeId, `${o.route.label} · ${o.route.stops.length} stops`);
  done(o.map.id);
  return { ok: true, message: `Layer "${o.route.label}" deleted` };
}

// Appends patients to a layer at a position (end by default), skipping ones already on it.
export async function addStops(routeId: string, patientIds: string[], at?: number): Promise<ActionResult> {
  const o = await ownRoute(routeId);
  if (!o.ok) return fail(o.error);
  const ids = [...new Set(patientIds.filter((id) => /^[a-z0-9]{10,40}$/.test(id)))];
  const patients = await prisma.patient.findMany({ where: { id: { in: ids }, practiceId: o.user.practiceId }, select: { id: true } });
  const have = new Set(o.route.stops.map((s) => s.patientId));
  const fresh = ids.filter((id) => !have.has(id) && patients.some((p) => p.id === id));
  if (!fresh.length) return fail(ids.length === 1 && have.has(ids[0]) ? "Patient with this MRN already exists on the layer" : "Nothing to add");
  const existing = o.route.stops.map((s) => s.id);
  const pos = at != null && at >= 0 && at <= existing.length ? at : existing.length;
  await prisma.$transaction(async (tx) => {
    const created: string[] = [];
    for (const patientId of fresh) created.push((await tx.gisRouteStop.create({ data: { routeId, patientId, index: 10_000 + created.length } })).id);
    const order = [...existing.slice(0, pos), ...created, ...existing.slice(pos)];
    for (const [index, id] of order.entries()) await tx.gisRouteStop.update({ where: { id }, data: { index } });
  });
  await logAudit(o.user.practiceId, o.user.id, "GIS_STOP_ADD", "GisRoute", routeId, `${fresh.join(",")} at ${pos}`);
  await refreshDirections(routeId);
  done(o.map.id);
  return { ok: true, message: `${fresh.length} stop${fresh.length === 1 ? "" : "s"} added` };
}

export async function removeStop(stopId: string): Promise<ActionResult> {
  const stop = await prisma.gisRouteStop.findUnique({ where: { id: stopId } });
  if (!stop) return fail("Stop not found");
  const o = await ownRoute(stop.routeId);
  if (!o.ok) return fail(o.error);
  await prisma.$transaction(async (tx) => {
    await tx.gisRouteStop.delete({ where: { id: stopId } });
    const rest = await tx.gisRouteStop.findMany({ where: { routeId: stop.routeId }, orderBy: { index: "asc" } });
    for (const [i, s] of rest.entries()) if (s.index !== i) await tx.gisRouteStop.update({ where: { id: s.id }, data: { index: i } });
  });
  await logAudit(o.user.practiceId, o.user.id, "GIS_STOP_REMOVE", "GisRoute", stop.routeId, `patient ${stop.patientId}`);
  await refreshDirections(stop.routeId);
  done(o.map.id);
  return { ok: true };
}

// Writes the whole new order of a layer in one go, so the stored order always matches the screen.
export async function reorderStops(routeId: string, orderedIds: string[]): Promise<ActionResult> {
  const o = await ownRoute(routeId);
  if (!o.ok) return fail(o.error);
  const ids = o.route.stops.map((s) => s.id);
  if (orderedIds.length !== ids.length || orderedIds.some((id) => !ids.includes(id))) return fail("The layer changed while you were dragging; reload and try again");
  await prisma.$transaction(orderedIds.map((id, index) => prisma.gisRouteStop.update({ where: { id }, data: { index } })));
  await logAudit(o.user.practiceId, o.user.id, "GIS_STOP_REORDER", "GisRoute", routeId, `${ids.join(",")} -> ${orderedIds.join(",")}`.slice(0, 2000));
  await refreshDirections(routeId);
  done(o.map.id);
  return { ok: true };
}

// Moves a stop to another layer at a position. Both layers are reindexed in full (the PersonicGIS defect fixed).
export async function moveStop(stopId: string, targetRouteId: string, at?: number): Promise<ActionResult> {
  const stop = await prisma.gisRouteStop.findUnique({ where: { id: stopId } });
  if (!stop) return fail("Stop not found");
  if (stop.routeId === targetRouteId) return fail("That is the stop's own layer");
  const [src, dst] = await Promise.all([ownRoute(stop.routeId), ownRoute(targetRouteId)]);
  if (!src.ok) return fail(src.error);
  if (!dst.ok) return fail(dst.error);
  if (src.map.id !== dst.map.id) return fail("Layers must be on the same map");
  if (dst.route.stops.some((s) => s.patientId === stop.patientId)) return fail("Patient with this MRN already exists on that layer");
  const rest = dst.route.stops.map((s) => s.id);
  const pos = at != null && at >= 0 && at <= rest.length ? at : rest.length;
  const order = [...rest.slice(0, pos), stop.id, ...rest.slice(pos)];
  await prisma.$transaction(async (tx) => {
    await tx.gisRouteStop.update({ where: { id: stop.id }, data: { routeId: targetRouteId, index: 10_000 } });
    const source = await tx.gisRouteStop.findMany({ where: { routeId: stop.routeId }, orderBy: { index: "asc" } });
    for (const [i, s] of source.entries()) await tx.gisRouteStop.update({ where: { id: s.id }, data: { index: i } });
    for (const [i, id] of order.entries()) await tx.gisRouteStop.update({ where: { id }, data: { index: i } });
  });
  await logAudit(src.user.practiceId, src.user.id, "GIS_STOP_MOVE", "GisRoute", targetRouteId, `stop ${stop.id} from ${stop.routeId} to index ${pos}`);
  await Promise.all([refreshDirections(stop.routeId), refreshDirections(targetRouteId)]);
  done(src.map.id);
  return { ok: true, message: `Moved to "${dst.route.label}"` };
}

export async function updateStopNote(stopId: string, note: string): Promise<ActionResult> {
  const stop = await prisma.gisRouteStop.findUnique({ where: { id: stopId } });
  if (!stop) return fail("Stop not found");
  const o = await ownRoute(stop.routeId);
  if (!o.ok) return fail(o.error);
  await prisma.gisRouteStop.update({ where: { id: stopId }, data: { note: note.trim().slice(0, 300) || null } });
  done(o.map.id);
  return { ok: true };
}

// Optimize toggle: on = reorder for the shortest drive (order is written back, as in PersonicGIS); off = keep
// the order as it is. Either way the directions are refreshed.
export async function setOptimize(routeId: string, on: boolean): Promise<ActionResult> {
  const o = await ownRoute(routeId);
  if (!o.ok) return fail(o.error);
  await prisma.gisRoute.update({ where: { id: routeId }, data: { optimize: on } });
  if (on) {
    try {
      const ids = await optimizeRouteOrder(routeId);
      await logAudit(o.user.practiceId, o.user.id, "GIS_STOP_REORDER", "GisRoute", routeId, `optimise -> ${ids.join(",")}`.slice(0, 2000));
    } catch (err) {
      done(o.map.id);
      return fail(err instanceof Error ? err.message : "Routing failed");
    }
  }
  await refreshDirections(routeId);
  done(o.map.id);
  return { ok: true, message: on ? "Stops reordered for the shortest drive" : "Optimise off" };
}

export async function redrawDirections(routeId: string): Promise<ActionResult> {
  const o = await ownRoute(routeId);
  if (!o.ok) return fail(o.error);
  const d = await refreshDirections(routeId);
  done(o.map.id);
  return d ? { ok: true, message: "Directions refreshed" } : fail("No directions: the layer needs at least two placed points (home base or stops with coordinates)");
}
