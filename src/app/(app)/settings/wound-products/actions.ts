"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { PRODUCT_TYPES, UNITS } from "@/lib/wound-products";

const ROLES = ["ADMIN"];
const HERE = "/settings/wound-products";
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const back = (kind: "ok" | "error", message: string, tab = ""): never => redirect(`${HERE}?${tab ? `tab=${tab}&` : ""}${kind}=${encodeURIComponent(message.slice(0, 300))}`);

function readProduct(fd: FormData) {
  const name = str(fd, "name");
  if (!name) back("error", "Name the product.");
  const productType = str(fd, "productType");
  if (!(productType in PRODUCT_TYPES)) back("error", "Pick a product type.");
  const hcpcs = str(fd, "hcpcsCode").toUpperCase();
  if (hcpcs && !/^[A-Z][0-9]{4}$/.test(hcpcs)) back("error", "An HCPCS code is a letter and four digits (e.g. A6196).");
  const unit = str(fd, "unit") || "each";
  return { name: name.slice(0, 120), brand: str(fd, "brand").slice(0, 80) || null, productType, hcpcsCode: hcpcs || null, unit: UNITS.includes(unit) ? unit : unit.slice(0, 12), size: str(fd, "size").slice(0, 60) || null, instructions: str(fd, "instructions").slice(0, 400) || null };
}

export async function addProduct(fd: FormData) {
  const user = await requireUser(ROLES);
  const data = readProduct(fd);
  await prisma.woundProduct.create({ data: { practiceId: user.practiceId, ...data, sortOrder: 900 } });
  await logAudit(user.practiceId, user.id, "ADD_WOUND_PRODUCT", "WoundProduct", undefined, data.name);
  revalidatePath(HERE);
  back("ok", `${data.name} added.`);
}

export async function updateProduct(id: string, fd: FormData) {
  const user = await requireUser(ROLES);
  const p = await prisma.woundProduct.findFirst({ where: { id, practiceId: user.practiceId } });
  if (!p) back("error", "Product not found.");
  const data = readProduct(fd);
  await prisma.woundProduct.update({ where: { id }, data: { ...data, active: fd.get("active") === "on" } });
  revalidatePath(HERE);
  back("ok", `${data.name} saved.`);
}

export async function toggleProduct(id: string) {
  const user = await requireUser(ROLES);
  const p = await prisma.woundProduct.findFirst({ where: { id, practiceId: user.practiceId } });
  if (!p) back("error", "Product not found.");
  await prisma.woundProduct.update({ where: { id }, data: { active: !p!.active } });
  revalidatePath(HERE);
  redirect(HERE);
}

export async function addStep(fd: FormData) {
  const user = await requireUser(ROLES);
  const name = str(fd, "name");
  if (!name) back("error", "Name the step.", "steps");
  const types = fd.getAll("productTypes").map(String).filter((t) => t in PRODUCT_TYPES);
  await prisma.treatmentStep.create({ data: { practiceId: user.practiceId, name: name.slice(0, 80), productTypes: types.join(","), sortOrder: 900 } });
  revalidatePath(HERE);
  back("ok", `${name} added.`, "steps");
}

export async function saveSteps(fd: FormData) {
  const user = await requireUser(ROLES);
  const steps = await prisma.treatmentStep.findMany({ where: { practiceId: user.practiceId } });
  for (const s of steps) {
    if (!fd.has(`name_${s.id}`)) continue;
    const name = str(fd, `name_${s.id}`);
    if (!name) back("error", "Every step needs a name.", "steps");
    const order = Number(str(fd, `order_${s.id}`));
    const types = fd.getAll(`types_${s.id}`).map(String).filter((t) => t in PRODUCT_TYPES);
    await prisma.treatmentStep.update({ where: { id: s.id }, data: { name: name.slice(0, 80), productTypes: types.join(","), active: fd.get(`active_${s.id}`) === "on", sortOrder: Number.isFinite(order) ? Math.round(order) : s.sortOrder } });
  }
  await logAudit(user.practiceId, user.id, "UPDATE_TREATMENT_STEPS", "TreatmentStep", user.practiceId, `${steps.length} steps`);
  revalidatePath(HERE);
  back("ok", "Steps saved.", "steps");
}
