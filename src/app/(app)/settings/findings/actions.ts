"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { rolesFor } from "@/lib/permissions";
import { DEFAULT_PHRASES, PHRASE_KINDS, SYSTEMS } from "@/lib/findings";

const str = (fd: FormData, k: string, max = 600) => String(fd.get(k) ?? "").trim().slice(0, max);
function back(msg: { ok?: string; error?: string }, kind?: string): never {
  revalidatePath("/settings/findings");
  revalidatePath("/encounters", "layout");
  const q = new URLSearchParams();
  if (kind) q.set("kind", kind);
  if (msg.error) q.set("error", msg.error);
  if (msg.ok) q.set("ok", msg.ok);
  redirect(`/settings/findings${q.size ? `?${q}` : ""}`);
}

export async function savePhrase(id: string | null, fd: FormData) {
  const user = await requireUser(rolesFor("settings.admin"));
  const kind = str(fd, "kind", 10);
  if (!(kind in PHRASE_KINDS)) back({ error: "Pick ROS or exam." });
  const system = str(fd, "system", 40);
  if (!(SYSTEMS as readonly string[]).includes(system)) back({ error: "Pick a body system." }, kind);
  const text = str(fd, "text");
  if (!text) back({ error: "Write the phrase." }, kind);
  const normal = fd.get("normal") === "1";
  const sortOrder = Number(str(fd, "sortOrder", 5)) || 0;
  if (normal) {
    // One normal statement per system: the new one replaces the old.
    await prisma.findingPhrase.updateMany({ where: { practiceId: user.practiceId, kind, system, normal: true, ...(id ? { NOT: { id } } : {}) }, data: { normal: false } });
  }
  if (id) {
    const r = await prisma.findingPhrase.updateMany({ where: { id, practiceId: user.practiceId }, data: { kind, system, text, normal, sortOrder } });
    if (!r.count) back({ error: "Phrase not found." }, kind);
  } else {
    await prisma.findingPhrase.create({ data: { practiceId: user.practiceId, kind, system, text, normal, sortOrder } });
  }
  await logAudit(user.practiceId, user.id, "SAVE_FINDING_PHRASE", "FindingPhrase", id ?? undefined, `${kind} ${system}: ${text.slice(0, 80)}`);
  back({ ok: "Phrase saved." }, kind);
}

export async function deletePhrase(id: string, fd: FormData) {
  const user = await requireUser(rolesFor("settings.admin"));
  const r = await prisma.findingPhrase.deleteMany({ where: { id, practiceId: user.practiceId } });
  back(r.count ? { ok: "Phrase removed." } : { error: "Phrase not found." }, str(fd, "kind", 10) || undefined);
}

// Put the standard set back (keeps phrases the practice added that are not in the standard set).
export async function restoreDefaults(fd: FormData) {
  const user = await requireUser(rolesFor("settings.admin"));
  const kind = str(fd, "kind", 10);
  if (!(kind in PHRASE_KINDS)) back({ error: "Pick ROS or exam." });
  const existing = new Set((await prisma.findingPhrase.findMany({ where: { practiceId: user.practiceId, kind }, select: { text: true } })).map((p) => p.text));
  const rows = DEFAULT_PHRASES[kind].filter((r) => !existing.has(r.text));
  if (rows.length) await prisma.findingPhrase.createMany({ data: rows.map((r, i) => ({ practiceId: user.practiceId, kind, system: r.system, text: r.text, normal: r.normal, sortOrder: 100 + i })) });
  // A restored normal statement must be the only normal one for its system.
  for (const r of rows.filter((x) => x.normal)) await prisma.findingPhrase.updateMany({ where: { practiceId: user.practiceId, kind, system: r.system, normal: true, NOT: { text: r.text } }, data: { normal: false } });
  await logAudit(user.practiceId, user.id, "RESTORE_FINDING_PHRASES", "FindingPhrase", undefined, `${kind}: ${rows.length} restored`);
  back({ ok: `${rows.length} standard phrase${rows.length === 1 ? "" : "s"} restored.` }, kind);
}
