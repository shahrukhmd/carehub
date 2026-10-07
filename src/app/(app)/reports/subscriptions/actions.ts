"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { CADENCES, RANGE_PRESETS, reportDef } from "@/lib/report-catalog";

const str = (fd: FormData, k: string, max = 120) => String(fd.get(k) ?? "").trim().slice(0, max);
function back(msg: { ok?: string; error?: string }): never {
  revalidatePath("/reports/subscriptions");
  redirect(`/reports/subscriptions?${msg.error ? `error=${encodeURIComponent(msg.error)}` : msg.ok ? `ok=${encodeURIComponent(msg.ok)}` : ""}`);
}

// A saved view (cadence NONE) or a scheduled delivery of one report for the signed-in user.
export async function saveSubscription(fd: FormData) {
  const user = await requireUser();
  const reportKey = str(fd, "reportKey", 60);
  const def = reportDef(reportKey);
  if (!def) back({ error: "Pick a report." });
  if (!can(user, def!.permission)) back({ error: "You cannot run that report." });
  const cadence = str(fd, "cadence", 10);
  if (!(cadence === "NONE" || cadence in CADENCES)) back({ error: "Pick how often." });
  const rangePreset = str(fd, "rangePreset", 20) in RANGE_PRESETS ? str(fd, "rangePreset", 20) : "LAST_7";
  const name = str(fd, "name", 80) || `${def!.label} · ${RANGE_PRESETS[rangePreset].label}`;
  const s = await prisma.reportSubscription.create({ data: { practiceId: user.practiceId, userId: user.id, reportKey, name, cadence, rangePreset, active: true } });
  await logAudit(user.practiceId, user.id, "SAVE_REPORT_VIEW", "ReportSubscription", s.id, `${reportKey} ${cadence}`);
  back({ ok: cadence === "NONE" ? "Saved view added." : `Subscribed: ${def!.label}, ${CADENCES[cadence].toLowerCase()}.` });
}

export async function deleteSubscription(id: string) {
  const user = await requireUser();
  await prisma.reportSubscription.deleteMany({ where: { id, userId: user.id, practiceId: user.practiceId } });
  back({ ok: "Removed." });
}

export async function toggleSubscription(id: string) {
  const user = await requireUser();
  const s = await prisma.reportSubscription.findFirst({ where: { id, userId: user.id, practiceId: user.practiceId } });
  if (!s) back({ error: "Not found." });
  await prisma.reportSubscription.update({ where: { id: s!.id }, data: { active: !s!.active } });
  back({ ok: s!.active ? "Paused." : "Resumed." });
}
