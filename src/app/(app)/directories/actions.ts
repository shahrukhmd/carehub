"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

function required(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function optional(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

export async function createPayer(formData: FormData) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "BILLER"]);
  const name = required(formData, "name");

  const payer = await prisma.payer.create({
    data: {
      practiceId: user.practiceId,
      name,
      payerCode: optional(formData, "payerCode"),
      phone: optional(formData, "phone"),
      addressLine1: optional(formData, "addressLine1"),
      city: optional(formData, "city"),
      state: optional(formData, "state"),
      zip: optional(formData, "zip"),
    },
  });

  await logAudit(user.practiceId, user.id, "CREATE_PAYER", "Payer", payer.id, name);
  revalidatePath("/directories");
  revalidatePath("/patients/new");
}

export async function togglePayerActive(payerId: string) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "BILLER"]);
  const payer = await prisma.payer.findFirstOrThrow({ where: { id: payerId, practiceId: user.practiceId } });
  await prisma.payer.update({ where: { id: payer.id }, data: { active: !payer.active } });
  revalidatePath("/directories");
}

export async function createReferringPhysician(formData: FormData) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "CLINICIAN"]);
  const name = required(formData, "name");

  const physician = await prisma.referringPhysician.create({
    data: {
      practiceId: user.practiceId,
      name,
      npi: optional(formData, "npi"),
      specialty: optional(formData, "specialty"),
      phone: optional(formData, "phone"),
      fax: optional(formData, "fax"),
      addressLine1: optional(formData, "addressLine1"),
      city: optional(formData, "city"),
      state: optional(formData, "state"),
      zip: optional(formData, "zip"),
    },
  });

  await logAudit(user.practiceId, user.id, "CREATE_REFERRING_PHYSICIAN", "ReferringPhysician", physician.id, name);
  revalidatePath("/directories");
  revalidatePath("/patients/new");
}

export async function toggleReferringPhysicianActive(physicianId: string) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "CLINICIAN"]);
  const physician = await prisma.referringPhysician.findFirstOrThrow({
    where: { id: physicianId, practiceId: user.practiceId },
  });
  await prisma.referringPhysician.update({ where: { id: physician.id }, data: { active: !physician.active } });
  revalidatePath("/directories");
}
