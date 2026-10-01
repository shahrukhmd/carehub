"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { TASK_TEAMS, createTask } from "@/lib/tasks";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const back = (fd: FormData, fallback = "/tasks") => {
  const b = str(fd, "back");
  return /^\/(tasks|patients\/[a-z0-9]+)(\?[\w=&-]*)?$/.test(b) ? b : fallback;
};
function done(to: string) {
  revalidatePath("/tasks");
  revalidatePath("/", "layout");
  redirect(to);
}

async function ownTask(practiceId: string, id: string) {
  const t = await prisma.task.findFirst({ where: { id, practiceId } });
  if (!t) redirect("/tasks");
  return t;
}

export async function newTask(fd: FormData) {
  const user = await requireUser();
  const to = back(fd);
  const title = str(fd, "title");
  if (!title) redirect(`${to}${to.includes("?") ? "&" : "?"}error=${encodeURIComponent("Give the task a subject.")}`);
  const target = str(fd, "assignee");
  let assignedToId: string | null = null;
  let assignedRole: string | null = null;
  if (target.startsWith("team:") && TASK_TEAMS[target.slice(5)]) assignedRole = target.slice(5);
  else if (target) {
    const m = await prisma.membership.findFirst({ where: { practiceId: user.practiceId, userId: target } });
    if (m) assignedToId = target;
  }
  const patientId = str(fd, "patientId");
  const patient = patientId ? await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId } }) : null;
  const due = str(fd, "dueAt") ? new Date(`${str(fd, "dueAt")}T17:00:00`) : null;
  const t = await createTask({
    practiceId: user.practiceId,
    type: str(fd, "type") || "MESSAGE",
    title,
    body: str(fd, "body") || null,
    patientId: patient?.id ?? null,
    assignedToId,
    assignedRole,
    createdById: user.id,
    priority: str(fd, "priority") || "NORMAL",
    dueAt: due && !Number.isNaN(due.getTime()) ? due : null,
    link: patient ? `/patients/${patient.id}` : null,
  });
  await logAudit(user.practiceId, user.id, "CREATE_TASK", "Task", t.id, title.slice(0, 80));
  done(to);
}

export async function commentTask(id: string, fd: FormData) {
  const user = await requireUser();
  const t = await ownTask(user.practiceId, id);
  const body = str(fd, "body").slice(0, 2000);
  if (body) await prisma.taskComment.create({ data: { taskId: t.id, userId: user.id, body } });
  // Replying to a message sends it back to whoever wrote it.
  if (body && fd.get("sendBack") === "on" && t.createdById && t.createdById !== user.id) {
    await prisma.task.update({ where: { id: t.id }, data: { assignedToId: t.createdById, assignedRole: null, createdById: user.id } });
  }
  done(`/tasks?open=${t.id}`);
}

export async function completeTask(id: string, fd: FormData) {
  const user = await requireUser();
  const t = await ownTask(user.practiceId, id);
  const note = str(fd, "note");
  if (note) await prisma.taskComment.create({ data: { taskId: t.id, userId: user.id, body: note.slice(0, 2000) } });
  await prisma.task.update({ where: { id: t.id }, data: { status: "DONE", completedAt: new Date(), completedById: user.id } });
  await logAudit(user.practiceId, user.id, "COMPLETE_TASK", "Task", t.id, t.title.slice(0, 80));
  done(back(fd));
}

export async function reopenTask(id: string) {
  const user = await requireUser();
  const t = await ownTask(user.practiceId, id);
  await prisma.task.update({ where: { id: t.id }, data: { status: "OPEN", completedAt: null, completedById: null } });
  done(`/tasks?open=${t.id}`);
}

export async function reassignTask(id: string, fd: FormData) {
  const user = await requireUser();
  const t = await ownTask(user.practiceId, id);
  const target = str(fd, "assignee");
  let data: { assignedToId: string | null; assignedRole: string | null } = { assignedToId: null, assignedRole: null };
  if (target === "me") data = { assignedToId: user.id, assignedRole: null };
  else if (target.startsWith("team:") && TASK_TEAMS[target.slice(5)]) data = { assignedToId: null, assignedRole: target.slice(5) };
  else if (target && (await prisma.membership.findFirst({ where: { practiceId: user.practiceId, userId: target } }))) data = { assignedToId: target, assignedRole: null };
  await prisma.task.update({ where: { id: t.id }, data });
  done(`/tasks?open=${t.id}`);
}
