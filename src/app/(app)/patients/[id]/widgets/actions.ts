"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { PATIENT_VIEW_ROLES } from "@/lib/gateway";
import { cleanWidgets } from "@/lib/patient-dashboard";

// The dashboard layout belongs to the user, not the patient: it applies to every patient they open.
export async function saveDashboardWidgets(patientId: string, fd: FormData) {
  const user = await requireUser(PATIENT_VIEW_ROLES);
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(String(fd.get("widgets") ?? "[]"));
  } catch {
    parsed = [];
  }
  const layout = fd.get("intent") === "reset" ? null : JSON.stringify(cleanWidgets(parsed));
  await prisma.user.update({ where: { id: user.id }, data: { patientDashboard: layout } });

  // An administrator can give everyone in the practice the same layout.
  if (fd.get("intent") === "copy" && user.role === "ADMIN") {
    const members = await prisma.membership.findMany({ where: { practiceId: user.practiceId }, select: { userId: true } });
    await prisma.user.updateMany({ where: { id: { in: members.map((m) => m.userId) } }, data: { patientDashboard: layout } });
    await logAudit(user.practiceId, user.id, "COPY_DASHBOARD_LAYOUT", "User", user.id, `${members.length} staff`);
  }
  revalidatePath("/patients", "layout");
  redirect(`/patients/${patientId}`);
}
