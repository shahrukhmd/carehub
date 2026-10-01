"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { saveGenerated } from "@/lib/storage";
import { faxNumberOrNull, getFaxAdapter } from "@/lib/fax";
import { REFERRAL_ROLES, referralLetterPdf } from "@/lib/referrals";
import { completeSourceTasks } from "@/lib/tasks";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const go = (to: string, msg?: { error?: string; ok?: string }) => {
  revalidatePath("/referrals");
  revalidatePath(to.split("?")[0]);
  const q = msg?.error ? `error=${encodeURIComponent(msg.error)}` : msg?.ok ? `ok=${encodeURIComponent(msg.ok)}` : "";
  redirect(q ? `${to}${to.includes("?") ? "&" : "?"}${q}` : to);
};

async function own(practiceId: string, id: string) {
  const r = await prisma.outgoingReferral.findFirst({ where: { id, practiceId }, include: { patient: true } });
  if (!r) redirect("/referrals");
  return r;
}

export async function createReferral(fd: FormData) {
  const user = await requireUser(REFERRAL_ROLES);
  const patient = await prisma.patient.findFirst({ where: { id: str(fd, "patientId"), practiceId: user.practiceId } });
  const back = `/referrals/new?patientId=${str(fd, "patientId")}`;
  if (!patient) go("/referrals/new", { error: "Choose the patient." });
  const toProviderId = str(fd, "toProviderId");
  const dir = toProviderId ? await prisma.renderingProvider.findFirst({ where: { id: toProviderId, practiceId: user.practiceId } }) : null;
  const toName = dir?.name ?? str(fd, "toName");
  const reason = str(fd, "reason");
  if (!toName) go(back, { error: "Who is the referral to?" });
  if (!reason) go(back, { error: "Give the reason for referral." });
  const settings = await prisma.practiceSettings.findUnique({ where: { practiceId: user.practiceId } });
  const r = await prisma.outgoingReferral.create({
    data: {
      practiceId: user.practiceId,
      patientId: patient!.id,
      encounterId: str(fd, "encounterId") || null,
      toProviderId: dir?.id ?? null,
      toName: toName.slice(0, 120),
      toSpecialty: (str(fd, "toSpecialty") || dir?.specialty || "").slice(0, 80) || null,
      toFax: (str(fd, "toFax") || dir?.fax || "").slice(0, 20) || null,
      toPhone: (str(fd, "toPhone") || dir?.phone || "").slice(0, 20) || null,
      reason: reason.slice(0, 500),
      diagnosisCodes: str(fd, "diagnosisCodes").toUpperCase().slice(0, 200) || null,
      notes: str(fd, "notes").slice(0, 2000) || null,
      urgency: str(fd, "urgency") === "URGENT" ? "URGENT" : "ROUTINE",
      authNumber: str(fd, "authNumber").slice(0, 40) || null,
      followUpDays: Number(str(fd, "followUpDays")) || settings?.referralFollowUpDays || 30,
      createdById: user.id,
    },
  });
  await logAudit(user.practiceId, user.id, "CREATE_REFERRAL", "OutgoingReferral", r.id, `${r.toName}: ${r.reason.slice(0, 60)}`);
  go(`/referrals/${r.id}`, { ok: "Referral saved — review the letter and send it." });
}

export async function sendReferral(id: string, fd: FormData) {
  const user = await requireUser(REFERRAL_ROLES);
  const r = await own(user.practiceId, id);
  const method = str(fd, "method") === "PRINT" ? "PRINT" : "FAX";
  const pdf = await referralLetterPdf(r.id, user.practiceId);
  const stored = await saveGenerated(user.practiceId, pdf, ".pdf");
  const doc = await prisma.patientDocument.create({
    data: {
      practiceId: user.practiceId,
      patientId: r.patientId,
      name: `${new Date().toISOString().slice(0, 10)} Referral to ${r.toName} - ${r.patient.lastName}, ${r.patient.firstName}.pdf`.slice(0, 180),
      originalName: "Referral.pdf",
      filePath: stored.filePath,
      mimeType: "application/pdf",
      sizeBytes: stored.sizeBytes,
      docType: "REFERRAL",
      status: "APPLIED",
      uploadedById: user.id,
    },
  });
  let faxId: string | null = null;
  if (method === "FAX") {
    const number = faxNumberOrNull(str(fd, "fax") || r.toFax);
    if (!number) go(`/referrals/${id}`, { error: "Enter the specialist's 10-digit fax number." });
    const settings = await prisma.practiceSettings.findUnique({ where: { practiceId: user.practiceId } });
    const res = await getFaxAdapter(settings?.faxProvider).send({ to: number!, recipientName: r.toName, pages: 1, title: "Referral" });
    const fax = await prisma.fax.create({
      data: { practiceId: user.practiceId, direction: "OUTBOUND", status: res.status, faxNumber: number!, recipientName: r.toName, pages: 1, contentType: "Referral", patientId: r.patientId, encounterId: r.encounterId, documentId: doc.id, error: res.error ?? null, providerRef: res.providerRef ?? null, userId: user.id, sentAt: new Date() },
    });
    if (res.status !== "SUCCESS") go(`/referrals/${id}`, { error: `Fax failed: ${res.error ?? "unknown error"}` });
    faxId = fax.id;
  }
  await prisma.outgoingReferral.update({ where: { id }, data: { status: r.status === "DRAFT" ? "SENT" : r.status, sentVia: method, sentAt: new Date(), faxId, letterDocumentId: doc.id, toFax: method === "FAX" ? faxNumberOrNull(str(fd, "fax") || r.toFax) : r.toFax } });
  await logAudit(user.practiceId, user.id, "SEND_REFERRAL", "OutgoingReferral", id, `${r.toName} via ${method}`);
  go(`/referrals/${id}`, { ok: method === "FAX" ? `Faxed to ${r.toName}.` : "Letter saved to the patient's documents — print it for the patient." });
}

export async function updateReferral(id: string, fd: FormData) {
  const user = await requireUser(REFERRAL_ROLES);
  const r = await own(user.practiceId, id);
  const step = str(fd, "step");
  if (step === "scheduled") {
    const at = str(fd, "appointmentAt") ? new Date(`${str(fd, "appointmentAt")}T09:00:00`) : null;
    await prisma.outgoingReferral.update({ where: { id }, data: { status: "SCHEDULED", appointmentAt: at && !Number.isNaN(at.getTime()) ? at : null } });
  } else if (step === "consult") {
    const doc = await prisma.patientDocument.findFirst({ where: { id: str(fd, "documentId"), patientId: r.patientId, practiceId: user.practiceId } });
    if (!doc) go(`/referrals/${id}`, { error: "Pick the consult note from the patient's documents (upload or file the fax first)." });
    await prisma.outgoingReferral.update({ where: { id }, data: { status: "CONSULT_RECEIVED", consultDocumentId: doc!.id, consultReceivedAt: new Date() } });
    await completeSourceTasks(user.practiceId, "REFERRAL_OVERDUE", id, user.id);
  } else if (step === "close" || step === "cancel") {
    await prisma.outgoingReferral.update({ where: { id }, data: { status: step === "close" ? "CLOSED" : "CANCELLED", closedReason: str(fd, "reason").slice(0, 200) || null } });
    await completeSourceTasks(user.practiceId, "REFERRAL_OVERDUE", id, user.id);
  }
  await logAudit(user.practiceId, user.id, "UPDATE_REFERRAL", "OutgoingReferral", id, step);
  go(`/referrals/${id}`, { ok: "Updated." });
}
