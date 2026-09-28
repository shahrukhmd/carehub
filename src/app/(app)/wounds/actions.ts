"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { assertChartEditable } from "@/lib/visit-guard";
import { logAudit } from "@/lib/audit";
import {
  type BwatItems,
  BWAT_ITEMS,
  bwatTotal,
  calcAreaCm2,
  pushExudateScore,
  pushSurfaceAreaScore,
  pushTissueScore,
  pushTotal,
} from "@/lib/wound";

function required(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function optionalString(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

function optionalNumber(formData: FormData, key: string) {
  const raw = formData.get(key);
  if (raw === null || String(raw).trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function photoToDataUrl(formData: FormData): Promise<string | null> {
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return null;
  const buffer = Buffer.from(await file.arrayBuffer());
  return `data:${file.type};base64,${buffer.toString("base64")}`;
}

export async function createWound(patientId: string, encounterId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  await assertChartEditable(encounterId, user, "clinical");
  await prisma.encounter.findFirstOrThrow({
    where: { id: encounterId, patientId, practiceId: user.practiceId },
  });

  const label = required(formData, "label");
  const location = required(formData, "location");
  const etiology = required(formData, "etiology");
  const onsetDateRaw = String(formData.get("onsetDate") ?? "").trim();

  const wound = await prisma.wound.create({
    data: {
      practiceId: user.practiceId,
      patientId,
      label,
      location,
      etiology,
      onsetDate: onsetDateRaw ? new Date(onsetDateRaw) : null,
      status: "ACTIVE",
    },
  });

  await logAudit(user.practiceId, user.id, "CREATE_WOUND", "Wound", wound.id, `${label} (${location})`);

  revalidatePath(`/encounters/${encounterId}`);
  redirect(`/encounters/${encounterId}/wounds/${wound.id}`);
}

export async function updateWoundStatus(woundId: string, encounterId: string, status: string) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  await assertChartEditable(encounterId, user, "clinical");
  const wound = await prisma.wound.findFirstOrThrow({
    where: { id: woundId, practiceId: user.practiceId },
  });

  await prisma.wound.update({
    where: { id: wound.id },
    data: { status, healedDate: status === "HEALED" ? new Date() : null },
  });

  await logAudit(user.practiceId, user.id, "UPDATE_WOUND_STATUS", "Wound", woundId, status);

  revalidatePath(`/encounters/${encounterId}/wounds/${woundId}`);
  revalidatePath(`/encounters/${encounterId}`);
}

export async function saveWoundAssessment(woundId: string, encounterId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  await assertChartEditable(encounterId, user, "clinical");
  const wound = await prisma.wound.findFirstOrThrow({
    where: { id: woundId, practiceId: user.practiceId },
  });
  const encounter = await prisma.encounter.findFirstOrThrow({
    where: { id: encounterId, patientId: wound.patientId, practiceId: user.practiceId },
  });

  const lengthCm = optionalNumber(formData, "lengthCm");
  const widthCm = optionalNumber(formData, "widthCm");
  const areaCm2 = calcAreaCm2(lengthCm, widthCm);

  const pushExudateAmount = optionalString(formData, "pushExudateAmount");
  const pushTissueType = optionalString(formData, "pushTissueType");
  const surfaceScore = pushSurfaceAreaScore(areaCm2);
  const exudateScore = pushExudateScore(pushExudateAmount);
  const tissueScore = pushTissueScore(pushTissueType);

  const bwatItems: BwatItems = {};
  for (const item of BWAT_ITEMS) {
    const raw = formData.get(`bwat_${item.key}`);
    if (raw !== null && String(raw).trim() !== "") {
      bwatItems[item.key] = Number(raw);
    }
  }

  const photoUrl = await photoToDataUrl(formData);

  const assessment = await prisma.woundAssessment.create({
    data: {
      woundId: wound.id,
      encounterId: encounter.id,
      assessedById: user.id,
      lengthCm,
      widthCm,
      depthCm: optionalNumber(formData, "depthCm"),
      areaCm2,
      underminingCm: optionalNumber(formData, "underminingCm"),
      underminingClock: optionalString(formData, "underminingClock"),
      tunnelingCm: optionalNumber(formData, "tunnelingCm"),
      tunnelingClock: optionalString(formData, "tunnelingClock"),
      stage: optionalString(formData, "stage"),
      granulationPct: optionalNumber(formData, "granulationPct"),
      sloughPct: optionalNumber(formData, "sloughPct"),
      escharPct: optionalNumber(formData, "escharPct"),
      epithelialPct: optionalNumber(formData, "epithelialPct"),
      exudateAmount: optionalString(formData, "exudateAmount"),
      exudateType: optionalString(formData, "exudateType"),
      periwoundSkin: optionalString(formData, "periwoundSkin"),
      odor: formData.get("odor") === "on",
      painLevel: optionalNumber(formData, "painLevel"),
      pushExudateAmount,
      pushTissueType,
      pushSurfaceAreaScore: surfaceScore,
      pushExudateScore: exudateScore,
      pushTissueScore: tissueScore,
      pushTotal: pushTotal(surfaceScore, exudateScore, tissueScore),
      bwatItems: Object.keys(bwatItems).length ? JSON.stringify(bwatItems) : null,
      bwatTotal: bwatTotal(bwatItems),
      photoUrl,
      notes: optionalString(formData, "notes"),
    },
  });

  await logAudit(user.practiceId, user.id, "WOUND_ASSESSED", "WoundAssessment", assessment.id, wound.label);

  if (formData.get("documentDebridement") === "on") {
    const method = required(formData, "debridementMethod");
    const cptCode = optionalString(formData, "debridementCpt");
    const amount = optionalNumber(formData, "debridementAmount");

    let chargeId: string | null = null;
    if (cptCode && amount !== null) {
      const charge = await prisma.charge.create({
        data: {
          practiceId: user.practiceId,
          encounterId: encounter.id,
          cptCode,
          description: `Debridement — ${wound.label}`,
          amountCents: Math.round(amount * 100),
        },
      });
      chargeId = charge.id;
    }

    await prisma.debridement.create({
      data: {
        woundAssessmentId: assessment.id,
        method,
        tissueRemoved: optionalString(formData, "tissueRemoved"),
        cptCode,
        chargeId,
        performedById: user.id,
      },
    });

    await logAudit(user.practiceId, user.id, "DEBRIDEMENT_PERFORMED", "WoundAssessment", assessment.id, method);
  }

  revalidatePath(`/encounters/${encounterId}/wounds/${woundId}`);
  revalidatePath(`/encounters/${encounterId}`);
  revalidatePath("/billing");
}
