export const etiologyLabel: Record<string, string> = {
  PRESSURE: "Pressure injury",
  VENOUS: "Venous insufficiency",
  ARTERIAL: "Arterial insufficiency",
  DIABETIC_NEUROPATHIC: "Diabetic / neuropathic",
  SURGICAL: "Surgical",
  TRAUMATIC: "Traumatic",
  OTHER: "Other",
};

export const woundStatusLabel: Record<string, string> = {
  ACTIVE: "Active",
  HEALED: "Healed",
  CLOSED: "Closed",
};

export const stageLabel: Record<string, string> = {
  STAGE_1: "Stage 1",
  STAGE_2: "Stage 2",
  STAGE_3: "Stage 3",
  STAGE_4: "Stage 4",
  UNSTAGEABLE: "Unstageable",
  DTI: "Deep tissue injury",
  NA: "Not applicable",
};

export const exudateAmountLabel: Record<string, string> = {
  NONE: "None",
  SCANT: "Scant",
  SMALL: "Small",
  MODERATE: "Moderate",
  LARGE: "Large",
};

export const exudateTypeLabel: Record<string, string> = {
  SEROUS: "Serous",
  SANGUINEOUS: "Sanguineous",
  SEROSANGUINEOUS: "Serosanguineous",
  PURULENT: "Purulent",
};

export const debridementMethodLabel: Record<string, string> = {
  SHARP: "Sharp",
  ENZYMATIC: "Enzymatic",
  AUTOLYTIC: "Autolytic",
  MECHANICAL: "Mechanical",
  BIOLOGICAL: "Biological (larval)",
};

export function calcAreaCm2(lengthCm: number | null, widthCm: number | null) {
  if (!lengthCm || !widthCm) return null;
  return lengthCm * widthCm;
}

// NPUAP PUSH Tool 3.0 — Surface Area subscore (0-10) from length x width in cm^2.
export function pushSurfaceAreaScore(areaCm2: number | null) {
  if (areaCm2 === null) return null;
  if (areaCm2 === 0) return 0;
  if (areaCm2 < 0.3) return 1;
  if (areaCm2 <= 0.6) return 2;
  if (areaCm2 <= 1.0) return 3;
  if (areaCm2 <= 2.0) return 4;
  if (areaCm2 <= 3.0) return 5;
  if (areaCm2 <= 4.0) return 6;
  if (areaCm2 <= 8.0) return 7;
  if (areaCm2 <= 12.0) return 8;
  if (areaCm2 <= 24.0) return 9;
  return 10;
}

export const PUSH_EXUDATE_OPTIONS = [
  { value: "NONE", label: "None", score: 0 },
  { value: "LIGHT", label: "Light", score: 1 },
  { value: "MODERATE", label: "Moderate", score: 2 },
  { value: "HEAVY", label: "Heavy", score: 3 },
] as const;

export const PUSH_TISSUE_OPTIONS = [
  { value: "CLOSED", label: "Closed / resurfaced", score: 0 },
  { value: "EPITHELIAL", label: "Epithelial tissue", score: 1 },
  { value: "GRANULATION", label: "Granulation tissue", score: 2 },
  { value: "SLOUGH", label: "Slough", score: 3 },
  { value: "NECROTIC", label: "Necrotic (eschar)", score: 4 },
] as const;

export function pushExudateScore(value: string | null) {
  return PUSH_EXUDATE_OPTIONS.find((o) => o.value === value)?.score ?? null;
}

export function pushTissueScore(value: string | null) {
  return PUSH_TISSUE_OPTIONS.find((o) => o.value === value)?.score ?? null;
}

export function pushTotal(surfaceArea: number | null, exudate: number | null, tissue: number | null) {
  if (surfaceArea === null || exudate === null || tissue === null) return null;
  return surfaceArea + exudate + tissue;
}

// Bates-Jensen Wound Assessment Tool (BWAT) — 13 items, each scored 1 (best) to 5 (worst).
// Total ranges 13 (healed) to 65 (extremely poor).
export const BWAT_ITEMS = [
  { key: "size", label: "Size" },
  { key: "depth", label: "Depth" },
  { key: "edges", label: "Edges" },
  { key: "undermining", label: "Undermining" },
  { key: "necroticType", label: "Necrotic tissue type" },
  { key: "necroticAmount", label: "Necrotic tissue amount" },
  { key: "exudateType", label: "Exudate type" },
  { key: "exudateAmount", label: "Exudate amount" },
  { key: "skinColor", label: "Skin color surrounding wound" },
  { key: "edema", label: "Peripheral tissue edema" },
  { key: "induration", label: "Peripheral tissue induration" },
  { key: "granulation", label: "Granulation tissue" },
  { key: "epithelialization", label: "Epithelialization" },
] as const;

export type BwatItems = Partial<Record<(typeof BWAT_ITEMS)[number]["key"], number>>;

export function bwatTotal(items: BwatItems) {
  const values = BWAT_ITEMS.map((i) => items[i.key]).filter((v): v is number => typeof v === "number");
  if (values.length < BWAT_ITEMS.length) return null;
  return values.reduce((sum, v) => sum + v, 0);
}

export function parseBwatItems(json: string | null): BwatItems {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}
