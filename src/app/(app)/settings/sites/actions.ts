"use server";

import { rolesFor } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { US_STATES } from "@/lib/format";
import { placeOfServiceLabel } from "@/lib/superbill";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function back(tab: "sites" | "types", msg: { error?: string; ok?: string }, extra = ""): never {
  revalidatePath("/settings/sites");
  redirect(`/settings/sites?tab=${tab}${extra}&${msg.error ? `error=${encodeURIComponent(msg.error.slice(0, 300))}` : `ok=${encodeURIComponent(msg.ok ?? "Saved.")}`}`);
}

// ---- Sites of service ----

async function readSite(fd: FormData, practiceId: string, stop: (m: string) => never) {
  const name = str(fd, "name").slice(0, 120);
  if (!name) stop("Name the site of service.");
  const serviceTypeId = str(fd, "serviceTypeId");
  if (serviceTypeId && !(await prisma.serviceType.findFirst({ where: { id: serviceTypeId, practiceId } }))) stop("Service type not found.");
  const state = str(fd, "state").toUpperCase();
  if (state && !US_STATES.includes(state)) stop("Pick a state from the list.");
  const zip = str(fd, "zip");
  if (zip && !/^\d{5}(-\d{4})?$/.test(zip)) stop("ZIP is 5 digits, or 9 as 12345-6789.");
  const pos = str(fd, "placeOfService");
  if (pos && !(pos in placeOfServiceLabel)) stop("Pick a place of service from the list.");
  const npi = str(fd, "npi");
  const groupNpi = str(fd, "groupNpi");
  if (npi && !/^\d{10}$/.test(npi)) stop("The facility NPI is 10 digits.");
  if (groupNpi && !/^\d{10}$/.test(groupNpi)) stop("The group NPI is 10 digits.");
  const taxId = str(fd, "taxId");
  if (taxId && !/^\d{2}-?\d{7}$/.test(taxId)) stop("The tax ID is 9 digits (12-3456789).");
  const email = str(fd, "email");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) stop("That email address doesn't look right.");
  return {
    name,
    serviceTypeId: serviceTypeId || null,
    addressLine1: str(fd, "addressLine1").slice(0, 120) || null,
    addressLine2: str(fd, "addressLine2").slice(0, 120) || null,
    city: str(fd, "city").slice(0, 80) || null,
    state: state || null,
    zip: zip || null,
    phone: str(fd, "phone").slice(0, 30) || null,
    fax: str(fd, "fax").slice(0, 30) || null,
    email: email || null,
    placeOfService: pos || null,
    taxId: taxId || null,
    npi: npi || null,
    groupNpi: groupNpi || null,
    ptan: str(fd, "ptan").slice(0, 20) || null,
    facilityBilling: fd.get("facilityBilling") === "on",
    active: fd.get("active") === "on",
  };
}

export async function addSite(fd: FormData) {
  const user = await requireUser(rolesFor("settings.admin"));
  const data = await readSite(fd, user.practiceId, (m) => back("sites", { error: m }, "&add=1"));
  if (await prisma.location.findFirst({ where: { practiceId: user.practiceId, name: data.name } })) back("sites", { error: `A site called “${data.name}” already exists.` }, "&add=1");
  const site = await prisma.location.create({ data: { ...data, practiceId: user.practiceId } });
  await logAudit(user.practiceId, user.id, "ADD_SITE", "Location", site.id, data.name);
  back("sites", { ok: `${data.name} added.` });
}

export async function updateSite(siteId: string, fd: FormData) {
  const user = await requireUser(rolesFor("settings.admin"));
  const site = await prisma.location.findFirst({ where: { id: siteId, practiceId: user.practiceId } });
  if (!site) back("sites", { error: "Site not found." });
  const data = await readSite(fd, user.practiceId, (m) => back("sites", { error: m }, `&edit=${siteId}`));
  if (await prisma.location.findFirst({ where: { practiceId: user.practiceId, name: data.name, id: { not: site!.id } } })) back("sites", { error: `Another site is already called “${data.name}”.` }, `&edit=${siteId}`);
  await prisma.location.update({ where: { id: site!.id }, data });
  await logAudit(user.practiceId, user.id, "UPDATE_SITE", "Location", site!.id, data.name);
  back("sites", { ok: `${data.name} saved.` });
}

// ---- Service types ----

export async function saveServiceType(typeId: string | null, fd: FormData) {
  const user = await requireUser(rolesFor("settings.admin"));
  const name = str(fd, "name").slice(0, 80);
  if (!name) back("types", { error: "Name the service type." });
  if (await prisma.serviceType.findFirst({ where: { practiceId: user.practiceId, name, ...(typeId ? { id: { not: typeId } } : {}) } })) back("types", { error: `“${name}” already exists.` });
  if (typeId) {
    const row = await prisma.serviceType.findFirst({ where: { id: typeId, practiceId: user.practiceId } });
    if (!row) back("types", { error: "Service type not found." });
    await prisma.serviceType.update({ where: { id: row!.id }, data: { name } });
  } else {
    await prisma.serviceType.create({ data: { practiceId: user.practiceId, name } });
  }
  await logAudit(user.practiceId, user.id, typeId ? "UPDATE_SERVICE_TYPE" : "ADD_SERVICE_TYPE", "ServiceType", typeId ?? undefined, name);
  back("types", { ok: `${name} saved.` });
}

export async function deleteServiceType(typeId: string) {
  const user = await requireUser(rolesFor("settings.admin"));
  const row = await prisma.serviceType.findFirst({ where: { id: typeId, practiceId: user.practiceId }, include: { _count: { select: { locations: true } } } });
  if (!row) back("types", { error: "Service type not found." });
  if (row!._count.locations > 0) back("types", { error: `${row!.name} is used by ${row!._count.locations} site${row!._count.locations === 1 ? "" : "s"}. Move them to another service type first.` });
  await prisma.serviceType.delete({ where: { id: row!.id } });
  await logAudit(user.practiceId, user.id, "DELETE_SERVICE_TYPE", "ServiceType", row!.id, row!.name);
  back("types", { ok: `${row!.name} deleted.` });
}
