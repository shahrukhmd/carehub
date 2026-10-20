"use server";

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { runJob } from "@/lib/jobs";
import { CLEAR_GEOCODE, geocodePatient, geocodeRenderingProvider } from "@/lib/gis/geocode";
import { FIELD_PROVIDER_WHERE, isGisTitle, NAME_FORMATS } from "@/lib/gis/settings";
import { fail, guarded, str } from "@/lib/gis/guard";
import { kmlToGeoJson, normalizeGeoJson } from "@/lib/gis/kml";
import { unzip } from "@/lib/xlsx-read";
import { notify } from "@/lib/gis/notify";

// ---- Settings ----

export async function saveGisSettings(fd: FormData) {
  return guarded("gis.admin", "/gis/settings", async (user) => {
    const nameFormat = str(fd, "nameFormat");
    if (!NAME_FORMATS.some(([k]) => k === nameFormat)) fail("Pick a name format");
    const days = Number(str(fd, "shareLinkDays"));
    const opens = Number(str(fd, "shareLinkMaxOpens"));
    if (!Number.isInteger(days) || days < 1 || days > 90) fail("Share links can live 1 to 90 days");
    if (!Number.isInteger(opens) || opens < 1 || opens > 10000) fail("Share link opens must be 1 to 10,000");
    const key = str(fd, "googleMapsKey");
    const keep = fd.get("keepKey") === "on";
    await prisma.gisSettings.upsert({
      where: { practiceId: user.practiceId },
      create: { practiceId: user.practiceId, nameFormat, shareLinkDays: days, shareLinkMaxOpens: opens, googleMapsKey: key || null },
      update: { nameFormat, shareLinkDays: days, shareLinkMaxOpens: opens, ...(keep ? {} : { googleMapsKey: key || null }) },
    });
    await logAudit(user.practiceId, user.id, "GIS_SETTINGS", "GisSettings", user.practiceId, `${nameFormat} · ${days} days · ${opens} opens · key ${keep ? "kept" : key ? "set" : "cleared"}`);
    return "GIS settings saved";
  });
}

// ---- Region overlays (KML, KMZ or GeoJSON) ----

export async function uploadRegion(fd: FormData) {
  return guarded("gis.admin", "/gis/settings", async (user) => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) fail("Choose a KML, KMZ or GeoJSON file");
    if (file.size > 8 * 1024 * 1024) fail("The file is over 8 MB");
    const bytes = Buffer.from(await file.arrayBuffer());
    const lower = file.name.toLowerCase();
    let fc;
    try {
      if (lower.endsWith(".kmz")) {
        const entries = unzip(bytes);
        const kml = [...entries.entries()].find(([n]) => n.toLowerCase().endsWith(".kml"));
        if (!kml) fail("The KMZ has no .kml inside");
        fc = kmlToGeoJson(kml![1].toString("utf8"));
      } else if (lower.endsWith(".kml")) fc = kmlToGeoJson(bytes.toString("utf8"));
      else fc = normalizeGeoJson(bytes.toString("utf8"));
    } catch (err) {
      fail(`Could not read the file: ${err instanceof Error ? err.message : "unknown error"}`);
    }
    if (!fc!.features.length) fail("No polygons or lines were found in the file");
    const name = str(fd, "name").slice(0, 80) || file.name.replace(/\.(kml|kmz|geojson|json)$/i, "");
    const color = /^#[0-9a-fA-F]{6}$/.test(str(fd, "color")) ? str(fd, "color").toLowerCase() : "#1f2937";
    const r = await prisma.gisRegion.create({ data: { practiceId: user.practiceId, name, geojson: JSON.stringify(fc), color, featureCount: fc!.features.length, createdById: user.id } });
    await logAudit(user.practiceId, user.id, "GIS_REGION_UPLOAD", "GisRegion", r.id, `${name} · ${fc!.features.length} features · ${file.name}`);
    return `Region "${name}" added with ${fc!.features.length} shape${fc!.features.length === 1 ? "" : "s"}`;
  });
}

export async function setRegionActive(regionId: string, fd: FormData) {
  return guarded("gis.admin", "/gis/settings", async (user) => {
    const r = await prisma.gisRegion.findFirst({ where: { id: regionId, practiceId: user.practiceId } });
    if (!r) fail("Region not found");
    const active = fd.get("active") === "on";
    await prisma.gisRegion.update({ where: { id: r!.id }, data: { active } });
    await logAudit(user.practiceId, user.id, "GIS_REGION_UPDATE", "GisRegion", r!.id, `active: ${active}`);
  });
}

export async function deleteRegion(regionId: string) {
  return guarded("gis.admin", "/gis/settings", async (user) => {
    const r = await prisma.gisRegion.findFirst({ where: { id: regionId, practiceId: user.practiceId } });
    if (!r) fail("Region not found");
    await prisma.gisRegion.delete({ where: { id: r!.id } });
    await logAudit(user.practiceId, user.id, "GIS_REGION_DELETE", "GisRegion", r!.id, r!.name);
    return `Region "${r!.name}" removed`;
  });
}

// ---- Notifications ----

export async function markNotificationsRead(fd: FormData) {
  return guarded("gis.view", "/gis/notifications", async (user) => {
    const ids = fd.getAll("ids").map(String);
    const r = await prisma.gisNotification.updateMany({ where: { userId: user.id, readAt: null, ...(ids.length ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
    return ids.length ? undefined : `${r.count} marked read`;
  });
}

export async function clearNotifications() {
  return guarded("gis.view", "/gis/notifications", async (user) => {
    const r = await prisma.gisNotification.deleteMany({ where: { userId: user.id, readAt: { not: null } } });
    return `${r.count} read notification${r.count === 1 ? "" : "s"} removed`;
  });
}

// ---- Clinicians (directory providers of type Clinician or Rendering) ----

export async function setProviderGis(providerId: string, fd: FormData) {
  return guarded("gis.edit", "/gis/providers", async (user) => {
    const p = await prisma.renderingProvider.findFirst({ where: { id: providerId, practiceId: user.practiceId, ...FIELD_PROVIDER_WHERE } });
    if (!p) fail("Provider not found");
    const data: { gisTitle?: string | null; gisActive?: boolean } = {};
    if (fd.has("gisTitle")) {
      const t = str(fd, "gisTitle");
      if (t && !isGisTitle(t)) fail("Unknown title");
      data.gisTitle = t || null;
    }
    if (fd.has("gisActiveSet")) data.gisActive = fd.get("gisActive") === "on";
    await prisma.renderingProvider.update({ where: { id: p.id }, data });
    await logAudit(user.practiceId, user.id, "GIS_PROVIDER_UPDATE", "RenderingProvider", p.id, JSON.stringify({ before: { gisTitle: p.gisTitle, gisActive: p.gisActive }, after: data }));
  });
}

export async function geocodeProviderNow(providerId: string) {
  return guarded("gis.edit", "/gis/providers", async (user) => {
    const p = await prisma.renderingProvider.findFirst({ where: { id: providerId, practiceId: user.practiceId } });
    if (!p) fail("Provider not found");
    const r = await geocodeRenderingProvider(p.id);
    if ("error" in r) fail(`${p.name}: ${r.error}`);
    return `${p.name} placed on the map (${r.source})`;
  });
}

// ---- Patients board ----

const FIELD_ROLES = { np: ["npProviderId", "NP"], lpn: ["lpnProviderId", "LPN"], ma: ["maProviderId", "MA"] } as const;
type FieldRole = keyof typeof FIELD_ROLES;
const isRole = (v: string): v is FieldRole => v in FIELD_ROLES;

async function fieldProvider(practiceId: string, role: FieldRole, id: string) {
  // Any active field clinician may be assigned; the dropdowns offer the matching title first.
  const p = await prisma.renderingProvider.findFirst({ where: { id, practiceId, ...FIELD_PROVIDER_WHERE, gisActive: true, gisTitle: { not: null } } });
  if (!p) fail("Pick a field clinician from the Clinicians page");
  return p!;
}

// One inline assignment dropdown (NP, LPN or MA) on a board row.
export async function setGisAssignment(patientId: string, fd: FormData) {
  const back = str(fd, "back") || "/gis/patients";
  return guarded("gis.edit", back, async (user) => {
    const p = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId } });
    if (!p) fail("Patient not found");
    const role = str(fd, "role");
    if (!isRole(role)) fail("Unknown assignment");
    const value = str(fd, "value");
    if (value) await fieldProvider(user.practiceId, role, value);
    const [field] = FIELD_ROLES[role];
    await prisma.patient.update({ where: { id: p.id }, data: { [field]: value || null } });
    await logAudit(user.practiceId, user.id, "GIS_ASSIGN", "Patient", p.id, `${role.toUpperCase()}: ${p[field] ?? "(blank)"} -> ${value || "(blank)"}`);
  });
}

// A row's schedule days, next visit and note.
export async function updateGisPatient(patientId: string, fd: FormData) {
  const back = str(fd, "back") || "/gis/patients";
  return guarded("gis.edit", back, async (user) => {
    const p = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId } });
    if (!p) fail("Patient not found");
    const note = str(fd, "gisNote");
    if (note.length > 500) fail("The note is limited to 500 characters");
    const days = fd.getAll("days").map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    const next = str(fd, "gisNextVisit");
    if (next && !/^\d{4}-\d{2}-\d{2}$/.test(next)) fail("Next visit must be a date");
    const data = { weeklySchedule: JSON.stringify(days), gisNextVisit: next ? new Date(`${next}T00:00:00`) : null, gisNote: note || null };
    await prisma.patient.update({ where: { id: p.id }, data });
    await logAudit(user.practiceId, user.id, "GIS_PATIENT_UPDATE", "Patient", p.id, JSON.stringify({ before: { weeklySchedule: p.weeklySchedule, gisNextVisit: p.gisNextVisit, gisNote: p.gisNote }, after: data }).slice(0, 2000));
    return `Saved ${p.lastName}, ${p.firstName}`;
  });
}

// Bulk: set or clear one assignment on every ticked patient.
export async function bulkGisAssign(fd: FormData) {
  const back = str(fd, "back") || "/gis/patients";
  return guarded("gis.edit", back, async (user) => {
    const ids = [...new Set(fd.getAll("ids").map(String).filter((id) => /^[a-z0-9]{10,40}$/.test(id)))];
    if (!ids.length) fail("Tick at least one patient first");
    const role = str(fd, "role");
    if (!isRole(role)) fail("Pick which assignment to set");
    const value = str(fd, "providerId");
    if (value) await fieldProvider(user.practiceId, role, value);
    const [field, label] = FIELD_ROLES[role];
    const r = await prisma.patient.updateMany({ where: { id: { in: ids }, practiceId: user.practiceId }, data: { [field]: value || null } });
    await logAudit(user.practiceId, user.id, "GIS_BULK_ASSIGN", "Patient", undefined, `${label} -> ${value || "(blank)"} on ${r.count}: ${ids.join(",")}`.slice(0, 2000));
    return `${label} ${value ? "assigned" : "cleared"} on ${r.count} patient${r.count === 1 ? "" : "s"}`;
  });
}

// ---- Resolver ----

export async function geocodePatientNow(patientId: string, fd: FormData) {
  const back = str(fd, "back") || "/gis/resolver";
  return guarded("gis.edit", back, async (user) => {
    const p = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId } });
    if (!p) fail("Patient not found");
    const r = await geocodePatient(p.id);
    if ("error" in r) fail(`${p.lastName}, ${p.firstName}: ${r.error}`);
    await logAudit(user.practiceId, user.id, "GIS_GEOCODE", "Patient", p.id, `${r.source} ${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}`);
    return `${p.lastName}, ${p.firstName} placed on the map (${r.source})`;
  });
}

// A candidate the user picked, or coordinates typed by hand.
export async function setPatientPoint(patientId: string, fd: FormData) {
  const back = str(fd, "back") || "/gis/resolver";
  return guarded("gis.edit", back, async (user) => {
    const p = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId } });
    if (!p) fail("Patient not found");
    const lat = Number(str(fd, "latitude"));
    const lng = Number(str(fd, "longitude"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) fail("Enter a latitude between -90 and 90 and a longitude between -180 and 180");
    const source = ["CENSUS", "GOOGLE"].includes(str(fd, "source")) ? str(fd, "source") : "MANUAL";
    await prisma.patient.update({ where: { id: p.id }, data: { latitude: lat, longitude: lng, geocodedAt: new Date(), geocodeSource: source, geocodeError: null } });
    await logAudit(user.practiceId, user.id, "GIS_GEOCODE", "Patient", p.id, `${source} ${lat.toFixed(5)}, ${lng.toFixed(5)} (resolver)`);
    return `${p.lastName}, ${p.firstName} placed at ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  });
}

export async function clearPatientPoint(patientId: string, fd: FormData) {
  const back = str(fd, "back") || "/gis/resolver";
  return guarded("gis.edit", back, async (user) => {
    const p = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId } });
    if (!p) fail("Patient not found");
    await prisma.patient.update({ where: { id: p.id }, data: { ...CLEAR_GEOCODE, geocodeSource: null } });
    await logAudit(user.practiceId, user.id, "GIS_GEOCODE", "Patient", p.id, "cleared (resolver)");
    return `${p.lastName}, ${p.firstName} will be geocoded again by the job`;
  });
}

// Runs the geocoding job now (same as Settings -> Automation runs -> Run now).
export async function runGeocodeNow() {
  return guarded("gis.edit", "/gis/resolver", async (user) => {
    const r = await runJob("gis-geocode", "MANUAL", user.id);
    await logAudit(user.practiceId, user.id, "RUN_JOB", "Job", "gis-geocode", r.summary);
    await notify(user.practiceId, [user.id], { kind: r.ok ? "SUCCESS" : "WARNING", title: r.ok ? "Geocoding finished" : "Geocoding failed", message: r.summary, href: "/gis/resolver" });
    if (!r.ok) fail(`Geocoding failed: ${r.summary}`);
    return `Geocoding ran: ${r.summary}`;
  });
}
