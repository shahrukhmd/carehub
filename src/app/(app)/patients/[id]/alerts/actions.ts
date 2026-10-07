"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { rolesFor } from "@/lib/permissions";
import { ALERT_PLACEMENTS, ALERT_SEVERITIES, ALERT_TYPES, type Placement } from "@/lib/patient-alerts";

const str = (fd: FormData, k: string, max = 300) => String(fd.get(k) ?? "").trim().slice(0, max);

function back(patientId: string, msg: { ok?: string; error?: string }): never {
  const q = msg.error ? `?error=${encodeURIComponent(msg.error)}` : msg.ok ? `?ok=${encodeURIComponent(msg.ok)}` : "";
  revalidatePath(`/patients/${patientId}`, "layout");
  revalidatePath("/schedule");
  revalidatePath("/flow");
  redirect(`/patients/${patientId}/alerts${q}`);
}

async function alertUser(patientId: string) {
  const user = await requireUser(rolesFor("patients.alerts"));
  const patient = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId }, select: { id: true } });
  if (!patient) redirect("/patients");
  return user;
}

export async function createAlert(patientId: string, fd: FormData) {
  const user = await alertUser(patientId);
  const type = str(fd, "type", 30);
  if (!(type in ALERT_TYPES)) back(patientId, { error: "Pick the alert type." });
  const severity = str(fd, "severity", 10);
  if (!(severity in ALERT_SEVERITIES)) back(patientId, { error: "Pick the severity." });
  const message = str(fd, "message", 300);
  if (!message) back(patientId, { error: "Write the alert message." });
  const showOn = ALERT_PLACEMENTS.map(([k]) => k).filter((k) => fd.get(`on:${k}`) === "on");
  if (showOn.length === 0) back(patientId, { error: "Pick at least one place to show the alert." });
  const from = str(fd, "activeFrom", 10);
  const to = str(fd, "activeTo", 10);
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) back(patientId, { error: "Pick a valid start date." });
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) back(patientId, { error: "Pick a valid end date." });
  const assignedToId = str(fd, "assignedToId", 40) || null;
  if (assignedToId && !(await prisma.membership.findFirst({ where: { userId: assignedToId, practiceId: user.practiceId } }))) back(patientId, { error: "Pick a staff member of this practice." });
  const a = await prisma.patientAlert.create({
    data: {
      practiceId: user.practiceId,
      patientId,
      type,
      severity,
      message,
      showOn: showOn.join(","),
      activeFrom: from ? new Date(`${from}T00:00:00`) : new Date(),
      activeTo: to ? new Date(`${to}T00:00:00`) : null,
      assignedToId,
      createdById: user.id,
    },
  });
  await logAudit(user.practiceId, user.id, "CREATE_ALERT", "Patient", patientId, `${severity} ${type}: ${message.slice(0, 80)}`);
  back(patientId, { ok: `Alert added${a.severity === "STOP" ? " — booking and check-in will ask for acknowledgement" : ""}.` });
}

export async function resolveAlert(patientId: string, alertId: string, fd: FormData) {
  const user = await alertUser(patientId);
  const comment = str(fd, "comment", 300);
  if (!comment) back(patientId, { error: "Say how the alert was resolved." });
  const a = await prisma.patientAlert.findFirst({ where: { id: alertId, patientId, practiceId: user.practiceId } });
  if (!a) back(patientId, { error: "Alert not found." });
  await prisma.patientAlert.update({ where: { id: a!.id }, data: { status: "RESOLVED", resolvedById: user.id, resolvedAt: new Date(), resolveComment: comment } });
  await logAudit(user.practiceId, user.id, "RESOLVE_ALERT", "Patient", patientId, `${a!.type}: ${comment.slice(0, 80)}`);
  back(patientId, { ok: "Alert resolved." });
}

// Seeing a STOP alert is recorded per person; it clears the block on booking and check-in for a day.
export async function acknowledgeAlert(patientId: string, alertId: string, placement: Placement) {
  const user = await requireUser(rolesFor("patients.view"));
  const a = await prisma.patientAlert.findFirst({ where: { id: alertId, patientId, practiceId: user.practiceId, status: "ACTIVE" } });
  if (!a) return;
  await prisma.alertAcknowledgement.create({ data: { alertId: a.id, userId: user.id, placement } });
  await logAudit(user.practiceId, user.id, "ACKNOWLEDGE_ALERT", "Patient", patientId, `${a.type} at ${placement}: ${a.message.slice(0, 80)}`);
  revalidatePath(`/patients/${patientId}`, "layout");
  revalidatePath("/schedule");
  revalidatePath("/flow");
}
