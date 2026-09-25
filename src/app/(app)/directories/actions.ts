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

export async function createBillingProvider(formData: FormData) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "BILLER"]);
  const name = required(formData, "name");

  const provider = await prisma.billingProvider.create({
    data: {
      practiceId: user.practiceId,
      name,
      npi: optional(formData, "npi"),
      taxId: optional(formData, "taxId"),
      addressLine1: optional(formData, "addressLine1"),
      city: optional(formData, "city"),
      state: optional(formData, "state"),
      zip: optional(formData, "zip"),
    },
  });

  await logAudit(user.practiceId, user.id, "CREATE_BILLING_PROVIDER", "BillingProvider", provider.id, name);
  revalidatePath("/directories");
  revalidatePath("/encounters");
}

export async function toggleBillingProviderActive(providerId: string) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "BILLER"]);
  const provider = await prisma.billingProvider.findFirstOrThrow({
    where: { id: providerId, practiceId: user.practiceId },
  });
  await prisma.billingProvider.update({ where: { id: provider.id }, data: { active: !provider.active } });
  revalidatePath("/directories");
}

export async function createSuperbillTemplate(formData: FormData) {
  const user = await requireUser(["ADMIN", "CLINICIAN", "BILLER"]);
  const name = required(formData, "name");

  const template = await prisma.superbillTemplate.create({
    data: { practiceId: user.practiceId, name },
  });

  await logAudit(user.practiceId, user.id, "CREATE_SUPERBILL_TEMPLATE", "SuperbillTemplate", template.id, name);
  revalidatePath("/directories");
  revalidatePath("/encounters");
}

export async function toggleSuperbillTemplateActive(templateId: string) {
  const user = await requireUser(["ADMIN", "CLINICIAN", "BILLER"]);
  const template = await prisma.superbillTemplate.findFirstOrThrow({
    where: { id: templateId, practiceId: user.practiceId },
  });
  await prisma.superbillTemplate.update({ where: { id: template.id }, data: { active: !template.active } });
  revalidatePath("/directories");
  revalidatePath("/encounters");
}

export async function addSuperbillTemplateItem(templateId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "CLINICIAN", "BILLER"]);
  const template = await prisma.superbillTemplate.findFirstOrThrow({
    where: { id: templateId, practiceId: user.practiceId },
  });

  const cptCode = required(formData, "cptCode");
  const description = required(formData, "description");
  const amount = Number(required(formData, "amount"));
  const modifiers = optional(formData, "modifiers");

  const count = await prisma.superbillTemplateItem.count({ where: { templateId: template.id } });

  await prisma.superbillTemplateItem.create({
    data: {
      templateId: template.id,
      cptCode,
      description,
      modifiers,
      amountCents: Math.round(amount * 100),
      order: count,
    },
  });

  revalidatePath("/directories");
  revalidatePath("/encounters");
}

export async function removeSuperbillTemplateItem(itemId: string, templateId: string) {
  const user = await requireUser(["ADMIN", "CLINICIAN", "BILLER"]);
  await prisma.superbillTemplate.findFirstOrThrow({ where: { id: templateId, practiceId: user.practiceId } });
  await prisma.superbillTemplateItem.deleteMany({ where: { id: itemId, templateId } });
  revalidatePath("/directories");
  revalidatePath("/encounters");
}
