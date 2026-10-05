"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { requireChartAccess } from "@/lib/privacy";
import { THREAD_ROLES, THREAD_TEAMS } from "@/lib/patient-thread";

// Where the form was posted from; the reader lands back there. Only screens of this app are accepted.
function backTo(fd: FormData, patientId: string) {
  const to = String(fd.get("back") ?? "");
  return /^\/(patients|gateway|encounters|billing)\/[\w/?=&%.-]*$/.test(to) ? to.split("#")[0] : `/patients/${patientId}/thread`;
}

function done(path: string, key: "ok" | "error", message: string): never {
  const clean = path.replace(/([?&])(threadOk|threadError)=[^&]*&?/g, "$1").replace(/[?&]$/, "");
  redirect(`${clean}${clean.includes("?") ? "&" : "?"}${key === "ok" ? "threadOk" : "threadError"}=${encodeURIComponent(message.slice(0, 200))}#thread`);
}

async function patientFor(user: { id: string; practiceId: string; role: string }, patientId: string) {
  const patient = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId }, select: { id: true } });
  if (!patient) redirect("/");
  await requireChartAccess(user, patientId, `/patients/${patientId}/thread`);
  return patient;
}

// A message to a team about this patient. Sent as a reply, it also answers the message it replies to.
export async function postPatientMessage(patientId: string, fd: FormData) {
  const user = await requireUser(THREAD_ROLES);
  await patientFor(user, patientId);
  const back = backTo(fd, patientId);
  const body = String(fd.get("body") ?? "").trim().slice(0, 4000);
  if (!body) done(back, "error", "Write the message first.");
  const toTeam = String(fd.get("toTeam") ?? "");
  if (toTeam && !(toTeam in THREAD_TEAMS)) done(back, "error", "Choose the team the message is for.");
  const needsReply = fd.get("needsReply") === "on";
  if (needsReply && !toTeam) done(back, "error", "Choose which team should reply.");

  const replyToId = String(fd.get("replyToId") ?? "") || null;
  const original = replyToId ? await prisma.patientMessage.findFirst({ where: { id: replyToId, practiceId: user.practiceId, patientId } }) : null;
  const message = await prisma.patientMessage.create({
    data: {
      practiceId: user.practiceId,
      patientId,
      authorId: user.id,
      authorRole: user.role,
      // A reply goes back to the team that asked.
      toTeam: (original ? original.authorRole : toTeam) || null,
      body,
      needsReply: original ? false : needsReply,
      replyToId: original?.id ?? null,
      link: back.startsWith(`/patients/${patientId}/thread`) ? null : back.split("?")[0],
    },
  });
  if (original && !original.answeredAt) {
    await prisma.patientMessage.update({ where: { id: original.id }, data: { answeredAt: new Date(), answeredById: user.id } });
  }
  await logAudit(user.practiceId, user.id, "patient.message", "PatientMessage", message.id, toTeam || undefined);
  revalidatePath(`/patients/${patientId}`, "layout");
  done(back, "ok", original ? "Reply added to the patient's thread." : `Message added to the patient's thread${toTeam ? ` for ${THREAD_TEAMS[toTeam]}` : ""}.`);
}

// Closes a message that needed a reply without writing one (handled by phone, or no longer needed).
export async function markMessageAnswered(patientId: string, messageId: string, fd: FormData) {
  const user = await requireUser(THREAD_ROLES);
  await patientFor(user, patientId);
  const back = backTo(fd, patientId);
  const m = await prisma.patientMessage.findFirst({ where: { id: messageId, practiceId: user.practiceId, patientId } });
  if (!m) done(back, "error", "Message not found.");
  if (!m.answeredAt) await prisma.patientMessage.update({ where: { id: m.id }, data: { answeredAt: new Date(), answeredById: user.id } });
  revalidatePath(`/patients/${patientId}`, "layout");
  done(back, "ok", "Marked as dealt with.");
}
