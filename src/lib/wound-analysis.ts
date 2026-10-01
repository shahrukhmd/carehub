// Wound photo analysis: what the AI is asked for, and the arithmetic done on its answer.
// Shared by the server action and the analyzer component (no server-only imports).
import { z } from "zod";

const pct = z.number().int().min(0).max(100).nullable();

export const WoundPhotoReading = z.object({
  woundVisible: z.boolean(),
  // What in the photo gives the scale. Without one, sizes cannot be measured from a photo.
  scaleReference: z.enum(["RULER", "MEASURING_TAPE", "MEASUREMENT_STICKER", "NONE"]),
  lengthCm: z.number().nullable(),
  widthCm: z.number().nullable(),
  measurementConfidence: z.enum(["high", "medium", "low"]),
  granulationPct: pct,
  sloughPct: pct,
  escharPct: pct,
  epithelialPct: pct,
  periwound: z.string(),
  observations: z.string(),
  // Only when a previous photo was supplied.
  comparison: z.object({ trend: z.enum(["IMPROVING", "NO_CHANGE", "WORSENING", "NOT_COMPARABLE"]), summary: z.string() }).nullable(),
});

export type WoundPhotoReading = z.infer<typeof WoundPhotoReading>;

export type WoundAnalysis = {
  reading: WoundPhotoReading;
  provider: string;
  areaCm2: number | null;
  previous: { date: string; lengthCm: number | null; widthCm: number | null; areaCm2: number | null; photoUrl: string | null } | null;
  // Change in area against the previous assessment's recorded measurements: negative means the wound is smaller.
  areaChangePct: number | null;
};

export const trendLabel: Record<string, string> = {
  IMPROVING: "Improving",
  NO_CHANGE: "No significant change",
  WORSENING: "Worsening",
  NOT_COMPARABLE: "Photos not comparable",
};

export const scaleLabel: Record<string, string> = {
  RULER: "ruler in the photo",
  MEASURING_TAPE: "measuring tape in the photo",
  MEASUREMENT_STICKER: "measurement sticker in the photo",
  NONE: "no scale found",
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function areaChange(previousArea: number | null, currentArea: number | null) {
  if (!previousArea || currentArea === null) return null;
  return round1(((currentArea - previousArea) / previousArea) * 100);
}

// "38.5% smaller" / "12% larger" / "unchanged"
export function changeText(pctChange: number | null) {
  if (pctChange === null) return null;
  if (Math.abs(pctChange) < 0.05) return "unchanged";
  return `${Math.abs(pctChange)}% ${pctChange < 0 ? "smaller" : "larger"}`;
}

// The paragraph added to the assessment notes when the clinician accepts the analysis.
export function analysisNote(a: WoundAnalysis) {
  const r = a.reading;
  const size = r.lengthCm !== null && r.widthCm !== null ? `${round1(r.lengthCm)} x ${round1(r.widthCm)} cm (${round1(r.lengthCm * r.widthCm)} cm2), measured from the photo using the ${scaleLabel[r.scaleReference]}, ${r.measurementConfidence} confidence` : "size not measured from the photo";
  const change = changeText(a.areaChangePct);
  return [
    `AI photo analysis (${a.provider}, reviewed by clinician): ${size}.`,
    r.observations,
    a.previous && change ? `Compared with ${a.previous.date}: area ${change}.` : "",
    r.comparison ? `${trendLabel[r.comparison.trend]}: ${r.comparison.summary}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
