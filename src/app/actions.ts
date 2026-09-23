"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

function required(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function nextMrn() {
  return `CH-${Math.floor(100000 + Math.random() * 899999)}`;
}

export async function createPatient(formData: FormData) {
  const firstName = required(formData, "firstName");
  const lastName = required(formData, "lastName");
  const dob = required(formData, "dob");
  const sex = required(formData, "sex");

  const patient = await prisma.patient.create({
    data: {
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
  const patientId = required(formData, "patientId");
  const providerId = required(formData, "providerId");
  const startsAt = new Date(required(formData, "startsAt"));
  const visitType = required(formData, "visitType");
  const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);

  await prisma.appointment.create({
    data: {
      patientId,
      providerId,
      startsAt,
      endsAt,
      visitType,
      reason: String(formData.get("reason") ?? "") || null,
      location: String(formData.get("location") ?? "Main Clinic"),
      status: "SCHEDULED",
    },
  });

  revalidatePath("/schedule");
  revalidatePath("/");
  redirect("/schedule");
}

export async function updateAppointmentStatus(id: string, status: string) {
  await prisma.appointment.update({ where: { id }, data: { status } });
  revalidatePath("/schedule");
  revalidatePath("/");
}

export async function startEncounter(appointmentId: string) {
  const appt = await prisma.appointment.findUniqueOrThrow({
    where: { id: appointmentId },
    include: { encounter: true },
  });

  if (appt.encounter) {
    redirect(`/encounters/${appt.encounter.id}`);
  }

  const encounter = await prisma.encounter.create({
    data: {
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
  await prisma.encounter.update({
    where: { id },
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
    const encounter = await prisma.encounter.findUnique({ where: { id } });
    if (encounter?.appointmentId) {
      await prisma.appointment.update({
        where: { id: encounter.appointmentId },
        data: { status: "COMPLETED" },
      });
    }
  }

  revalidatePath(`/encounters/${id}`);
  revalidatePath("/encounters");
  revalidatePath("/schedule");
}

export async function addCharge(encounterId: string, formData: FormData) {
  const cptCode = required(formData, "cptCode");
  const description = required(formData, "description");
  const amount = Number(required(formData, "amount"));

  await prisma.charge.create({
    data: {
      encounterId,
      cptCode,
      description,
      units: Number(formData.get("units") ?? 1) || 1,
      amountCents: Math.round(amount * 100),
      icd10: String(formData.get("icd10") ?? "") || null,
    },
  });

  revalidatePath(`/encounters/${encounterId}`);
  revalidatePath("/billing");
}

export async function submitClaim(chargeId: string) {
  const charge = await prisma.charge.findUniqueOrThrow({
    where: { id: chargeId },
    include: { encounter: { include: { patient: { include: { insurances: true } } } }, claim: true },
  });

  const payer = charge.encounter.patient.insurances.find((i) => i.isPrimary)?.payerName ?? "Self-pay";

  if (charge.claim) {
    await prisma.claim.update({
      where: { id: charge.claim.id },
      data: { status: "SUBMITTED", submittedAt: new Date(), billedCents: charge.amountCents, payerName: payer },
    });
  } else {
    await prisma.claim.create({
      data: {
        chargeId: charge.id,
        payerName: payer,
        status: "SUBMITTED",
        billedCents: charge.amountCents,
        submittedAt: new Date(),
      },
    });
  }

  revalidatePath("/billing");
}

export async function markClaimPaid(claimId: string) {
  const claim = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
  await prisma.claim.update({
    where: { id: claimId },
    data: { status: "PAID", paidCents: claim.billedCents },
  });
  revalidatePath("/billing");
}
