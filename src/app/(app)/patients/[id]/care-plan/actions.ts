"use server";

import { rolesFor } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { SDOH_QUESTIONS, careTeamRoleLabel, concernCategoryLabel, goalKindLabel, goalStatusLabel, sdohNeeds } from "@/lib/care-plan";
import { requireChartAccess } from "@/lib/privacy";

// The care team list and the social needs screen are also kept by the front office; clinical items by clinicians.
const TEAM_ROLES = rolesFor("careplan.team");
const CLINICAL_ROLES = rolesFor("careplan.edit");

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const day = (fd: FormData, k: string) => {
  const v = str(fd, k);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

function back(patientId: string, msg: { error?: string; ok?: string }): never {
  revalidatePath(`/patients/${patientId}/care-plan`);
  revalidatePath(`/patients/${patientId}`);
  const q = msg.error ? `?error=${encodeURIComponent(msg.error.slice(0, 300))}` : `?ok=${encodeURIComponent(msg.ok ?? "Saved.")}`;
  redirect(`/patients/${patientId}/care-plan${q}`);
}

async function planUser(patientId: string, roles: string[]) {
  const user = await requireUser(roles);
  const patient = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId }, select: { id: true } });
  if (!patient) redirect("/patients");
  await requireChartAccess(user, patientId, `/patients/${patientId}/care-plan`);
  return user;
}

// ---- Care team ----

export async function addTeamMember(patientId: string, fd: FormData) {
  const user = await planUser(patientId, TEAM_ROLES);
  const role = str(fd, "role");
  if (!(role in careTeamRoleLabel)) back(patientId, { error: "Pick the member's role." });
  // A staff member is picked from the list; anyone outside the practice is typed in.
  const staffId = str(fd, "userId");
  const staff = staffId ? await prisma.membership.findFirst({ where: { userId: staffId, practiceId: user.practiceId }, include: { user: { select: { id: true, name: true } } } }) : null;
  const name = (str(fd, "name") || staff?.user.name || "").slice(0, 120);
  if (!name) back(patientId, { error: "Enter the member's name or pick a staff member." });
  const row = await prisma.careTeamMember.create({
    data: {
      practiceId: user.practiceId,
      patientId,
      name,
      role,
      specialty: str(fd, "specialty").slice(0, 120) || null,
      organization: str(fd, "organization").slice(0, 160) || null,
      phone: str(fd, "phone").slice(0, 40) || null,
      fax: str(fd, "fax").slice(0, 40) || null,
      email: str(fd, "email").slice(0, 160) || null,
      userId: staff?.user.id ?? null,
      startDate: day(fd, "startDate"),
      notes: str(fd, "notes").slice(0, 500) || null,
    },
  });
  await logAudit(user.practiceId, user.id, "ADD_CARE_TEAM", "CareTeamMember", row.id, `${name} · ${role}`);
  back(patientId, { ok: `${name} added to the care team.` });
}

export async function endTeamMember(patientId: string, memberId: string) {
  const user = await planUser(patientId, TEAM_ROLES);
  const row = await prisma.careTeamMember.findFirst({ where: { id: memberId, patientId, practiceId: user.practiceId } });
  if (!row) back(patientId, { error: "Care team member not found." });
  await prisma.careTeamMember.update({ where: { id: row!.id }, data: { active: false, endDate: new Date() } });
  await logAudit(user.practiceId, user.id, "END_CARE_TEAM", "CareTeamMember", row!.id, row!.name);
  back(patientId, { ok: `${row!.name} is no longer on the care team.` });
}

// ---- Health concerns ----

export async function addConcern(patientId: string, fd: FormData) {
  const user = await planUser(patientId, CLINICAL_ROLES);
  const concern = str(fd, "concern").slice(0, 300);
  if (!concern) back(patientId, { error: "Describe the health concern." });
  const category = str(fd, "category");
  const row = await prisma.healthConcern.create({
    data: {
      practiceId: user.practiceId,
      patientId,
      concern,
      category: category in concernCategoryLabel ? category : "CLINICAL",
      notedAt: day(fd, "notedAt") ?? new Date(),
      notes: str(fd, "notes").slice(0, 600) || null,
      createdById: user.id,
    },
  });
  await logAudit(user.practiceId, user.id, "ADD_HEALTH_CONCERN", "HealthConcern", row.id, concern.slice(0, 80));
  back(patientId, { ok: "Health concern added." });
}

export async function setConcernStatus(patientId: string, concernId: string, status: string) {
  const user = await planUser(patientId, CLINICAL_ROLES);
  const row = await prisma.healthConcern.findFirst({ where: { id: concernId, patientId, practiceId: user.practiceId } });
  if (!row || !["ACTIVE", "RESOLVED"].includes(status)) back(patientId, { error: "Health concern not found." });
  await prisma.healthConcern.update({ where: { id: row!.id }, data: { status, resolvedAt: status === "RESOLVED" ? new Date() : null } });
  await logAudit(user.practiceId, user.id, "UPDATE_HEALTH_CONCERN", "HealthConcern", row!.id, status);
  back(patientId, { ok: status === "RESOLVED" ? "Concern marked resolved." : "Concern reopened." });
}

// ---- Goals ----

export async function addGoal(patientId: string, fd: FormData) {
  const user = await planUser(patientId, CLINICAL_ROLES);
  const goal = str(fd, "goal").slice(0, 400);
  if (!goal) back(patientId, { error: "Describe the goal." });
  const kind = str(fd, "kind");
  const concernId = str(fd, "concernId");
  const concern = concernId ? await prisma.healthConcern.findFirst({ where: { id: concernId, patientId }, select: { id: true } }) : null;
  const row = await prisma.patientGoal.create({
    data: {
      practiceId: user.practiceId,
      patientId,
      goal,
      kind: kind in goalKindLabel ? kind : "PROVIDER",
      concernId: concern?.id ?? null,
      interventions: str(fd, "interventions").slice(0, 1000) || null,
      targetDate: day(fd, "targetDate"),
      createdById: user.id,
    },
  });
  await logAudit(user.practiceId, user.id, "ADD_GOAL", "PatientGoal", row.id, goal.slice(0, 80));
  back(patientId, { ok: "Goal added." });
}

export async function updateGoal(patientId: string, goalId: string, fd: FormData) {
  const user = await planUser(patientId, CLINICAL_ROLES);
  const row = await prisma.patientGoal.findFirst({ where: { id: goalId, patientId, practiceId: user.practiceId } });
  if (!row) back(patientId, { error: "Goal not found." });
  const status = str(fd, "status");
  if (!(status in goalStatusLabel)) back(patientId, { error: "Pick the goal's status." });
  await prisma.patientGoal.update({
    where: { id: row!.id },
    data: { status, progressNote: str(fd, "progressNote").slice(0, 1000) || row!.progressNote, closedAt: status === "ACTIVE" ? null : (row!.closedAt ?? new Date()) },
  });
  await logAudit(user.practiceId, user.id, "UPDATE_GOAL", "PatientGoal", row!.id, status);
  back(patientId, { ok: "Goal updated." });
}

// ---- Implantable devices ----

export async function addDevice(patientId: string, fd: FormData) {
  const user = await planUser(patientId, CLINICAL_ROLES);
  const deviceName = str(fd, "deviceName").slice(0, 200);
  if (!deviceName) back(patientId, { error: "Enter the device name." });
  const row = await prisma.implantableDevice.create({
    data: {
      practiceId: user.practiceId,
      patientId,
      deviceName,
      udi: str(fd, "udi").slice(0, 200) || null,
      manufacturer: str(fd, "manufacturer").slice(0, 160) || null,
      model: str(fd, "model").slice(0, 120) || null,
      lotNumber: str(fd, "lotNumber").slice(0, 80) || null,
      serialNumber: str(fd, "serialNumber").slice(0, 80) || null,
      site: str(fd, "site").slice(0, 120) || null,
      implantedAt: day(fd, "implantedAt"),
      notes: str(fd, "notes").slice(0, 500) || null,
    },
  });
  await logAudit(user.practiceId, user.id, "ADD_IMPLANT", "ImplantableDevice", row.id, deviceName);
  back(patientId, { ok: "Device added." });
}

export async function removeDevice(patientId: string, deviceId: string, fd: FormData) {
  const user = await planUser(patientId, CLINICAL_ROLES);
  const row = await prisma.implantableDevice.findFirst({ where: { id: deviceId, patientId, practiceId: user.practiceId } });
  if (!row) back(patientId, { error: "Device not found." });
  await prisma.implantableDevice.update({ where: { id: row!.id }, data: { status: "REMOVED", removedAt: day(fd, "removedAt") ?? new Date() } });
  await logAudit(user.practiceId, user.id, "REMOVE_IMPLANT", "ImplantableDevice", row!.id, row!.deviceName);
  back(patientId, { ok: "Device marked as removed." });
}

// ---- Social needs screening ----

export async function saveSdohScreening(patientId: string, fd: FormData) {
  const user = await planUser(patientId, TEAM_ROLES);
  const declined = fd.get("declined") === "on";
  const answers: Record<string, string> = {};
  for (const q of SDOH_QUESTIONS) {
    const v = str(fd, `q_${q.key}`);
    if (q.options.some((o) => o.code === v)) answers[q.key] = v;
  }
  if (!declined && Object.keys(answers).length === 0) back(patientId, { error: "Answer at least one question, or tick that the patient declined." });
  const needs = declined ? [] : sdohNeeds(answers);
  const encounterId = str(fd, "encounterId");
  const encounter = encounterId ? await prisma.encounter.findFirst({ where: { id: encounterId, patientId }, select: { id: true } }) : null;
  const row = await prisma.sdohScreening.create({
    data: {
      practiceId: user.practiceId,
      patientId,
      encounterId: encounter?.id ?? null,
      declined,
      answers: JSON.stringify(declined ? {} : answers),
      needs: needs.join(","),
      notes: str(fd, "notes").slice(0, 800) || null,
      screenedById: user.id,
    },
  });
  await logAudit(user.practiceId, user.id, "SDOH_SCREENING", "SdohScreening", row.id, declined ? "declined" : needs.join(",") || "no needs");
  back(patientId, { ok: declined ? "Recorded that the patient declined the screening." : needs.length ? `Screening saved — ${needs.length} need(s) found.` : "Screening saved — no needs found." });
}
