"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { rolesFor } from "@/lib/permissions";
import { MONITOR_CHECKS, runMonitoring } from "@/lib/report-catalog";

function back(msg: { ok?: string; error?: string }): never {
  revalidatePath("/settings/monitoring");
  redirect(`/settings/monitoring?${msg.error ? `error=${encodeURIComponent(msg.error)}` : msg.ok ? `ok=${encodeURIComponent(msg.ok)}` : ""}`);
}

// One form saves every rule: on/off, threshold, recipients.
export async function saveMonitoringRules(fd: FormData) {
  const user = await requireUser(rolesFor("settings.admin"));
  let n = 0;
  for (const check of MONITOR_CHECKS) {
    const active = fd.get(`active:${check.key}`) === "on";
    const threshold = Math.max(1, Math.round(Number(fd.get(`threshold:${check.key}`)) || check.defaultThreshold));
    const recipients = String(fd.get(`recipients:${check.key}`) ?? "").trim().slice(0, 500).toLowerCase() || null;
    const existing = await prisma.monitoringRule.findFirst({ where: { practiceId: user.practiceId, checkKey: check.key } });
    if (existing) await prisma.monitoringRule.update({ where: { id: existing.id }, data: { active, threshold, recipients } });
    else if (active) await prisma.monitoringRule.create({ data: { practiceId: user.practiceId, checkKey: check.key, active, threshold, recipients } });
    n++;
  }
  await logAudit(user.practiceId, user.id, "SAVE_MONITORING", "MonitoringRule", undefined, `${n} rules`);
  back({ ok: "Monitoring rules saved." });
}

export async function runMonitoringNow() {
  const user = await requireUser(rolesFor("settings.admin"));
  const summary = await runMonitoring(user.practiceId);
  await logAudit(user.practiceId, user.id, "RUN_MONITORING", "MonitoringRule", undefined, summary);
  back({ ok: `Checked now: ${summary}.` });
}
