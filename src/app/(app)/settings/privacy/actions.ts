"use server";

import { rolesFor } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getConnectSettings } from "@/lib/connect/core";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function reviewEmergencyAccess(accessId: string, fd: FormData) {
  const user = await requireUser(rolesFor("settings.admin"));
  const row = await prisma.emergencyAccess.findFirst({ where: { id: accessId, practiceId: user.practiceId } });
  if (!row) redirect("/settings/privacy");
  // Someone else reviews an administrator's own access.
  if (row.userId === user.id) redirect(`/settings/privacy?error=${encodeURIComponent("Another administrator has to review your own access.")}`);
  const note = str(fd, "reviewNote").slice(0, 500);
  await prisma.emergencyAccess.update({ where: { id: row.id }, data: { reviewedAt: new Date(), reviewedById: user.id, reviewNote: note || null } });
  await logAudit(user.practiceId, user.id, "REVIEW_BREAK_GLASS", "Patient", row.patientId, `access ${row.id}${note ? ` · ${note}` : ""}`);
  revalidatePath("/settings/privacy");
  redirect(`/settings/privacy?ok=${encodeURIComponent("Access marked as reviewed.")}`);
}

export async function saveConsentRule(fd: FormData) {
  const user = await requireUser(rolesFor("settings.admin"));
  const settings = await getConnectSettings(user.practiceId);
  const requireTextConsent = fd.get("requireTextConsent") === "on";
  await prisma.connectSettings.update({ where: { id: settings.id }, data: { requireTextConsent } });
  await logAudit(user.practiceId, user.id, "UPDATE_CONSENT_RULE", "ConnectSettings", settings.id, requireTextConsent ? "texts need consent" : "texts unless declined");
  revalidatePath("/settings/privacy");
  redirect(`/settings/privacy?ok=${encodeURIComponent("Text consent rule saved.")}`);
}
