"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

function required(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function nextMrn() {
  return `CH-${Math.floor(100000 + Math.random() * 899999)}`;
}

export async function createPatient(formData: FormData) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "CLINICIAN"]);
  const firstName = required(formData, "firstName");
  const lastName = required(formData, "lastName");
  const dob = required(formData, "dob");
  const sex = required(formData, "sex");

  const patient = await prisma.patient.create({
    data: {
      practiceId: user.practiceId,
      mrn: nextMrn(),
      firstName,
      lastName,
      dob: new Date(dob),
      sex,
      phone: String(formData.get("phone") ?? "") || null,
      email: String(formData.get("email") ?? "") || null,
      addressLine1: String(formData.get("addressLine1") ?? "") || null,
      city: String(formData.get("city") ?? "") || null,
      state: String(formData.get("state") ?? "") || null,
      zip: String(formData.get("zip") ?? "") || null,
      insurances: formData.get("payerName")
        ? {
            create: {
              payerName: String(formData.get("payerName")),
              memberId: String(formData.get("memberId") ?? "PENDING"),
              planName: String(formData.get("planName") ?? "") || null,
              isPrimary: true,
            },
          }
        : undefined,
    },
  });

  revalidatePath("/patients");
  redirect(`/patients/${patient.id}`);
}

export async function createAppointment(formData: FormData) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "CLINICIAN"]);
  const patientId = required(formData, "patientId");
  const providerId = required(formData, "providerId");
  const locationId = required(formData, "locationId");
  const startsAt = new Date(required(formData, "startsAt"));
  const visitType = required(formData, "visitType");
  const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);

  const [patient, provider, location] = await Promise.all([
    prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId } }),
    prisma.user.findFirst({ where: { id: providerId, practiceId: user.practiceId } }),
    prisma.location.findFirst({ where: { id: locationId, practiceId: user.practiceId } }),
  ]);
  if (!patient || !provider || !location) throw new Error("Not found");

  await prisma.appointment.create({
    data: {
      practiceId: user.practiceId,
      patientId,
      providerId,
      locationId,
      startsAt,
      endsAt,
      visitType,
      reason: String(formData.get("reason") ?? "") || null,
      status: "SCHEDULED",
    },
  });

  revalidatePath("/schedule");
  revalidatePath("/");
  redirect("/schedule");
}

export async function updateAppointmentStatus(id: string, status: string) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "CLINICIAN"]);
  await prisma.appointment.updateMany({ where: { id, practiceId: user.practiceId }, data: { status } });
  revalidatePath("/schedule");
  revalidatePath("/");
}

export async function startEncounter(appointmentId: string) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "CLINICIAN"]);
  const appt = await prisma.appointment.findFirstOrThrow({
    where: { id: appointmentId, practiceId: user.practiceId },
    include: { encounter: true },
  });

  if (appt.encounter) {
    redirect(`/encounters/${appt.encounter.id}`);
  }

  const encounter = await prisma.encounter.create({
    data: {
      practiceId: user.practiceId,
      patientId: appt.patientId,
      providerId: appt.providerId,
      appointmentId: appt.id,
      type: appt.visitType === "TELE" ? "TELEHEALTH" : "OFFICE",
      status: "IN_PROGRESS",
      chiefComplaint: appt.reason,
    },
  });

  await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: "IN_ROOM" },
  });

  revalidatePath("/schedule");
  redirect(`/encounters/${encounter.id}`);
}

export async function saveEncounter(id: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  const encounter = await prisma.encounter.findFirstOrThrow({ where: { id, practiceId: user.practiceId } });

  await prisma.encounter.update({
    where: { id: encounter.id },
    data: {
      chiefComplaint: String(formData.get("chiefComplaint") ?? "") || null,
      subjective: String(formData.get("subjective") ?? "") || null,
      objective: String(formData.get("objective") ?? "") || null,
      assessment: String(formData.get("assessment") ?? "") || null,
      plan: String(formData.get("plan") ?? "") || null,
      status: String(formData.get("status") ?? "IN_PROGRESS"),
    },
  });

  const status = String(formData.get("status") ?? "");
  if (status === "SIGNED") {
    if (encounter.appointmentId) {
      await prisma.appointment.update({
        where: { id: encounter.appointmentId },
        data: { status: "COMPLETED" },
      });
    }
    await logAudit(user.practiceId, user.id, "SIGN_ENCOUNTER", "Encounter", id);
  }

  revalidatePath(`/encounters/${id}`);
  revalidatePath("/encounters");
  revalidatePath("/schedule");
}

export async function addCharge(encounterId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  const encounter = await prisma.encounter.findFirstOrThrow({
    where: { id: encounterId, practiceId: user.practiceId },
  });

  const cptCode = required(formData, "cptCode");
  const description = required(formData, "description");
  const amount = Number(required(formData, "amount"));

  const modifiers = formData
    .getAll("modifiers")
    .map((m) => String(m).trim())
    .filter(Boolean)
    .join(",");

  const diagnosisPointers = formData
    .getAll("diagnosisPointers")
    .map((d) => String(d).trim())
    .filter(Boolean)
    .join(",");

  await prisma.charge.create({
    data: {
      practiceId: user.practiceId,
      encounterId: encounter.id,
      cptCode,
      description,
      units: Number(formData.get("units") ?? 1) || 1,
      amountCents: Math.round(amount * 100),
      modifiers: modifiers || null,
      diagnosisPointers: diagnosisPointers || null,
    },
  });

  revalidatePath(`/encounters/${encounterId}`);
  revalidatePath("/billing");
}

export async function addDiagnosis(encounterId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  const encounter = await prisma.encounter.findFirstOrThrow({
    where: { id: encounterId, practiceId: user.practiceId },
  });

  const icd10 = required(formData, "icd10");
  const description = required(formData, "description");

  const count = await prisma.encounterDiagnosis.count({ where: { encounterId: encounter.id } });

  await prisma.encounterDiagnosis.create({
    data: { encounterId: encounter.id, icd10, description, priority: count + 1 },
  });

  revalidatePath(`/encounters/${encounterId}`);
}

export async function removeDiagnosis(diagnosisId: string, encounterId: string) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  await prisma.encounter.findFirstOrThrow({ where: { id: encounterId, practiceId: user.practiceId } });
  await prisma.encounterDiagnosis.deleteMany({ where: { id: diagnosisId, encounterId } });
  revalidatePath(`/encounters/${encounterId}`);
}

export async function moveDiagnosis(diagnosisId: string, encounterId: string, direction: "up" | "down") {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  await prisma.encounter.findFirstOrThrow({ where: { id: encounterId, practiceId: user.practiceId } });

  const diagnoses = await prisma.encounterDiagnosis.findMany({
    where: { encounterId },
    orderBy: { priority: "asc" },
  });
  const index = diagnoses.findIndex((d) => d.id === diagnosisId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapIndex < 0 || swapIndex >= diagnoses.length) return;

  const current = diagnoses[index];
  const swap = diagnoses[swapIndex];

  await prisma.$transaction([
    prisma.encounterDiagnosis.update({ where: { id: current.id }, data: { priority: swap.priority } }),
    prisma.encounterDiagnosis.update({ where: { id: swap.id }, data: { priority: current.priority } }),
  ]);

  revalidatePath(`/encounters/${encounterId}`);
}

export async function updateEncounterBilling(encounterId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  const encounter = await prisma.encounter.findFirstOrThrow({
    where: { id: encounterId, practiceId: user.practiceId },
  });

  await prisma.encounter.update({
    where: { id: encounter.id },
    data: {
      patientStatus: String(formData.get("patientStatus") ?? "") || null,
      mdmLevel: String(formData.get("mdmLevel") ?? "") || null,
      hospice: formData.get("hospice") === "on",
    },
  });

  revalidatePath(`/encounters/${encounterId}`);
}

export async function submitClaim(chargeId: string) {
  const user = await requireUser(["ADMIN", "BILLER"]);
  const charge = await prisma.charge.findFirstOrThrow({
    where: { id: chargeId, practiceId: user.practiceId },
    include: { encounter: { include: { patient: { include: { insurances: true } } } }, claim: true },
  });

  const payer = charge.encounter.patient.insurances.find((i) => i.isPrimary)?.payerName ?? "Self-pay";

  if (charge.claim) {
    await prisma.claim.update({
      where: { id: charge.claim.id },
      data: { status: "SUBMITTED", submittedAt: new Date(), billedCents: charge.amountCents, payerName: payer },
    });
    await logAudit(user.practiceId, user.id, "SUBMIT_CLAIM", "Claim", charge.claim.id);
  } else {
    const claim = await prisma.claim.create({
      data: {
        chargeId: charge.id,
        payerName: payer,
        status: "SUBMITTED",
        billedCents: charge.amountCents,
        submittedAt: new Date(),
      },
    });
    await logAudit(user.practiceId, user.id, "SUBMIT_CLAIM", "Claim", claim.id);
  }

  revalidatePath("/billing");
}

export async function denyClaim(claimId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "BILLER"]);
  const claim = await prisma.claim.findFirstOrThrow({
    where: { id: claimId, charge: { practiceId: user.practiceId } },
  });
  const reason = String(formData.get("reason") ?? "").trim() || "Not specified";

  await prisma.claim.update({
    where: { id: claim.id },
    data: { status: "DENIED", denialReason: reason },
  });

  await logAudit(user.practiceId, user.id, "DENY_CLAIM", "Claim", claimId, reason);

  revalidatePath("/billing");
}

export async function resubmitClaim(claimId: string) {
  const user = await requireUser(["ADMIN", "BILLER"]);
  const claim = await prisma.claim.findFirstOrThrow({
    where: { id: claimId, charge: { practiceId: user.practiceId } },
  });

  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      status: "SUBMITTED",
      submittedAt: new Date(),
      denialReason: null,
      attempt: claim.attempt + 1,
    },
  });

  await logAudit(user.practiceId, user.id, "RESUBMIT_CLAIM", "Claim", claimId, `Attempt ${claim.attempt + 1}`);

  revalidatePath("/billing");
}

export async function postPayment(claimId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "BILLER"]);
  const amount = Number(required(formData, "amount"));
  const type = String(formData.get("type") ?? "PAYMENT") === "ADJUSTMENT" ? "ADJUSTMENT" : "PAYMENT";
  const note = String(formData.get("note") ?? "").trim() || null;
  const amountCents = Math.round(amount * 100);

  const claim = await prisma.claim.findFirstOrThrow({
    where: { id: claimId, charge: { practiceId: user.practiceId } },
  });

  await prisma.payment.create({ data: { claimId: claim.id, amountCents, type, note } });

  const paidCents = claim.paidCents + (type === "PAYMENT" ? amountCents : 0);
  const adjustedCents = claim.adjustedCents + (type === "ADJUSTMENT" ? amountCents : 0);
  const balanceCents = claim.billedCents - paidCents - adjustedCents;

  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      paidCents,
      adjustedCents,
      status: balanceCents <= 0 ? "PAID" : "PARTIAL",
    },
  });

  await logAudit(
    user.practiceId,
    user.id,
    type === "ADJUSTMENT" ? "POST_ADJUSTMENT" : "POST_PAYMENT",
    "Claim",
    claimId,
    formatMoneyCentsForAudit(amountCents)
  );

  revalidatePath("/billing");
}

function formatMoneyCentsForAudit(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function optionalNumber(formData: FormData, key: string) {
  const raw = formData.get(key);
  if (raw === null || String(raw).trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export async function saveVitals(encounterId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  await prisma.encounter.findFirstOrThrow({ where: { id: encounterId, practiceId: user.practiceId } });

  const data = {
    heightCm: optionalNumber(formData, "heightCm"),
    weightKg: optionalNumber(formData, "weightKg"),
    tempC: optionalNumber(formData, "tempC"),
    heartRate: optionalNumber(formData, "heartRate"),
    respRate: optionalNumber(formData, "respRate"),
    bpSystolic: optionalNumber(formData, "bpSystolic"),
    bpDiastolic: optionalNumber(formData, "bpDiastolic"),
    spo2: optionalNumber(formData, "spo2"),
  };

  await prisma.vitals.upsert({
    where: { encounterId },
    create: { encounterId, ...data },
    update: { ...data, recordedAt: new Date() },
  });

  revalidatePath(`/encounters/${encounterId}`);
}

export async function prescribeMedication(patientId: string, encounterId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  await prisma.encounter.findFirstOrThrow({
    where: { id: encounterId, patientId, practiceId: user.practiceId },
  });

  const name = required(formData, "name");
  const sig = required(formData, "sig");

  const medication = await prisma.medication.create({
    data: {
      patientId,
      encounterId,
      prescriberId: user.id,
      name,
      sig,
      status: "ACTIVE",
    },
  });

  await logAudit(user.practiceId, user.id, "PRESCRIBE", "Medication", medication.id, name);

  revalidatePath(`/encounters/${encounterId}`);
  revalidatePath(`/patients/${patientId}`);
}

export async function discontinueMedication(medicationId: string, encounterId: string) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  const medication = await prisma.medication.findFirstOrThrow({
    where: { id: medicationId, patient: { practiceId: user.practiceId } },
  });

  await prisma.medication.update({
    where: { id: medication.id },
    data: { status: "DISCONTINUED", discontinuedAt: new Date() },
  });

  await logAudit(user.practiceId, user.id, "DISCONTINUE_MEDICATION", "Medication", medication.id, medication.name);

  revalidatePath(`/encounters/${encounterId}`);
  revalidatePath(`/patients/${medication.patientId}`);
}

export async function orderLab(patientId: string, encounterId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  await prisma.encounter.findFirstOrThrow({
    where: { id: encounterId, patientId, practiceId: user.practiceId },
  });

  const testName = required(formData, "testName");

  await prisma.labOrder.create({
    data: {
      patientId,
      encounterId,
      orderedById: user.id,
      testName,
      status: "ORDERED",
    },
  });

  revalidatePath(`/encounters/${encounterId}`);
}

export async function resultLab(labOrderId: string, encounterId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  const labOrder = await prisma.labOrder.findFirstOrThrow({
    where: { id: labOrderId, patient: { practiceId: user.practiceId } },
  });

  const value = required(formData, "value");
  const unit = String(formData.get("unit") ?? "").trim() || null;
  const referenceRange = String(formData.get("referenceRange") ?? "").trim() || null;
  const flag = String(formData.get("flag") ?? "NORMAL");

  await prisma.labResult.create({
    data: { labOrderId: labOrder.id, value, unit, referenceRange, flag },
  });

  await prisma.labOrder.update({
    where: { id: labOrder.id },
    data: { status: "RESULTED" },
  });

  revalidatePath(`/encounters/${encounterId}`);
}

export async function cancelLabOrder(labOrderId: string, encounterId: string) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  const labOrder = await prisma.labOrder.findFirstOrThrow({
    where: { id: labOrderId, patient: { practiceId: user.practiceId } },
  });

  await prisma.labOrder.update({
    where: { id: labOrder.id },
    data: { status: "CANCELLED" },
  });
  revalidatePath(`/encounters/${encounterId}`);
}
