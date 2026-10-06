"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { assertChartEditable } from "@/lib/visit-guard";
import { canEditClinical, canEditCoding } from "@/lib/visit-workflow";
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


// ---- Treatment note (product engine) ----

const MAX_TREATMENT_LINES = 12;

// Saves the treatment note for this wound at this visit: one product per step row, in order.
export async function saveTreatment(woundId: string, encounterId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  await assertChartEditable(encounterId, user, "clinical");
  const wound = await prisma.wound.findFirstOrThrow({ where: { id: woundId, practiceId: user.practiceId } });
  const [steps, products] = await Promise.all([
    prisma.treatmentStep.findMany({ where: { practiceId: user.practiceId } }),
    prisma.woundProduct.findMany({ where: { practiceId: user.practiceId } }),
  ]);
  const lines: { stepId: string | null; stepName: string; productId: string | null; productName: string; quantity: number; unit: string; instructions: string | null; sortOrder: number }[] = [];
  for (let i = 0; i < MAX_TREATMENT_LINES; i++) {
    const productId = optionalString(formData, `product_${i}`);
    const stepId = optionalString(formData, `step_${i}`);
    if (!productId && !optionalString(formData, `other_${i}`)) continue;
    const step = steps.find((x) => x.id === stepId) ?? null;
    const product = products.find((x) => x.id === productId) ?? null;
    const qty = Number(optionalString(formData, `qty_${i}`) ?? "1");
    lines.push({
      stepId: step?.id ?? null,
      stepName: step?.name ?? optionalString(formData, `stepName_${i}`) ?? "Treatment",
      productId: product?.id ?? null,
      productName: product?.name ?? optionalString(formData, `other_${i}`) ?? "",
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
      unit: product?.unit ?? "each",
      instructions: optionalString(formData, `instr_${i}`) ?? product?.instructions ?? null,
      sortOrder: lines.length,
    });
  }
  const notes = optionalString(formData, "treatmentNotes");
  const existing = await prisma.woundTreatment.findUnique({ where: { encounterId_woundId: { encounterId, woundId: wound.id } } });
  if (existing) {
    await prisma.$transaction([
      prisma.woundTreatmentLine.deleteMany({ where: { treatmentId: existing.id } }),
      prisma.woundTreatment.update({ where: { id: existing.id }, data: { notes, performedById: user.id, lines: { create: lines } } }),
    ]);
  } else {
    await prisma.woundTreatment.create({ data: { practiceId: user.practiceId, encounterId, woundId: wound.id, notes, performedById: user.id, lines: { create: lines } } });
  }
  await logAudit(user.practiceId, user.id, "SAVE_TREATMENT", "Wound", wound.id, `${lines.length} line(s)`);
  revalidatePath(`/encounters/${encounterId}`, "layout");
  redirect(`/encounters/${encounterId}/wounds/${wound.id}?ok=${encodeURIComponent("Treatment note saved.")}#treatment`);
}

// Copies the wound's most recent treatment note (from an earlier visit) into this visit, to be edited and saved.
export async function copyLastTreatment(woundId: string, encounterId: string) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  await assertChartEditable(encounterId, user, "clinical");
  const last = await prisma.woundTreatment.findFirst({
    where: { woundId, practiceId: user.practiceId, encounterId: { not: encounterId } },
    orderBy: { createdAt: "desc" },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!last) redirect(`/encounters/${encounterId}/wounds/${woundId}?error=${encodeURIComponent("No earlier treatment note on this wound.")}#treatment`);
  const existing = await prisma.woundTreatment.findUnique({ where: { encounterId_woundId: { encounterId, woundId } } });
  const lines = last!.lines.map(({ stepId, stepName, productId, productName, quantity, unit, instructions, sortOrder }) => ({ stepId, stepName, productId, productName, quantity, unit, instructions, sortOrder }));
  if (existing) {
    await prisma.$transaction([
      prisma.woundTreatmentLine.deleteMany({ where: { treatmentId: existing.id } }),
      prisma.woundTreatment.update({ where: { id: existing.id }, data: { notes: last!.notes, performedById: user.id, billedAt: null, lines: { create: lines } } }),
    ]);
  } else {
    await prisma.woundTreatment.create({ data: { practiceId: user.practiceId, encounterId, woundId, notes: last!.notes, performedById: user.id, lines: { create: lines } } });
  }
  revalidatePath(`/encounters/${encounterId}`, "layout");
  redirect(`/encounters/${encounterId}/wounds/${woundId}?ok=${encodeURIComponent("Copied the last treatment — check and save.")}#treatment`);
}

// Pushes the billable products (those with an HCPCS code) of this visit's treatment to the superbill as charges.
export async function billTreatmentSupplies(woundId: string, encounterId: string) {
  const user = await requireUser(["ADMIN", "CLINICIAN", "CODER"]);
  const t = await prisma.woundTreatment.findUnique({ where: { encounterId_woundId: { encounterId, woundId } }, include: { lines: { include: { product: true } }, encounter: { select: { placeOfService: true, practiceId: true, status: true } } } });
  if (!t || t.encounter.practiceId !== user.practiceId) redirect(`/encounters/${encounterId}/wounds/${woundId}#treatment`);
  // Charges follow the chart lock: the clinical team while the chart is theirs, the coder while it is in coding.
  if (!(canEditClinical(t.encounter.status, user.role) || canEditCoding(t.encounter.status, user.role))) {
    redirect(`/encounters/${encounterId}/wounds/${woundId}?error=${encodeURIComponent("The chart is locked at this stage — supplies can't be added to the superbill by your role now.")}#treatment`);
  }
  const billable = t.lines.filter((l) => l.product?.hcpcsCode);
  if (billable.length === 0) redirect(`/encounters/${encounterId}/wounds/${woundId}?error=${encodeURIComponent("None of the products on this note has an HCPCS code.")}#treatment`);
  const { scheduleForEncounter } = await import("@/lib/charge-schedules");
  const schedule = await scheduleForEncounter(user.practiceId, encounterId);
  const codes = await prisma.practiceCode.findMany({ where: { practiceId: user.practiceId, type: "CPT", code: { in: billable.map((l) => l.product!.hcpcsCode!) } } });
  let added = 0;
  for (const l of billable) {
    const code = l.product!.hcpcsCode!;
    const units = Math.max(1, Math.round(l.quantity));
    const fee = schedule?.fees.get(code)?.feeCents ?? codes.find((c) => c.code === code)?.feeCents ?? 0;
    // One charge per code, with the units from this note (re-adding replaces, so supplies are never double-counted).
    const have = await prisma.charge.findFirst({ where: { encounterId, cptCode: code } });
    if (have) await prisma.charge.update({ where: { id: have.id }, data: { units } });
    else await prisma.charge.create({ data: { practiceId: user.practiceId, encounterId, cptCode: code, description: `${l.product!.name}${l.product!.size ? ` (${l.product!.size})` : ""}`, units, amountCents: fee, placeOfService: t.encounter.placeOfService ?? "11" } });
    added++;
  }
  await prisma.woundTreatment.update({ where: { id: t.id }, data: { billedAt: new Date() } });
  await logAudit(user.practiceId, user.id, "BILL_TREATMENT_SUPPLIES", "Wound", woundId, `${added} product(s)`);
  revalidatePath(`/encounters/${encounterId}`, "layout");
  redirect(`/encounters/${encounterId}/wounds/${woundId}?ok=${encodeURIComponent(`${added} product${added === 1 ? "" : "s"} added to the superbill.`)}#treatment`);
}
