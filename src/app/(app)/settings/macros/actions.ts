"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { can, rolesFor } from "@/lib/permissions";
import { MACRO_SECTIONS } from "@/lib/macros";


const str = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);
function back(msg: { ok?: string; error?: string }): never {
  revalidatePath("/settings/macros");
  revalidatePath("/encounters", "layout");
  redirect(`/settings/macros?${msg.error ? `error=${encodeURIComponent(msg.error)}` : msg.ok ? `ok=${encodeURIComponent(msg.ok)}` : ""}`);
}

// Practice macros need the chart-edit permission plus admin; personal ones belong to whoever writes notes.
export async function saveMacro(macroId: string | null, fd: FormData) {
  const user = await requireUser(rolesFor("chart.edit"));
  const personal = fd.get("scope") === "PERSONAL";
  if (!personal && !can(user, "settings.admin")) back({ error: "Only an administrator can change the practice macros; save it as a personal macro instead." });
  const shortcut = str(fd, "shortcut", 40).toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!shortcut) back({ error: "Give the macro a shortcut (letters, numbers, - or _)." });
  const text = str(fd, "text", 4000);
  if (!text) back({ error: "Write the text the shortcut expands to." });
  const section = str(fd, "section", 20) in MACRO_SECTIONS ? str(fd, "section", 20) : "UNIVERSAL";
  const where = { practiceId: user.practiceId, userId: personal ? user.id : null, shortcut };
  const clash = await prisma.textMacro.findFirst({ where: { ...where, ...(macroId ? { NOT: { id: macroId } } : {}) } });
  if (clash) back({ error: `.${shortcut} already exists ${personal ? "in your macros" : "for the practice"}.` });
  if (macroId) {
    const m = await prisma.textMacro.findFirst({ where: { id: macroId, practiceId: user.practiceId } });
    if (!m || (m.userId && m.userId !== user.id)) back({ error: "Macro not found." });
    await prisma.textMacro.update({ where: { id: macroId }, data: { shortcut, text, section, userId: personal ? user.id : null } });
  } else {
    await prisma.textMacro.create({ data: { ...where, text, section, createdById: user.id } });
  }
  await logAudit(user.practiceId, user.id, "SAVE_MACRO", "TextMacro", macroId ?? undefined, `.${shortcut}${personal ? " (personal)" : ""}`);
  back({ ok: `.${shortcut} saved.` });
}

export async function deleteMacro(macroId: string) {
  const user = await requireUser(rolesFor("chart.edit"));
  const m = await prisma.textMacro.findFirst({ where: { id: macroId, practiceId: user.practiceId } });
  if (!m) back({ error: "Macro not found." });
  if (!m!.userId && !can(user, "settings.admin")) back({ error: "Only an administrator can remove a practice macro." });
  if (m!.userId && m!.userId !== user.id) back({ error: "That is someone else's personal macro." });
  await prisma.textMacro.delete({ where: { id: m!.id } });
  back({ ok: `.${m!.shortcut} removed.` });
}

// Copy the practice set into a user's personal macros (when a provider joins).
export async function importPracticeMacros() {
  const user = await requireUser(rolesFor("chart.edit"));
  const practice = await prisma.textMacro.findMany({ where: { practiceId: user.practiceId, userId: null } });
  const mine = new Set((await prisma.textMacro.findMany({ where: { practiceId: user.practiceId, userId: user.id }, select: { shortcut: true } })).map((m) => m.shortcut));
  let n = 0;
  for (const m of practice) {
    if (mine.has(m.shortcut)) continue;
    await prisma.textMacro.create({ data: { practiceId: user.practiceId, userId: user.id, shortcut: m.shortcut, text: m.text, section: m.section, createdById: user.id } });
    n++;
  }
  back({ ok: `${n} macro${n === 1 ? "" : "s"} copied to your personal set.` });
}
