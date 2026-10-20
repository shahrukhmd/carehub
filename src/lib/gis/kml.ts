import "server-only";
import { XMLParser } from "fast-xml-parser";

// KML (and the KML inside a KMZ) to a GeoJSON FeatureCollection of polygons and lines, for region overlays.
// Only what a boundary file needs: Placemark names, Polygon outer rings (with holes), LineString paths, and
// MultiGeometry wrappers. Points are ignored.

type Feature = { type: "Feature"; properties: { name: string }; geometry: { type: "Polygon"; coordinates: number[][][] } | { type: "LineString"; coordinates: number[][] } };
export type FeatureCollection = { type: "FeatureCollection"; features: Feature[] };

const coords = (text: unknown): number[][] =>
  String(text ?? "")
    .trim()
    .split(/\s+/)
    .map((t) => t.split(",").map(Number))
    .filter((c) => c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map(([lng, lat]) => [lng, lat]);

const list = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

type Poly = { outerBoundaryIs?: { LinearRing?: { coordinates?: unknown } }; innerBoundaryIs?: { LinearRing?: { coordinates?: unknown } } | { LinearRing?: { coordinates?: unknown } }[] };
type Line = { coordinates?: unknown };
type Geom = { Polygon?: Poly | Poly[]; LineString?: Line | Line[]; MultiGeometry?: Geom | Geom[] };
type Placemark = Geom & { name?: unknown };
type Container = { Placemark?: Placemark | Placemark[]; Folder?: Container | Container[]; Document?: Container | Container[] };

function geometries(g: Geom, name: string, out: Feature[]) {
  for (const p of list(g.Polygon)) {
    const outer = coords(p.outerBoundaryIs?.LinearRing?.coordinates);
    if (outer.length < 3) continue;
    const holes = list(p.innerBoundaryIs as Poly["innerBoundaryIs"]).map((h) => coords((h as { LinearRing?: { coordinates?: unknown } }).LinearRing?.coordinates)).filter((h) => h.length >= 3);
    out.push({ type: "Feature", properties: { name }, geometry: { type: "Polygon", coordinates: [outer, ...holes] } });
  }
  for (const l of list(g.LineString)) {
    const c = coords(l.coordinates);
    if (c.length >= 2) out.push({ type: "Feature", properties: { name }, geometry: { type: "LineString", coordinates: c } });
  }
  for (const m of list(g.MultiGeometry)) geometries(m, name, out);
}

function walk(c: Container, out: Feature[]) {
  for (const pm of list(c.Placemark)) geometries(pm, String(pm.name ?? "").trim(), out);
  for (const f of list(c.Folder)) walk(f, out);
  for (const d of list(c.Document)) walk(d, out);
}

export function kmlToGeoJson(xml: string): FeatureCollection {
  const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, trimValues: true });
  const doc = parser.parse(xml) as { kml?: Container };
  const out: Feature[] = [];
  if (doc.kml) walk(doc.kml, out);
  return { type: "FeatureCollection", features: out };
}

// GeoJSON as uploaded: kept when it is a FeatureCollection, Feature or bare geometry; wrapped into a collection.
export function normalizeGeoJson(text: string): FeatureCollection {
  const v = JSON.parse(text) as { type?: string; features?: unknown[]; geometry?: unknown; properties?: unknown; coordinates?: unknown };
  if (v.type === "FeatureCollection" && Array.isArray(v.features)) return v as FeatureCollection;
  if (v.type === "Feature") return { type: "FeatureCollection", features: [v as Feature] };
  if (v.type && v.coordinates) return { type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "" }, geometry: v as Feature["geometry"] }] };
  throw new Error("Not a GeoJSON FeatureCollection, Feature or geometry");
}
