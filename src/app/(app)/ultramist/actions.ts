"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  PRIOR_AUTH_STATUSES,
  SERIES_PLANS,
  ULTRAMIST_EDIT_ROLES,
  refreshUmCounts,
  setUmStatus,
  umStatusLabel,
  umStatusNeedsReason,
} from "@/lib/ultramist";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const safeBack = (v: string) => (/^\/(ultramist(\/[a-z0-9]+)?|patients\/[a-z0-9]+)(\?[\w=&%.-]*)?$/.test(v) ? v : "/ultramist");
const withParam = (back: string, extra: string) => `${back}${back.includes("?") ? "&" : "?"}${extra}`;
const dateOf = (v: string) => (v ? new Date(`${v}T12:00:00`) : null);

function done(back: string, extra = "saved=1"): never {
  revalidatePath("/ultramist");
  redirect(withParam(back, extra));
}
function failTo(back: string, message: string): never {
  redirect(withParam(back, `error=${encodeURIComponent(message)}`));
}

async function ownOrder(id: string, practiceId: string) {
  const o = await prisma.ultramistOrder.findFirst({ where: { id, practiceId } });
  if (!o) failTo("/ultramist", "UltraMist order not found.");
  return o;
}

export async function createUltramistOrder(fd: FormData) {
  const user = await requireUser(ULTRAMIST_EDIT_ROLES);
  const back = safeBack(str(fd, "back"));
  const patient = await prisma.patient.findFirst({ where: { id: str(fd, "patientId"), practiceId: user.practiceId }, select: { id: true } });
  if (!patient) failTo(back, "Choose the patient.");
  const open = await prisma.ultramistOrder.findFirst({ where: { practiceId: user.practiceId, patientId: patient.id, isArchived: false, umStatus: { notIn: ["NOT_ELIGIBLE", "ORDER_CANCELLED", "DENIED", "COMPLETED"] } } });
  if (open) failTo(back, "This patient already has an open UltraMist order — update that one or close it first.");
  const providerId = str(fd, "orderingProviderId") || null;
  const provider = providerId ? await prisma.user.findFirst({ where: { id: providerId, memberships: { some: { practiceId: user.practiceId } } }, select: { id: true, name: true } }) : null;
  if (providerId && !provider) failTo(back, "Pick an ordering provider from this practice.");
  const plan = SERIES_PLANS.find((p) => p.label === str(fd, "seriesPlan"));
  const plannedVisits = Number(str(fd, "plannedVisits")) || plan?.visits || null;
  const order = await prisma.ultramistOrder.create({
    data: {
      practiceId: user.practiceId,
      patientId: patient.id,
      orderingProviderId: provider?.id ?? null,
      orderingPhysician: (provider?.name ?? str(fd, "orderingPhysician")).slice(0, 200) || null,
      dateOrdered: dateOf(str(fd, "dateOrdered")) ?? new Date(),
      seriesPlan: (plan?.label ?? str(fd, "seriesPlan")).slice(0, 300) || null,
      plannedVisits,
      notesOnMedicalNecessity: str(fd, "notesOnMedicalNecessity").slice(0, 4000) || null,
      notes: str(fd, "notes").slice(0, 4000) || null,
      createdById: user.id,
      updatedById: user.id,
    },
  });
  await refreshUmCounts(user.practiceId, [order.id]);
  await logAudit(user.practiceId, user.id, "ULTRAMIST_ORDER", "UltramistOrder", order.id, order.seriesPlan ?? "manual order");
  revalidatePath(`/patients/${patient.id}`);
  done(`/ultramist/${order.id}`);
}

// Inline status change from the grid: statuses that need a reason go to the order page to collect it.
export async function setUltramistStatus(id: string, fd: FormData) {
  const user = await requireUser(ULTRAMIST_EDIT_ROLES);
  const back = safeBack(str(fd, "back"));
  const order = await ownOrder(id, user.practiceId);
  const status = str(fd, "umStatus");
  if (!umStatusLabel[status]) failTo(back, "Pick a UM status.");
  const reason = str(fd, "reason");
  if (umStatusNeedsReason(status) && !reason) redirect(`/ultramist/${order.id}?needReason=${status}`);
  await setUmStatus(order.id, user.practiceId, status, user.id, reason || null);
  done(back);
}

export async function setUltramistPriorAuth(id: string, fd: FormData) {
  const user = await requireUser(ULTRAMIST_EDIT_ROLES);
  const back = safeBack(str(fd, "back"));
  const order = await ownOrder(id, user.practiceId);
  const status = str(fd, "priorAuthStatus");
  if (status && !PRIOR_AUTH_STATUSES.some((s) => s.key === status)) failTo(back, "Pick a prior authorization status.");
  await prisma.ultramistOrder.update({ where: { id: order.id }, data: { priorAuthStatus: status || null, updatedById: user.id } });
  await logAudit(user.practiceId, user.id, "ULTRAMIST_PRIOR_AUTH", "UltramistOrder", order.id, status || "cleared");
  done(back);
}

export async function assignUltramistOrder(id: string, fd: FormData) {
  const user = await requireUser(ULTRAMIST_EDIT_ROLES);
  const back = safeBack(str(fd, "back"));
  const order = await ownOrder(id, user.practiceId);
  const assignedToId = str(fd, "assignedToId") || null;
  if (assignedToId && !(await prisma.user.findFirst({ where: { id: assignedToId, active: true, memberships: { some: { practiceId: user.practiceId } } }, select: { id: true } }))) {
    failTo(back, "Pick a staff member from this practice.");
  }
  await prisma.ultramistOrder.update({ where: { id: order.id }, data: { assignedToId, updatedById: user.id } });
  await logAudit(user.practiceId, user.id, "ULTRAMIST_ASSIGN", "UltramistOrder", order.id, assignedToId ?? "unassigned");
  done(back);
}

// The full edit form on the order page.
export async function updateUltramistOrder(id: string, fd: FormData) {
  const user = await requireUser(ULTRAMIST_EDIT_ROLES);
  const back = `/ultramist/${id}`;
  const order = await ownOrder(id, user.practiceId);
  const providerId = str(fd, "orderingProviderId") || null;
  const provider = providerId ? await prisma.user.findFirst({ where: { id: providerId, memberships: { some: { practiceId: user.practiceId } } }, select: { id: true, name: true } }) : null;
  if (providerId && !provider) failTo(back, "Pick an ordering provider from this practice.");
  const priorAuthStatus = str(fd, "priorAuthStatus");
  if (priorAuthStatus && !PRIOR_AUTH_STATUSES.some((s) => s.key === priorAuthStatus)) failTo(back, "Pick a prior authorization status.");
  const plannedVisits = Number(str(fd, "plannedVisits"));
  const dateOrdered = dateOf(str(fd, "dateOrdered"));
  await prisma.ultramistOrder.update({
    where: { id: order.id },
    data: {
      orderingProviderId: provider?.id ?? null,
      orderingPhysician: (provider?.name ?? str(fd, "orderingPhysician")).slice(0, 200) || null,
      dateOrdered,
      seriesPlan: str(fd, "seriesPlan").slice(0, 300) || null,
      plannedVisits: Number.isInteger(plannedVisits) && plannedVisits > 0 ? plannedVisits : null,
      priorAuthStatus: priorAuthStatus || null,
      priorAuthNumber: str(fd, "priorAuthNumber").slice(0, 100) || null,
      priorAuthNotes: str(fd, "priorAuthNotes").slice(0, 4000) || null,
      notesOnMedicalNecessity: str(fd, "notesOnMedicalNecessity").slice(0, 4000) || null,
      notes: str(fd, "notes").slice(0, 4000) || null,
      updatedById: user.id,
    },
  });
  // The order date moves the counting window.
  if ((dateOrdered?.getTime() ?? null) !== (order.dateOrdered?.getTime() ?? null)) await refreshUmCounts(user.practiceId, [order.id]);
  await logAudit(user.practiceId, user.id, "ULTRAMIST_UPDATE", "UltramistOrder", order.id);
  done(back);
}

// Status change with a reason (hold, not eligible, cancelled, denied) from the order page.
export async function changeUltramistStatus(id: string, fd: FormData) {
  const user = await requireUser(ULTRAMIST_EDIT_ROLES);
  const back = `/ultramist/${id}`;
  const order = await ownOrder(id, user.practiceId);
  const status = str(fd, "umStatus");
  if (!umStatusLabel[status]) failTo(back, "Pick a UM status.");
  const reason = str(fd, "reason").slice(0, 500);
  if (umStatusNeedsReason(status) && !reason) failTo(back, `Give the reason for "${umStatusLabel[status]}".`);
  await setUmStatus(order.id, user.practiceId, status, user.id, reason || null);
  done(back);
}

export async function refreshUltramistCounts(id: string, fd: FormData) {
  const user = await requireUser(ULTRAMIST_EDIT_ROLES);
  const back = safeBack(str(fd, "back")) || `/ultramist/${id}`;
  const order = await ownOrder(id, user.practiceId);
  await refreshUmCounts(user.practiceId, [order.id]);
  done(back, "refreshed=1");
}

export async function archiveUltramistOrder(id: string, fd: FormData) {
  const user = await requireUser(ULTRAMIST_EDIT_ROLES);
  const back = safeBack(str(fd, "back"));
  const order = await ownOrder(id, user.practiceId);
  const archive = str(fd, "archive") !== "0";
  await prisma.ultramistOrder.update({ where: { id: order.id }, data: { isArchived: archive, archivedAt: archive ? new Date() : null, updatedById: user.id } });
  await logAudit(user.practiceId, user.id, archive ? "ULTRAMIST_ARCHIVE" : "ULTRAMIST_UNARCHIVE", "UltramistOrder", order.id);
  done(back);
}
