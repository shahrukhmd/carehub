"use server";

import { rolesFor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { AiUnavailable, aiVision } from "@/lib/ai";
import { formatDate } from "@/lib/format";
import { etiologyLabel } from "@/lib/wound";
import { WoundPhotoReading, areaChange, type WoundAnalysis } from "@/lib/wound-analysis";

export type WoundAnalysisResult = { analysis: WoundAnalysis } | { error: string };

const MAX_PHOTO_CHARS = 8_000_000;

// Measures a wound photo and compares it with the wound's previous photo. Nothing is saved here: the clinician
// reviews the result, and it reaches the chart only if they fill the assessment form with it and save.
// The patient's name, MRN and date of birth are not sent; the photos, wound type and location are.
export async function analyzeWoundPhoto(woundId: string, encounterId: string, photo: string): Promise<WoundAnalysisResult> {
  const user = await requireUser(rolesFor("chart.ai"));
  const wound = await prisma.wound.findFirst({
    where: { id: woundId, practiceId: user.practiceId },
    include: { assessments: { orderBy: { assessedAt: "desc" }, take: 12 } },
  });
  if (!wound) return { error: "Wound not found." };
  if (!(await prisma.encounter.findFirst({ where: { id: encounterId, practiceId: user.practiceId, patientId: wound.patientId }, select: { id: true } }))) return { error: "Visit not found." };
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(photo)) return { error: "Choose a PNG or JPEG photo of the wound first." };
  if (photo.length > MAX_PHOTO_CHARS) return { error: "The photo is too large to analyse. Use a smaller photo." };

  // The latest earlier assessment is the baseline: its recorded measurements, and its photo when it has one.
  const last = wound.assessments[0] ?? null;
  const lastWithPhoto = wound.assessments.find((a) => a.photoUrl && /^data:image\/(png|jpeg|webp);base64,/.test(a.photoUrl) && a.photoUrl.length <= MAX_PHOTO_CHARS) ?? null;
  const previousPhoto = lastWithPhoto?.photoUrl ?? null;
  const baseline = lastWithPhoto ?? last;

  const prompt = [
    `Wound: ${etiologyLabel[wound.etiology] ?? wound.etiology}, located at ${wound.location}.`,
    previousPhoto
      ? `Two photos are attached. The FIRST is today's photo: measure and describe it. The SECOND is the previous photo, taken ${formatDate(lastWithPhoto!.assessedAt)}${
          lastWithPhoto!.lengthCm !== null && lastWithPhoto!.widthCm !== null ? `, when the wound was recorded as ${lastWithPhoto!.lengthCm} x ${lastWithPhoto!.widthCm} cm` : ""
        }. Compare today's wound with it.`
      : "One photo is attached: today's photo. There is no previous photo, so set comparison to null.",
  ].join("\n");

  try {
    const { data, provider } = await aiVision({
      practiceId: user.practiceId,
      name: "wound_photo_reading",
      schema: WoundPhotoReading,
      images: previousPhoto ? [photo, previousPhoto] : [photo],
      system: `You assist a wound care clinician by reading wound photographs. Your reading is a draft the clinician checks against the patient.
Rules:
- Measure only when the photo contains a scale reference (ruler, measuring tape or measurement sticker) at the wound. Use it to convert to centimetres. lengthCm is the greatest length of the wound opening; widthCm is the greatest width perpendicular to that length. Round to one decimal place.
- If there is no scale reference, set scaleReference to NONE and lengthCm and widthCm to null. Never guess a size from anatomy.
- measurementConfidence: high when the scale is in the wound's plane, sharp and close to it; medium when it is angled, partly hidden or far from the wound; low otherwise.
- Tissue percentages are the share of the wound bed surface: granulation (red, beefy), slough (yellow or tan), eschar (black or brown necrosis), epithelial (pink new skin). They should total about 100; use null when the wound bed cannot be seen.
- periwound: a few words on the skin around the wound (for example intact, macerated, erythema, callus, hemosiderin staining).
- observations: one or two factual sentences about what is visible. Do not diagnose infection or prescribe treatment.
- Depth, tunneling and undermining cannot be judged from a photo; do not report them.
- comparison (only when a previous photo is attached): trend is IMPROVING, NO_CHANGE or WORSENING from size and wound bed appearance, or NOT_COMPARABLE when the photos differ too much in angle, distance or lighting; summary is one or two sentences on what changed.
- If no wound is visible, set woundVisible to false and the measurements to null.`,
      prompt,
    });

    const areaCm2 = data.lengthCm !== null && data.widthCm !== null ? Math.round(data.lengthCm * data.widthCm * 10) / 10 : null;
    await logAudit(user.practiceId, user.id, "AI_WOUND_PHOTO_ANALYSED", "Wound", wound.id, provider);
    return {
      analysis: {
        reading: data,
        provider,
        areaCm2,
        previous: baseline
          ? { date: formatDate(baseline.assessedAt), lengthCm: baseline.lengthCm, widthCm: baseline.widthCm, areaCm2: baseline.areaCm2, photoUrl: previousPhoto }
          : null,
        // From the unrounded area, so it matches the figure the chart shows once the assessment is saved.
        areaChangePct: areaChange(baseline?.areaCm2 ?? null, data.lengthCm !== null && data.widthCm !== null ? data.lengthCm * data.widthCm : null),
      },
    };
  } catch (err) {
    if (err instanceof AiUnavailable) return { error: err.message };
    return { error: `The photo couldn't be analysed (${err instanceof Error ? err.message.slice(0, 160) : "error"}). Try again, or enter the measurements by hand.` };
  }
}
