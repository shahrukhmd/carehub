"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { logClaimEvent, refreshVisitBillingStatus } from "@/lib/claims";
import { claimNumber } from "@/lib/claim-format";
import { saveGenerated } from "@/lib/storage";
import { faxNumberOrNull, getFaxAdapter } from "@/lib/fax";
import { createTask } from "@/lib/tasks";
import {
  APPEAL_LEVELS,
  APPEAL_METHODS,
  DENIAL_CATEGORIES,
  DENIAL_ROLES,
  appealLetterPdf,
  appealLimitDays,
  closeDenialTasks,
  createAppeal,
  resolveDenials,
} from "@/lib/denials";

const DAY = 86_400_000;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const day = (v: string) => {
  const d = v ? new Date(`${v}T12:00:00`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};
// A date something happened on: today means now, so it never lands later than the present.
const happenedOn = (v: string) => {
  const d = day(v);
  return !d || d.toDateString() === new Date().toDateString() ? new Date() : d;
};

// Back to the claim's denial panel with a banner.
function back(claimId: string, msg?: { error?: string; ok?: string }): never {
  revalidatePath("/billing/denials");
  revalidatePath(`/billing/claims/${claimId}`);
  const q = msg?.error ? `?error=${encodeURIComponent(msg.error)}` : msg?.ok ? `?ok=${encodeURIComponent(msg.ok)}` : "";
  redirect(`/billing/claims/${claimId}${q}#denial`);
}

async function ownDenial(practiceId: string, id: string) {
  const d = await prisma.claimDenial.findFirst({ where: { id, practiceId }, include: { claim: { include: { patient: true, payer: true } }, appeals: true } });
  if (!d) redirect("/billing/denials");
  return d;
}

async function ownAppeal(practiceId: string, id: string) {
  const a = await prisma.claimAppeal.findFirst({ where: { id, practiceId }, include: { denial: { include: { claim: { include: { patient: true, payer: true } } } } } });
  if (!a) redirect("/billing/denials");
  return a;
}

// ---- Working a denial ----

export async function assignDenialToMe(denialId: string) {
  const user = await requireUser(DENIAL_ROLES);
  const d = await ownDenial(user.practiceId, denialId);
  await prisma.claimDenial.update({ where: { id: d.id }, data: { ownerId: user.id } });
  await prisma.task.updateMany({ where: { practiceId: user.practiceId, sourceType: "CLAIM_DENIAL", sourceId: d.id, status: "OPEN" }, data: { assignedToId: user.id, assignedRole: null } });
  await logClaimEvent(d.claimId, user.id, "DENIAL_ASSIGNED", { note: user.name });
  revalidatePath("/billing/denials");
}

export async function workDenial(denialId: string, fd: FormData) {
  const user = await requireUser(DENIAL_ROLES);
  const d = await ownDenial(user.practiceId, denialId);
  const ownerId = str(fd, "ownerId") || null;
  if (ownerId && !(await prisma.membership.findFirst({ where: { userId: ownerId, practiceId: user.practiceId } }))) back(d.claimId, { error: "That person isn't on this practice's staff." });
  const category = str(fd, "category");
  const dueAt = day(str(fd, "appealDueAt"));
  await prisma.claimDenial.update({
    where: { id: d.id },
    data: {
      ownerId,
      category: DENIAL_CATEGORIES[category] ? category : d.category,
      followUpAt: day(str(fd, "followUpAt")),
      workNote: str(fd, "workNote").slice(0, 2000) || null,
      appealDueAt: dueAt ?? d.appealDueAt,
    },
  });
  if (ownerId !== d.ownerId) {
    await prisma.task.updateMany({
      where: { practiceId: user.practiceId, sourceType: "CLAIM_DENIAL", sourceId: d.id, status: "OPEN" },
      data: ownerId ? { assignedToId: ownerId, assignedRole: null } : { assignedToId: null, assignedRole: "BILLER" },
    });
  }
  const note = str(fd, "workNote");
  if (note && note !== d.workNote) await logClaimEvent(d.claimId, user.id, "DENIAL_NOTE", { note: note.slice(0, 400) });
  back(d.claimId, { ok: "Denial updated." });
}

// The payer was right, or it isn't worth appealing: the balance becomes the patient's.
export async function transferDenialToPatient(denialId: string) {
  const user = await requireUser(DENIAL_ROLES);
  const d = await ownDenial(user.practiceId, denialId);
  if (d.status === "RESOLVED") back(d.claimId, { error: "This denial is already resolved." });
  if (d.appeals.some((a) => a.status === "FILED")) back(d.claimId, { error: "An appeal is waiting for a decision — record its outcome first." });
  await prisma.claim.update({ where: { id: d.claimId }, data: { status: "PARTIAL", balanceResponsibility: "PATIENT", statusNote: "Denied by payer — balance transferred to patient" } });
  await logClaimEvent(d.claimId, user.id, "STATUS", { field: "status", oldValue: d.claim.status, newValue: "PARTIAL", note: "Denial closed — balance transferred to patient" });
  await resolveDenials(d.claimId, "PATIENT", user.id);
  await logAudit(user.practiceId, user.id, "DENIAL_TO_PATIENT", "ClaimDenial", d.id, claimNumber(d.claim));
  await refreshVisitBillingStatus(d.claim.encounterId);
  revalidatePath("/billing");
  back(d.claimId, { ok: "Balance transferred to the patient — it will appear on the next statement." });
}

// ---- Appeals ----

export async function startAppeal(denialId: string) {
  const user = await requireUser(DENIAL_ROLES);
  const d = await ownDenial(user.practiceId, denialId);
  if (d.status === "RESOLVED") back(d.claimId, { error: "This denial is already resolved." });
  if (d.appeals.some((a) => ["DRAFT", "FILED"].includes(a.status))) back(d.claimId, { error: "There is already an appeal in progress for this denial." });
  if (d.appeals.filter((a) => a.status === "UPHELD").length >= 3) back(d.claimId, { error: "All three appeal levels have been used." });
  const appeal = await createAppeal(d.id, user.practiceId, user.id);
  if (!d.ownerId) await prisma.claimDenial.update({ where: { id: d.id }, data: { ownerId: user.id } });
  back(d.claimId, { ok: `${APPEAL_LEVELS[appeal.level]} drafted — review the letter, then file it.` });
}

export async function saveAppealLetter(appealId: string, fd: FormData) {
  const user = await requireUser(DENIAL_ROLES);
  const a = await ownAppeal(user.practiceId, appealId);
  if (a.status !== "DRAFT") back(a.claimId, { error: "A filed appeal's letter can't be changed." });
  const body = str(fd, "letterBody");
  if (body.length < 40) back(a.claimId, { error: "The appeal letter is empty." });
  await prisma.claimAppeal.update({ where: { id: a.id }, data: { letterBody: body.slice(0, 12_000) } });
  back(a.claimId, { ok: "Letter saved." });
}

export async function discardAppealDraft(appealId: string) {
  const user = await requireUser(DENIAL_ROLES);
  const a = await ownAppeal(user.practiceId, appealId);
  if (a.status !== "DRAFT") back(a.claimId, { error: "Only a draft can be discarded." });
  await prisma.claimAppeal.delete({ where: { id: a.id } });
  await logClaimEvent(a.claimId, user.id, "APPEAL_DISCARDED", { note: APPEAL_LEVELS[a.level] });
  back(a.claimId, { ok: "Draft appeal discarded." });
}

export async function fileAppeal(appealId: string, fd: FormData) {
  const user = await requireUser(DENIAL_ROLES);
  const a = await ownAppeal(user.practiceId, appealId);
  const claim = a.denial.claim;
  if (a.status !== "DRAFT") back(a.claimId, { error: "This appeal has already been filed." });
  const body = str(fd, "letterBody");
  if (body.length < 40) back(a.claimId, { error: "The appeal letter is empty." });
  const method = str(fd, "method") in APPEAL_METHODS ? str(fd, "method") : "FAX";
  const filedAt = happenedOn(str(fd, "filedAt"));
  if (filedAt.getTime() > Date.now()) back(a.claimId, { error: "The filing date can't be in the future." });
  const number = method === "FAX" ? faxNumberOrNull(str(fd, "fax") || claim.payer?.fax) : null;
  if (method === "FAX" && !number) back(a.claimId, { error: "Enter the payer's 10-digit appeals fax number." });

  await prisma.claimAppeal.update({ where: { id: a.id }, data: { letterBody: body.slice(0, 12_000) } });
  const pdf = await appealLetterPdf(a.id, user.practiceId);
  const stored = await saveGenerated(user.practiceId, pdf, ".pdf");
  const doc = await prisma.patientDocument.create({
    data: {
      practiceId: user.practiceId,
      patientId: claim.patientId,
      name: `${filedAt.toISOString().slice(0, 10)} Appeal L${a.level} ${claimNumber(claim)} to ${claim.payerName} - ${claim.patient.lastName}, ${claim.patient.firstName}.pdf`.slice(0, 180),
      originalName: "Appeal.pdf",
      filePath: stored.filePath,
      mimeType: "application/pdf",
      sizeBytes: stored.sizeBytes,
      docType: "OTHER",
      status: "APPLIED",
      uploadedById: user.id,
    },
  });
  let faxId: string | null = null;
  if (method === "FAX") {
    const settings = await prisma.practiceSettings.findUnique({ where: { practiceId: user.practiceId } });
    const res = await getFaxAdapter(settings?.faxProvider).send({ to: number!, recipientName: claim.payerName, pages: 1, title: "Claim appeal" });
    const fax = await prisma.fax.create({
      data: { practiceId: user.practiceId, direction: "OUTBOUND", status: res.status, faxNumber: number!, recipientName: `${claim.payerName} appeals`.slice(0, 120), pages: 1, contentType: "Claim appeal", patientId: claim.patientId, encounterId: claim.encounterId, documentId: doc.id, error: res.error ?? null, providerRef: res.providerRef ?? null, userId: user.id, sentAt: new Date() },
    });
    if (res.status !== "SUCCESS") back(a.claimId, { error: `Fax failed: ${res.error ?? "unknown error"}. The letter is saved — try again or file by mail.` });
    faxId = fax.id;
  }

  await prisma.claimAppeal.update({
    where: { id: a.id },
    data: { status: "FILED", filedAt, filedVia: method, faxId, letterDocumentId: doc.id, payerReference: str(fd, "payerReference").slice(0, 60) || null },
  });
  await prisma.claimDenial.update({ where: { id: a.denialId }, data: { status: "APPEALED", ownerId: a.denial.ownerId ?? user.id } });
  if (claim.status !== "APPEAL") {
    await prisma.claim.update({ where: { id: claim.id }, data: { status: "APPEAL", statusNote: `${APPEAL_LEVELS[a.level]} filed ${filedAt.toISOString().slice(0, 10)}` } });
    await logClaimEvent(claim.id, user.id, "STATUS", { field: "status", oldValue: claim.status, newValue: "APPEAL" });
  }
  await logClaimEvent(claim.id, user.id, "APPEAL_FILED", { note: `${APPEAL_LEVELS[a.level]} · ${APPEAL_METHODS[method].toLowerCase()}${number ? ` ${number}` : ""}` });
  await logAudit(user.practiceId, user.id, "FILE_APPEAL", "ClaimAppeal", a.id, `${claimNumber(claim)} · level ${a.level} · ${method}`);
  await closeDenialTasks(user.practiceId, a.denialId, user.id);
  await refreshVisitBillingStatus(claim.encounterId);
  revalidatePath("/billing");
  back(a.claimId, { ok: method === "FAX" ? `Appeal faxed to ${claim.payerName} and saved to the patient's documents.` : "Appeal recorded as filed — the letter is saved to the patient's documents for printing or upload." });
}

export async function recordAppealOutcome(appealId: string, fd: FormData) {
  const user = await requireUser(DENIAL_ROLES);
  const a = await ownAppeal(user.practiceId, appealId);
  const claim = a.denial.claim;
  if (a.status !== "FILED") back(a.claimId, { error: "Only a filed appeal can have a decision recorded." });
  const outcome = str(fd, "outcome");
  if (!["OVERTURNED", "PARTIAL", "UPHELD", "WITHDRAWN"].includes(outcome)) back(a.claimId, { error: "Choose the payer's decision." });
  const decisionAt = happenedOn(str(fd, "decisionAt"));
  if (decisionAt.getTime() > Date.now()) back(a.claimId, { error: "The decision date can't be in the future." });
  const note = str(fd, "outcomeNote").slice(0, 1000) || null;
  await prisma.claimAppeal.update({
    where: { id: a.id },
    data: { status: outcome, decisionAt, outcomeNote: note, payerReference: str(fd, "payerReference").slice(0, 60) || a.payerReference },
  });
  const won = outcome === "OVERTURNED" || outcome === "PARTIAL";
  if (won) {
    await prisma.claimDenial.update({ where: { id: a.denialId }, data: { status: "RESOLVED", resolution: "OVERTURNED", resolvedAt: decisionAt } });
    await closeDenialTasks(user.practiceId, a.denialId, user.id);
  } else {
    // Back on the worklist; the next appeal level runs from the decision date.
    const limit = await appealLimitDays(claim.payerId);
    await prisma.claimDenial.update({ where: { id: a.denialId }, data: { status: "OPEN", appealDueAt: outcome === "UPHELD" && a.level < 3 ? new Date(decisionAt.getTime() + limit * DAY) : a.denial.appealDueAt } });
    if (outcome === "UPHELD") {
      await createTask({
        practiceId: user.practiceId,
        type: "DENIAL",
        title: `Appeal upheld — ${claimNumber(claim)} · ${claim.patient.lastName}, ${claim.patient.firstName} · ${claim.payerName}`,
        body: `${APPEAL_LEVELS[a.level]} was upheld${note ? `: ${note}` : "."}\nDecide the next step: ${a.level < 3 ? "next appeal level, " : ""}transfer to the patient or write off.`,
        patientId: claim.patientId,
        assignedToId: a.denial.ownerId,
        assignedRole: "BILLER",
        createdById: user.id,
        priority: "HIGH",
        link: `/billing/claims/${claim.id}#denial`,
        sourceType: "CLAIM_DENIAL",
        sourceId: a.denialId,
      });
    }
  }
  const status = won ? "ACCEPTED" : "DENIED";
  if (["APPEAL", "DENIED"].includes(claim.status) && claim.status !== status) {
    await prisma.claim.update({ where: { id: claim.id }, data: { status, statusNote: won ? "Appeal overturned — awaiting payment" : `${APPEAL_LEVELS[a.level]} ${outcome === "UPHELD" ? "upheld" : "withdrawn"}` } });
    await logClaimEvent(claim.id, user.id, "STATUS", { field: "status", oldValue: claim.status, newValue: status });
  }
  await logClaimEvent(claim.id, user.id, "APPEAL_DECISION", { note: `${APPEAL_LEVELS[a.level]}: ${outcome.toLowerCase()}${note ? ` — ${note}` : ""}` });
  await logAudit(user.practiceId, user.id, "APPEAL_DECISION", "ClaimAppeal", a.id, `${claimNumber(claim)} · ${outcome}`);
  await refreshVisitBillingStatus(claim.encounterId);
  revalidatePath("/billing");
  back(a.claimId, { ok: won ? "Decision recorded — the claim is waiting for the payer's payment." : "Decision recorded — the denial is back on the worklist." });
}
