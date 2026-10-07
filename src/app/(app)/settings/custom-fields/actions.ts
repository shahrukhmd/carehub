"use server";

import { rolesFor } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { customFieldKey, customFieldTypeLabel, customOptions } from "@/lib/custom-fields";

const MAX_FIELDS = 40;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function back(msg: { error?: string; ok?: string }): never {
  revalidatePath("/settings/custom-fields");
  redirect(`/settings/custom-fields?${msg.error ? `error=${encodeURIComponent(msg.error)}` : `ok=${encodeURIComponent(msg.ok ?? "Saved.")}`}`);
}

function readField(fd: FormData) {
  const label = str(fd, "label").slice(0, 80);
  if (!label) back({ error: "Give the field a label." });
  const type = str(fd, "type");
  if (!(type in customFieldTypeLabel)) back({ error: "Pick the kind of field." });
  const options = customOptions(str(fd, "options")).slice(0, 60);
  if (type === "SELECT" && options.length < 2) back({ error: "A dropdown list needs at least two choices, one per line." });
  const order = Number(str(fd, "order"));
  return {
    label,
    type,
    options: type === "SELECT" ? options.join("\n") : null,
    helpText: str(fd, "helpText").slice(0, 160) || null,
    required: fd.get("required") === "on" && type !== "CHECKBOX",
    order: Number.isInteger(order) ? Math.max(0, Math.min(order, 999)) : 0,
  };
}

export async function addCustomField(fd: FormData) {
  const user = await requireUser(rolesFor("settings.admin"));
  const data = readField(fd);
  if ((await prisma.customField.count({ where: { practiceId: user.practiceId } })) >= MAX_FIELDS) back({ error: `A practice can have up to ${MAX_FIELDS} custom fields.` });
  // The key never changes once answers are stored under it, so a relabelled field keeps its answers.
  let key = customFieldKey(data.label) || "field";
  const taken = new Set((await prisma.customField.findMany({ where: { practiceId: user.practiceId }, select: { key: true } })).map((f) => f.key));
  for (let n = 2; taken.has(key); n++) key = `${customFieldKey(data.label) || "field"}_${n}`;
  const row = await prisma.customField.create({ data: { ...data, key, practiceId: user.practiceId } });
  await logAudit(user.practiceId, user.id, "ADD_CUSTOM_FIELD", "CustomField", row.id, data.label);
  back({ ok: `“${data.label}” added to the patient registration form.` });
}

export async function updateCustomField(fieldId: string, fd: FormData) {
  const user = await requireUser(rolesFor("settings.admin"));
  const row = await prisma.customField.findFirst({ where: { id: fieldId, practiceId: user.practiceId } });
  if (!row) back({ error: "Field not found." });
  const data = readField(fd);
  // Answers already stored would stop making sense under another kind of field.
  if (data.type !== row!.type) back({ error: "The kind of field can't be changed once it exists. Turn this one off and add a new field." });
  await prisma.customField.update({ where: { id: row!.id }, data });
  await logAudit(user.practiceId, user.id, "UPDATE_CUSTOM_FIELD", "CustomField", row!.id, data.label);
  back({ ok: `“${data.label}” updated.` });
}

export async function toggleCustomField(fieldId: string) {
  const user = await requireUser(rolesFor("settings.admin"));
  const row = await prisma.customField.findFirst({ where: { id: fieldId, practiceId: user.practiceId } });
  if (!row) back({ error: "Field not found." });
  await prisma.customField.update({ where: { id: row!.id }, data: { active: !row!.active } });
  await logAudit(user.practiceId, user.id, row!.active ? "DISABLE_CUSTOM_FIELD" : "ENABLE_CUSTOM_FIELD", "CustomField", row!.id, row!.label);
  back({ ok: row!.active ? `“${row!.label}” turned off. Answers already entered are kept.` : `“${row!.label}” turned back on.` });
}
