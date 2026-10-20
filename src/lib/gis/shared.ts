// GIS helpers safe for both server and client components (no server imports).

export const GIS_STATUSES: { key: string; label: string; tone: string }[] = [
  { key: "pending", label: "Pending", tone: "#d99a1e" },
  { key: "ready", label: "Ready to schedule", tone: "#2bb7b3" },
  { key: "confirmed", label: "Confirmed", tone: "#8b5cf6" },
  { key: "rescheduled", label: "Rescheduled", tone: "#84cc16" },
  { key: "active", label: "Active", tone: "#10b981" },
  { key: "active-hosp", label: "Active Pt Hospitalized", tone: "#6b7280" },
  { key: "pending-discharge", label: "Pending Discharge", tone: "#f97316" },
  { key: "discharged", label: "Discharged", tone: "#e11d48" },
  { key: "unseen-hosp", label: "Unseen Pt Hospitalized", tone: "#fb923c" },
  { key: "unable", label: "Unable to see", tone: "#38bdf8" },
  { key: "none", label: "No Gateway case", tone: "#9ca3af" },
];
export const gisStatus = (key: string) => GIS_STATUSES.find((s) => s.key === key) ?? GIS_STATUSES[GIS_STATUSES.length - 1];

// Stop letters on the map and in the layer list: A, B, ... Z, AA, AB ...
export const stopLetter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));

export type DirectionsLeg = { distanceM: number; durationS: number; steps?: { text: string; distanceM: number; durationS: number }[] };
export type Directions = {
  provider: "OSRM" | "GOOGLE";
  // [lng, lat] pairs along the drive.
  geometry: [number, number][];
  legs: DirectionsLeg[];
  distanceM: number;
  durationS: number;
  computedAt: string;
  // The stop ids the directions were computed for, in order; stale when the route's stops differ.
  stopIds: string[];
  // Whether the drive starts and ends at the provider's home base.
  fromHome: boolean;
};

export function parseDirections(json: string | null | undefined): Directions | null {
  if (!json) return null;
  try {
    const d = JSON.parse(json) as Directions;
    return Array.isArray(d.geometry) && Array.isArray(d.legs) ? d : null;
  } catch {
    return null;
  }
}

export const miles = (m: number) => `${(m / 1609.344).toFixed(1)} mi`;
export const minutes = (s: number) => {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};

// A patient row in the map sidebar and a stop on a layer, as sent to the client.
export type SidebarPatient = { id: string; name: string; mrn: string; address: string; statusKey: string; zip: string | null; county: string | null; lat: number | null; lng: number | null; dob: string; np: string | null; lpn: string | null; ma: string | null };
export type LayerStop = { id: string; patientId: string; index: number; note: string | null; name: string; address: string; lat: number | null; lng: number | null };
export type Layer = {
  id: string;
  label: string;
  visitDate: string;
  note: string | null;
  markerColor: string;
  layerColor: string;
  layerTextColor: string;
  optimize: boolean;
  stops: LayerStop[];
  directions: Directions | null;
};
