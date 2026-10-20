import "server-only";
import { prisma } from "@/lib/prisma";
import { censusCandidates, validateAddress, type AddressIn, type AddressOut } from "@/lib/address-validator";
import { FIELD_PROVIDER_WHERE, gisGoogleKey } from "@/lib/gis/settings";

// GIS geocoding: patients' home addresses and field clinicians' home bases become coordinates for maps and routes.
// The US Census geocoder (public, no key, US only) is the default; a Google key in GIS settings switches to Google
// Geocoding. The job (src/lib/jobs.ts) fills in every address without coordinates; the patient and provider save
// actions clear the coordinates when the address changes so the job picks the record up again. The Resolver page
// re-runs it by hand and lets a user pick among candidates.

export type GeoPoint = { latitude: number; longitude: number; source: "CENSUS" | "GOOGLE" };
export type Geocodable = { addressLine1: string | null; addressLine2?: string | null; city: string | null; state: string | null; zip: string | null };
export type Candidate = { label: string; latitude: number; longitude: number; source: "CENSUS" | "GOOGLE" };

// Failed lookups are retried after a week (geocodedAt is set on failure too, with the reason in geocodeError).
const RETRY_AFTER_MS = 7 * 86_400_000;
export const needsGeocode = (now = new Date()) => ({
  addressLine1: { not: null },
  latitude: null,
  OR: [{ geocodedAt: null }, { geocodedAt: { lt: new Date(now.getTime() - RETRY_AFTER_MS) } }],
});

export const hasAddress = (a: Geocodable) => Boolean(a.addressLine1?.trim() && (a.zip?.trim() || (a.city?.trim() && a.state?.trim())));
export const fullAddress = (a: Geocodable) => [a.addressLine1, a.addressLine2, a.city, a.state, a.zip].filter((s) => s && s.trim()).join(", ");

// Did the street address change between two records? (Unit numbers don't move the pin.)
export function addressChanged(before: Geocodable, after: Geocodable) {
  const norm = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  return norm(before.addressLine1) !== norm(after.addressLine1) || norm(before.city) !== norm(after.city) || norm(before.state) !== norm(after.state) || norm(before.zip).slice(0, 5) !== norm(after.zip).slice(0, 5);
}

export const CLEAR_GEOCODE = { latitude: null, longitude: null, geocodedAt: null, geocodeError: null };

const toInput = (a: Geocodable): AddressIn => ({ line1: a.addressLine1 ?? "", line2: a.addressLine2 ?? "", city: a.city ?? "", state: a.state ?? "", zip: a.zip ?? "" });

export async function geocodeAddress(practiceId: string, a: Geocodable): Promise<GeoPoint | { error: string }> {
  if (!hasAddress(a)) return { error: "No street address" };
  const key = await gisGoogleKey(practiceId);
  if (key) {
    const c = await googleCandidates(key, toInput(a)).catch((err: Error) => ({ error: err.message }));
    if ("error" in c) return c;
    return c[0] ? { latitude: c[0].latitude, longitude: c[0].longitude, source: "GOOGLE" } : { error: "Address not found by Google" };
  }
  const r = await validateAddress(toInput(a));
  if (r.status === "ERROR") return { error: r.message ?? "Geocoder did not answer" };
  if (!r.address || r.address.latitude == null || r.address.longitude == null) return { error: "Address not found by the Census geocoder" };
  return { latitude: r.address.latitude, longitude: r.address.longitude, source: "CENSUS" };
}

// Every candidate for an address, for the Resolver's manual pick.
export async function geocodeCandidates(practiceId: string, a: Geocodable): Promise<Candidate[]> {
  if (!hasAddress(a)) return [];
  const key = await gisGoogleKey(practiceId);
  if (key) return googleCandidates(key, toInput(a));
  const hits = await censusCandidates(toInput(a));
  return hits.filter((h): h is AddressOut & { latitude: number; longitude: number } => h.latitude != null && h.longitude != null).map((h) => ({ label: [h.line1, h.city, h.state, h.zip].filter(Boolean).join(", "), latitude: h.latitude, longitude: h.longitude, source: "CENSUS" as const }));
}

async function googleCandidates(key: string, a: AddressIn): Promise<Candidate[]> {
  const address = [a.line1, a.line2, a.city, a.state, a.zip].filter((s) => s && s.trim()).join(", ");
  const p = new URLSearchParams({ address, region: "us", key });
  const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${p}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Google Geocoding returned ${r.status}`);
  const d = (await r.json()) as { status: string; error_message?: string; results?: { formatted_address: string; geometry: { location: { lat: number; lng: number } } }[] };
  if (d.status === "ZERO_RESULTS") return [];
  if (d.status !== "OK") throw new Error(d.error_message ?? `Google Geocoding: ${d.status}`);
  return (d.results ?? []).map((x) => ({ label: x.formatted_address, latitude: x.geometry.location.lat, longitude: x.geometry.location.lng, source: "GOOGLE" as const }));
}

const stamp = (result: GeoPoint | { error: string }) =>
  "error" in result ? { ...CLEAR_GEOCODE, geocodedAt: new Date(), geocodeError: result.error.slice(0, 200) } : { latitude: result.latitude, longitude: result.longitude, geocodedAt: new Date(), geocodeError: null };

export async function geocodePatient(patientId: string) {
  const p = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!p) return { error: "Patient not found" };
  const result = await geocodeAddress(p.practiceId, p);
  await prisma.patient.update({ where: { id: p.id }, data: { ...stamp(result), ...("error" in result ? {} : { geocodeSource: result.source }) } });
  return result;
}

export async function geocodeRenderingProvider(providerId: string) {
  const p = await prisma.renderingProvider.findUnique({ where: { id: providerId } });
  if (!p) return { error: "Provider not found" };
  const result = await geocodeAddress(p.practiceId, p);
  await prisma.renderingProvider.update({ where: { id: p.id }, data: stamp(result) });
  return result;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The scheduled job: every patient and field clinician with an address and no coordinates, a batch at a time,
// politely spaced for the public geocoder.
export async function runGeocodeJob({ patientLimit = 150, providerLimit = 50 } = {}) {
  const where = needsGeocode();
  const [patients, providers] = await Promise.all([
    prisma.patient.findMany({ where, select: { id: true }, orderBy: { updatedAt: "asc" }, take: patientLimit }),
    prisma.renderingProvider.findMany({
      where: { addressLine1: where.addressLine1, latitude: null, AND: [{ OR: where.OR }, { OR: FIELD_PROVIDER_WHERE.OR }] },
      select: { id: true },
      take: providerLimit,
    }),
  ]);
  let ok = 0;
  let failed = 0;
  for (const p of patients) {
    if ("error" in (await geocodePatient(p.id))) failed++;
    else ok++;
    await pause(250);
  }
  for (const p of providers) {
    if ("error" in (await geocodeRenderingProvider(p.id))) failed++;
    else ok++;
    await pause(250);
  }
  const remaining = await prisma.patient.count({ where: needsGeocode() });
  return `${ok} geocoded, ${failed} not found${remaining ? `, ${remaining} patients still waiting` : ""}`;
}

// Counts for the Resolver and the GIS landing page.
export async function geocodeStatus(practiceId: string) {
  const [located, waiting, failed, noAddress] = await Promise.all([
    prisma.patient.count({ where: { practiceId, status: "ACTIVE", latitude: { not: null } } }),
    prisma.patient.count({ where: { practiceId, status: "ACTIVE", ...needsGeocode() } }),
    prisma.patient.count({ where: { practiceId, status: "ACTIVE", latitude: null, geocodeError: { not: null } } }),
    prisma.patient.count({ where: { practiceId, status: "ACTIVE", OR: [{ addressLine1: null }, { addressLine1: "" }] } }),
  ]);
  return { located, waiting, failed, noAddress };
}
