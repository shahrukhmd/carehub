"use server";

import { insuranceDisplayName } from "@/lib/format";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { ensureEnrollmentsForProvider, lookupNppes } from "@/lib/credentialing";
import { OPEN_ENROLLMENT_STATUSES } from "@/lib/format";
import { allowed, rolesFor } from "@/lib/permissions";
import { canWorkTeam } from "@/lib/gateway";

function required(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function optional(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

const INSURANCE_ROLES = rolesFor("settings.insurance");

function flag(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function optionalNumber(formData: FormData, key: string) {
  const raw = String(formData.get(key) ?? "").trim();
  const value = Number(raw);
  return raw !== "" && Number.isFinite(value) ? value : null;
}

// One screen for every insurance, whatever its type.
export async function saveInsurance(payerId: string | null, formData: FormData) {
  const user = await requireUser(INSURANCE_ROLES);
  const existing = payerId
    ? await prisma.payer.findFirstOrThrow({ where: { id: payerId, practiceId: user.practiceId } })
    : null;

  for (const key of ["alternatePayerId", "parentPayerId"]) {
    const ref = optional(formData, key);
    if (ref) {
      if (ref === existing?.id) throw new Error("An insurance cannot reference itself");
      await prisma.payer.findFirstOrThrow({ where: { id: ref, practiceId: user.practiceId } });
    }
  }
  const unit = String(formData.get("timelyFilingUnit") ?? "DAYS");
  const filingLimit = optionalNumber(formData, "timelyFilingLimit");
  const alertDays = optionalNumber(formData, "timelyFilingAlertDays");
  const appealDays = optionalNumber(formData, "appealLimitDays");
  const outstandingDays = optionalNumber(formData, "outstandingDays");

  // The display name follows the name and type until someone types their own; a hand-typed one is kept.
  const name = required(formData, "name");
  const insuranceType = optional(formData, "insuranceType");
  const typed = optional(formData, "displayName")?.replace(/\s+/g, " ").slice(0, 160) ?? null;
  const previousAuto = existing ? insuranceDisplayName(existing.name, existing.insuranceType) : null;
  const displayName = !typed || typed === previousAuto || typed === existing?.name ? insuranceDisplayName(name, insuranceType) : typed;

  const data = {
    name,
    displayName,
    payerCode: optional(formData, "payerCode"),
    eraPayerId: optional(formData, "eraPayerId"),
    eligibilityPayerId: optional(formData, "eligibilityPayerId"),
    alternatePayerId: optional(formData, "alternatePayerId"),
    parentPayerId: optional(formData, "parentPayerId"),
    insuranceType,
    portalName: optional(formData, "portalName"),
    addressLine1: optional(formData, "addressLine1"),
    addressLine2: optional(formData, "addressLine2"),
    city: optional(formData, "city"),
    state: optional(formData, "state"),
    zip: optional(formData, "zip"),
    phone: optional(formData, "phone"),
    fax: optional(formData, "fax"),
    contactFirstName: optional(formData, "contactFirstName"),
    contactLastName: optional(formData, "contactLastName"),
    contactPhone: optional(formData, "contactPhone"),
    contactEmail: optional(formData, "contactEmail"),
    facilityBilling: flag(formData, "facilityBilling"),
    useGroupNpi: flag(formData, "useGroupNpi"),
    requiresVisitReview: flag(formData, "requiresVisitReview"),
    timelyFilingLimit: filingLimit === null ? null : Math.round(filingLimit),
    timelyFilingUnit: ["DAYS", "MONTHS", "YEARS"].includes(unit) ? unit : "DAYS",
    timelyFilingAlertDays: alertDays === null ? null : Math.round(alertDays),
    appealLimitDays: appealDays === null || appealDays <= 0 ? null : Math.round(appealDays),
    outstandingDays: outstandingDays === null || outstandingDays <= 0 ? null : Math.round(outstandingDays),
    reimbursementRate: optionalNumber(formData, "reimbursementRate"),
    notes: optional(formData, "notes"),
  };

  const payer = existing
    ? await prisma.payer.update({ where: { id: existing.id }, data })
    : await prisma.payer.create({ data: { practiceId: user.practiceId, ...data } });

  await logAudit(user.practiceId, user.id, existing ? "UPDATE_PAYER" : "CREATE_PAYER", "Payer", payer.id, data.name);
  revalidatePath("/settings/directories");
  revalidatePath("/patients/new");
  revalidatePath("/credentialing", "layout");
  // Added from credentialing: on to the payer lines, where the new insurance is linked to a group.
  if (formData.get("from") === "credentialing") redirect("/credentialing?tab=board&view=setup");
  redirect("/settings/directories?section=insurance");
}

export async function togglePayerActive(payerId: string) {
  const user = await requireUser(INSURANCE_ROLES);
  const payer = await prisma.payer.findFirstOrThrow({ where: { id: payerId, practiceId: user.practiceId } });
  await prisma.payer.update({ where: { id: payer.id }, data: { active: !payer.active } });
  revalidatePath("/settings/directories");
}

export async function createBillingProvider(formData: FormData) {
  const user = await requireUser(rolesFor("payments.take"));
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
  revalidatePath("/settings/directories");
  revalidatePath("/credentialing");
  revalidatePath("/encounters");
}

const PROVIDER_ROLES = rolesFor("settings.providers");

function displayName(last: string, first: string, middle: string | null, suffix: string | null) {
  return `${last}${suffix ? ` ${suffix}` : ""}, ${first}${middle ? ` ${middle}` : ""}`;
}

type Actor = { id: string; practiceId: string };

// One "Add Provider" screen: a provider can hold several roles at once, and fields
// that belong to a role are only kept while that role is selected.
export async function saveProvider(providerId: string | null, formData: FormData) {
  const user = await requireUser(PROVIDER_ROLES);
  const provider = await writeProvider(user, providerId, formData);
  revalidatePath("/settings/directories");
  revalidatePath("/credentialing", "layout");
  // Added from credentialing: on to the provider's credentialing file (documents, payer enrollments, numbers).
  if (formData.get("from") === "credentialing") redirect(provider.isRendering ? `/credentialing/providers/${provider.id}` : "/credentialing");
  redirect("/settings/directories?section=providers");
}

// Validates and saves the provider form (the directory page and the referral popup both use it). Problems throw.
async function writeProvider(user: Actor, providerId: string | null, formData: FormData) {
  const existing = providerId
    ? await prisma.renderingProvider.findFirstOrThrow({ where: { id: providerId, practiceId: user.practiceId } })
    : null;

  const roles = {
    isReferring: flag(formData, "isReferring"),
    isClinician: flag(formData, "isClinician"),
    isRendering: flag(formData, "isRendering"),
    isSupervising: flag(formData, "isSupervising"),
  };
  if (!Object.values(roles).some(Boolean)) throw new Error("Choose at least one provider type");
  const prescribes = roles.isClinician || roles.isRendering || roles.isSupervising;

  const npi = optional(formData, "npi");
  if (npi && !/^\d{10}$/.test(npi)) throw new Error("NPI must be exactly 10 digits");

  const userId = roles.isClinician ? optional(formData, "userId") : null;
  if (userId && userId !== existing?.userId) {
    await prisma.user.findFirstOrThrow({
      where: { id: userId, practiceId: user.practiceId, renderingProvider: { is: null } },
    });
  }
  const supervisingProviderId = roles.isRendering ? optional(formData, "supervisingProviderId") : null;
  if (supervisingProviderId) {
    if (supervisingProviderId === existing?.id) throw new Error("A provider cannot supervise themselves");
    await prisma.renderingProvider.findFirstOrThrow({
      where: { id: supervisingProviderId, practiceId: user.practiceId, isSupervising: true },
    });
  }
  // The BD rep who owns a referring physician / source: someone with the business development role in this practice.
  const bdOwnerId = roles.isReferring ? optional(formData, "bdOwnerId") : null;
  if (bdOwnerId && bdOwnerId !== existing?.bdOwnerId) {
    const rep = await prisma.membership.findFirst({ where: { practiceId: user.practiceId, userId: bdOwnerId, role: "BD" }, select: { id: true } });
    if (!rep) throw new Error("Pick a BD owner from this practice's business development team");
  }

  // A referring source can be a company or group (hospital, facility, agency): one name, no personal name parts.
  const isOrganization = roles.isReferring && formData.get("entityType") === "ORGANIZATION";
  const firstName = isOrganization ? null : required(formData, "firstName");
  const lastName = isOrganization ? null : required(formData, "lastName");
  const middleName = isOrganization ? null : optional(formData, "middleName");
  const suffix = isOrganization ? null : optional(formData, "suffix");
  const orgName = isOrganization ? required(formData, "organizationName").replace(/\s+/g, " ") : null;

  const data = {
    ...roles,
    isOrganization,
    bdOwnerId,
    name: orgName ?? displayName(lastName!, firstName!, middleName, suffix),
    title: isOrganization ? null : optional(formData, "title"),
    firstName,
    middleName,
    lastName,
    suffix,
    licenseNumber: optional(formData, "licenseNumber"),
    licenseState: optional(formData, "licenseState"),
    npi,
    tin: optional(formData, "tin"),
    addressLine1: optional(formData, "addressLine1"),
    addressLine2: optional(formData, "addressLine2"),
    city: optional(formData, "city"),
    state: optional(formData, "state"),
    zip: optional(formData, "zip"),
    phone: optional(formData, "phone"),
    fax: optional(formData, "fax"),
    pager: optional(formData, "pager"),
    email: optional(formData, "email"),
    credential: optional(formData, "credential"),
    signatureOnFile: flag(formData, "signatureOnFile"),
    // Credentialing identifiers are only on the form for rendering providers; keep them otherwise.
    taxonomy: roles.isRendering ? optional(formData, "taxonomy") : existing?.taxonomy ?? null,
    caqhId: roles.isRendering ? optional(formData, "caqhId") : existing?.caqhId ?? null,
    userId,
    primarySupervising: roles.isSupervising && flag(formData, "primarySupervising"),
    groupName: roles.isRendering ? optional(formData, "groupName") : null,
    specialty: optional(formData, "specialty"),
    acceptsAssignment: roles.isRendering && flag(formData, "acceptsAssignment"),
    requiresSupervision: roles.isRendering && flag(formData, "requiresSupervision"),
    supervisingProviderId,
    deaNumber: prescribes ? optional(formData, "deaNumber") : null,
    ePrescribe: prescribes && flag(formData, "ePrescribe"),
    interfaceId: prescribes ? optional(formData, "interfaceId") : null,
  };

  const provider = existing
    ? await prisma.renderingProvider.update({ where: { id: existing.id }, data })
    : await prisma.renderingProvider.create({ data: { practiceId: user.practiceId, ...data } });

  // Dropping the rendering role takes the provider off the credentialing boards;
  // regaining it reopens those rows, and new payer lines get a row as usual.
  if (existing?.isRendering && !provider.isRendering) {
    await prisma.providerEnrollment.updateMany({
      where: { renderingProviderId: provider.id, status: { in: OPEN_ENROLLMENT_STATUSES } },
      data: { status: "NOT_APPLICABLE", statusChangedAt: new Date(), notes: "Closed: provider is no longer a rendering provider" },
    });
  } else if (existing && !existing.isRendering && provider.isRendering) {
    await prisma.providerEnrollment.updateMany({
      where: { renderingProviderId: provider.id, status: "NOT_APPLICABLE" },
      data: { status: "NOT_STARTED", statusChangedAt: new Date(), notes: null },
    });
  }
  const opened = provider.isRendering ? await ensureEnrollmentsForProvider(provider.id) : 0;

  await logAudit(
    user.practiceId,
    user.id,
    existing ? "UPDATE_PROVIDER" : "CREATE_PROVIDER",
    "RenderingProvider",
    provider.id,
    `${data.name}${opened ? `; ${opened} enrollment row(s) opened` : ""}`
  );
  return provider;
}

export async function toggleProviderActive(providerId: string) {
  const user = await requireUser(PROVIDER_ROLES);
  const provider = await prisma.renderingProvider.findFirstOrThrow({
    where: { id: providerId, practiceId: user.practiceId },
  });
  const active = provider.status !== "ACTIVE";
  await prisma.renderingProvider.update({
    where: { id: provider.id },
    data: { status: active ? "ACTIVE" : "TERMED", termDate: active ? null : new Date() },
  });
  if (active && provider.isRendering) await ensureEnrollmentsForProvider(provider.id);
  await logAudit(user.practiceId, user.id, active ? "REACTIVATE_PROVIDER" : "DEACTIVATE_PROVIDER", "RenderingProvider", provider.id);
  revalidatePath("/settings/directories");
  revalidatePath("/credentialing", "layout");
}

// Used by the provider form's "NPI Registry" button; NPPES blocks direct browser calls.
export async function lookupNpi(npi: string) {
  await requireUser(PROVIDER_ROLES);
  return nppesLookup(npi);
}

// Who may add a referring physician / source from a gateway case: provider admins, and the data entry team, who
// register referrals.
async function requireReferrerAdder() {
  const user = await requireUser();
  return allowed(user, PROVIDER_ROLES) || canWorkTeam(user.role, "DATA_ENTRY") ? user : null;
}

// "+ Add new" in a gateway case's Referring physician / source list: the provider form in a popup, always as a
// referring-only provider (person, or company / group). Returns the new entry so the list can select it.
export async function addReferringProvider(formData: FormData): Promise<{ provider?: { id: string; name: string }; error?: string }> {
  const user = await requireReferrerAdder();
  if (!user) return { error: "Your role can't add referring physicians or sources" };
  const fd = new FormData();
  for (const [key, value] of formData) if (!["isClinician", "isRendering", "isSupervising"].includes(key)) fd.append(key, value);
  fd.set("isReferring", "on");
  try {
    const provider = await writeProvider(user, null, fd);
    revalidatePath("/settings/directories");
    return { provider: { id: provider.id, name: provider.name } };
  } catch (err) {
    const label: Record<string, string> = { firstName: "First name", lastName: "Last name", organizationName: "Name" };
    return {
      error: err instanceof Error ? err.message.replace(/^(\w+) is required$/, (_, key: string) => `${label[key] ?? key} is required`) : "Could not add the referring physician / source",
    };
  }
}

export async function lookupReferrerNpi(npi: string) {
  if (!(await requireReferrerAdder())) return { error: "Your role can't look up providers" };
  return nppesLookup(npi);
}

async function nppesLookup(npi: string) {
  if (!/^\d{10}$/.test(npi)) return { error: "Enter a 10-digit NPI first" };
  try {
    const [match] = await lookupNppes({ npi });
    return match ? { match } : { error: `NPI ${npi} was not found in the NPPES registry` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "NPPES lookup failed" };
  }
}

export async function toggleBillingProviderActive(providerId: string) {
  const user = await requireUser(rolesFor("payments.take"));
  const provider = await prisma.billingProvider.findFirstOrThrow({
    where: { id: providerId, practiceId: user.practiceId },
  });
  await prisma.billingProvider.update({ where: { id: provider.id }, data: { active: !provider.active } });
  revalidatePath("/settings/directories");
}

export async function createSuperbillTemplate(formData: FormData) {
  const user = await requireUser(rolesFor("billing.templates"));
  const name = required(formData, "name");

  const template = await prisma.superbillTemplate.create({
    data: { practiceId: user.practiceId, name },
  });

  await logAudit(user.practiceId, user.id, "CREATE_SUPERBILL_TEMPLATE", "SuperbillTemplate", template.id, name);
  revalidatePath("/settings/directories");
  revalidatePath("/encounters");
}

export async function toggleSuperbillTemplateActive(templateId: string) {
  const user = await requireUser(rolesFor("billing.templates"));
  const template = await prisma.superbillTemplate.findFirstOrThrow({
    where: { id: templateId, practiceId: user.practiceId },
  });
  await prisma.superbillTemplate.update({ where: { id: template.id }, data: { active: !template.active } });
  revalidatePath("/settings/directories");
  revalidatePath("/encounters");
}

export async function addSuperbillTemplateItem(templateId: string, formData: FormData) {
  const user = await requireUser(rolesFor("billing.templates"));
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

  revalidatePath("/settings/directories");
  revalidatePath("/encounters");
}

export async function removeSuperbillTemplateItem(itemId: string, templateId: string) {
  const user = await requireUser(rolesFor("billing.templates"));
  await prisma.superbillTemplate.findFirstOrThrow({ where: { id: templateId, practiceId: user.practiceId } });
  await prisma.superbillTemplateItem.deleteMany({ where: { id: itemId, templateId } });
  revalidatePath("/settings/directories");
  revalidatePath("/encounters");
}

// ---- Practice code lists (superbill favorites & fee schedule) ----

export async function savePracticeCode(formData: FormData) {
  const user = await requireUser(rolesFor("codes.library"));
  const type = formData.get("type") === "CPT" ? "CPT" : "ICD10";
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const description = String(formData.get("description") ?? "").trim();
  const valid = type === "CPT" ? /^[A-Z0-9]{5}$/.test(code) : /^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/.test(code);
  if (!valid || !description) throw new Error("Enter a valid code and description");
  const feeRaw = String(formData.get("fee") ?? "").replace(/[$,\s]/g, "");
  const feeCents = feeRaw ? Math.round(Number(feeRaw) * 100) : null;
  if (feeCents !== null && (!Number.isFinite(feeCents) || feeCents < 0)) throw new Error("Invalid fee");
  const data = {
    description,
    category: String(formData.get("category") ?? "").trim() || null,
    feeCents: type === "CPT" ? feeCents : null,
    modifiers: type === "CPT" ? String(formData.get("modifiers") ?? "").trim().toUpperCase() || null : null,
    active: true,
  };
  await prisma.practiceCode.upsert({
    where: { practiceId_type_code: { practiceId: user.practiceId, type, code } },
    create: { practiceId: user.practiceId, type, code, ...data },
    update: data,
  });
  revalidatePath("/settings/directories");
}

export async function togglePracticeCode(codeId: string) {
  const user = await requireUser(rolesFor("codes.library"));
  const code = await prisma.practiceCode.findFirst({ where: { id: codeId, practiceId: user.practiceId } });
  if (!code) throw new Error("Code not found");
  await prisma.practiceCode.update({ where: { id: code.id }, data: { active: !code.active } });
  revalidatePath("/settings/directories");
}
