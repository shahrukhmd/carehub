"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { runEligibilityCheck } from "@/lib/clearinghouse/service";

function required(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

export async function createReservedTime(formData: FormData) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "CLINICIAN"]);
  const providerId = required(formData, "providerId");
  const locationId = String(formData.get("locationId") ?? "").trim() || null;
  const title = required(formData, "title");
  const startsAt = new Date(required(formData, "startsAt"));
  const endsAt = new Date(required(formData, "endsAt"));

  const provider = await prisma.user.findFirst({ where: { id: providerId, practiceId: user.practiceId } });
  if (!provider) throw new Error("Not found");

  await prisma.reservedTime.create({
    data: { practiceId: user.practiceId, providerId, locationId, title, startsAt, endsAt },
  });

  revalidatePath("/schedule");
}

export async function deleteReservedTime(id: string) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "CLINICIAN"]);
  await prisma.reservedTime.deleteMany({ where: { id, practiceId: user.practiceId } });
  revalidatePath("/schedule");
}

export async function checkEligibility(appointmentId: string) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "CLINICIAN", "BILLER"]);
  const appt = await prisma.appointment.findFirstOrThrow({
    where: { id: appointmentId, practiceId: user.practiceId },
  });

  await runEligibilityCheck({
    practiceId: user.practiceId,
    patientId: appt.patientId,
    appointmentId: appt.id,
  });

  revalidatePath("/schedule");
}

export async function addAvailability(formData: FormData) {
  const user = await requireUser(["ADMIN"]);
  const providerId = required(formData, "providerId");
  const locationId = required(formData, "locationId");
  const dayOfWeek = Number(required(formData, "dayOfWeek"));
  const startTime = required(formData, "startTime");
  const endTime = required(formData, "endTime");

  const [provider, location] = await Promise.all([
    prisma.user.findFirst({ where: { id: providerId, practiceId: user.practiceId } }),
    prisma.location.findFirst({ where: { id: locationId, practiceId: user.practiceId } }),
  ]);
  if (!provider || !location) throw new Error("Not found");

  await prisma.providerAvailability.create({
    data: { practiceId: user.practiceId, providerId, locationId, dayOfWeek, startTime, endTime },
  });

  await logAudit(
    user.practiceId,
    user.id,
    "SET_AVAILABILITY",
    "ProviderAvailability",
    providerId,
    `${provider.name}: day ${dayOfWeek} ${startTime}-${endTime}`
  );

  revalidatePath("/schedule/availability");
}

export async function removeAvailability(id: string) {
  const user = await requireUser(["ADMIN"]);
  await prisma.providerAvailability.deleteMany({ where: { id, practiceId: user.practiceId } });
  revalidatePath("/schedule/availability");
}
