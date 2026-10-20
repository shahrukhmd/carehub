import "server-only";
import { prisma } from "@/lib/prisma";

// GIS settings per practice, created on first use. The Google key comes from the settings row, else the
// GOOGLE_MAPS_API_KEY environment variable; blank means the free stack (MapLibre, Census geocoder, OSRM).

export const GIS_TITLES = [
  ["NP", "Nurse Practitioner"],
  ["LPN", "Wound Nurse (LPN)"],
  ["MA", "Wound Tech (MA)"],
  ["CLINICAL_TEAM", "Clinical Team"],
] as const;
export type GisTitle = (typeof GIS_TITLES)[number][0];
export const gisTitleLabel = (t: string | null | undefined) => GIS_TITLES.find(([k]) => k === t)?.[1] ?? (t ?? "");
export const isGisTitle = (v: string): v is GisTitle => GIS_TITLES.some(([k]) => k === v);
// Marker colour per title (home base pins and provider groups).
export const GIS_TITLE_COLOR: Record<GisTitle, string> = { NP: "#2563eb", LPN: "#16a34a", MA: "#d97706", CLINICAL_TEAM: "#7c3aed" };

export const NAME_FORMATS = [
  ["FORMAL", "Last, First"],
  ["STANDARD", "First Last"],
  ["CASUAL", "First"],
  ["MEDICAL", "LAST, First"],
] as const;

export async function getGisSettings(practiceId: string) {
  return prisma.gisSettings.upsert({ where: { practiceId }, create: { practiceId }, update: {} });
}

export async function gisGoogleKey(practiceId: string) {
  const s = await prisma.gisSettings.findUnique({ where: { practiceId }, select: { googleMapsKey: true } });
  return s?.googleMapsKey?.trim() || process.env.GOOGLE_MAPS_API_KEY?.trim() || null;
}

// Field clinicians: directory providers of type Clinician or Rendering.
export const FIELD_PROVIDER_WHERE = { status: "ACTIVE", OR: [{ isClinician: true }, { isRendering: true }] };

export function displayName(p: { firstName?: string | null; lastName?: string | null; name?: string | null }, format: string) {
  const first = p.firstName?.trim() ?? "";
  const last = p.lastName?.trim() ?? "";
  if (!first && !last) return p.name ?? "";
  switch (format) {
    case "STANDARD":
      return `${first} ${last}`.trim();
    case "CASUAL":
      return first || last;
    case "MEDICAL":
      return `${last.toUpperCase()}, ${first}`.replace(/^, |, $/g, "");
    default:
      return `${last}, ${first}`.replace(/^, |, $/g, "");
  }
}
