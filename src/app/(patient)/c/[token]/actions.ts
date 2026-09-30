"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { recordFlow } from "@/lib/flow";

const REASONS = ["Patient Request", "Sick", "Transportation", "Weather", "Other"];

export async function respondToReminder(token: string, fd: FormData) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) redirect("/");
  const a = await prisma.appointment.findUnique({ where: { confirmToken: token }, include: { encounter: true } });
  if (!a || a.startsAt < new Date() || ["CANCELLED", "COMPLETED", "NO_SHOW"].includes(a.status)) redirect(`/c/${token}`);
  const answer = String(fd.get("answer") ?? "");
  if (answer === "confirm") {
    await prisma.appointment.update({
      where: { id: a.id },
      data: { status: a.status === "SCHEDULED" ? "CONFIRMED" : a.status, confirmedAt: new Date(), confirmedVia: "PATIENT_LINK" },
    });
    if (a.status === "SCHEDULED") await recordFlow(a.id, "CONFIRMED", null);
    await logAudit(a.practiceId, null, "PATIENT_CONFIRMED", "Appointment", a.id, "via reminder link");
  } else if (answer === "cancel" && !a.encounter) {
    const reason = REASONS.includes(String(fd.get("reason"))) ? String(fd.get("reason")) : "Patient Request";
    await prisma.appointment.update({
      where: { id: a.id },
      data: { status: "CANCELLED", cancelReason: `${reason} — cancelled by the patient from the reminder link`, cancelledAt: new Date() },
    });
    await recordFlow(a.id, "CANCELLED", null);
    await logAudit(a.practiceId, null, "PATIENT_CANCELLED", "Appointment", a.id, reason);
  }
  revalidatePath("/schedule");
  redirect(`/c/${token}?done=${answer === "cancel" ? "cancel" : "confirm"}`);
}
