"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { CLOSE_REASONS, RECALL_ROLES, sendRecallMessage } from "@/lib/recalls";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const safeBack = (v: string) => (/^\/(recalls|patients\/[a-z0-9]+)(\?[\w=&-]*)?$/.test(v) ? v : "/recalls");

function done(back: string, extra = "saved=1") {
  revalidatePath("/recalls");
  redirect(`${back}${back.includes("?") ? "&" : "?"}${extra}`);
}

export async function createRecall(fd: FormData) {
  const user = await requireUser(RECALL_ROLES);
  const back = safeBack(str(fd, "back"));
  const patient = await prisma.patient.findFirst({ where: { id: str(fd, "patientId"), practiceId: user.practiceId } });
  if (!patient) redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent("Choose the patient.")}`);
  let due = str(fd, "dueDate") ? new Date(`${str(fd, "dueDate")}T12:00:00`) : null;
  const weeks = Number(str(fd, "weeks"));
  if (!due && Number.isInteger(weeks) && weeks > 0) due = new Date(Date.now() + weeks * 7 * 86_400_000);
  if (!due || Number.isNaN(due.getTime())) redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent("Pick when the patient is due back.")}`);
  const reason = str(fd, "reason").slice(0, 120) || "Follow-up visit";
  const r = await prisma.recall.create({
    data: {
      practiceId: user.practiceId,
      patientId: patient.id,
      dueDate: due,
      reason,
      providerId: str(fd, "providerId") || null,
      locationId: str(fd, "locationId") || null,
      visitType: str(fd, "visitType") || null,
      notes: str(fd, "notes").slice(0, 500) || null,
      createdById: user.id,
    },
  });
  await logAudit(user.practiceId, user.id, "CREATE_RECALL", "Recall", r.id, `${reason} · due ${due.toISOString().slice(0, 10)}`);
  revalidatePath(`/patients/${patient.id}`);
  done(back);
}

export async function contactRecall(id: string) {
  const user = await requireUser(RECALL_ROLES);
  const n = await sendRecallMessage(id, user.practiceId, user.id);
  done("/recalls", n ? "sent=1" : `error=${encodeURIComponent("No valid mobile number or email on file — call the patient instead.")}`);
}

export async function contactAllOverdue() {
  const user = await requireUser(RECALL_ROLES);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const due = await prisma.recall.findMany({
    where: { practiceId: user.practiceId, status: "OPEN", dueDate: { lte: new Date(Date.now() + 14 * 86_400_000) }, OR: [{ lastContactAt: null }, { lastContactAt: { lt: weekAgo } }] },
    take: 200,
  });
  let sent = 0;
  for (const r of due) sent += (await sendRecallMessage(r.id, user.practiceId, user.id)) ? 1 : 0;
  await logAudit(user.practiceId, user.id, "RECALL_OUTREACH", "Recall", "bulk", `${sent} of ${due.length} patients contacted`);
  done("/recalls", `sent=${sent}&of=${due.length}`);
}

export async function logRecallCall(id: string, fd: FormData) {
  const user = await requireUser(RECALL_ROLES);
  const r = await prisma.recall.findFirst({ where: { id, practiceId: user.practiceId } });
  if (!r) done("/recalls");
  const note = str(fd, "note").slice(0, 300) || "Called patient";
  await prisma.recall.update({
    where: { id: r!.id },
    data: { contactCount: r!.contactCount + 1, lastContactAt: new Date(), lastContactVia: "Phone", notes: [r!.notes, `${new Date().toLocaleDateString("en-US")}: ${note}`].filter(Boolean).join("\n").slice(-2000) },
  });
  done("/recalls");
}

export async function closeRecall(id: string, fd: FormData) {
  const user = await requireUser(RECALL_ROLES);
  const reason = CLOSE_REASONS.includes(str(fd, "reason")) ? str(fd, "reason") : "Not needed any more";
  await prisma.recall.updateMany({ where: { id, practiceId: user.practiceId }, data: { status: "CLOSED", closedReason: reason } });
  await logAudit(user.practiceId, user.id, "CLOSE_RECALL", "Recall", id, reason);
  done(safeBack(str(fd, "back")));
}

export async function reopenRecall(id: string) {
  const user = await requireUser(RECALL_ROLES);
  await prisma.recall.updateMany({ where: { id, practiceId: user.practiceId }, data: { status: "OPEN", closedReason: null, appointmentId: null } });
  done("/recalls");
}
