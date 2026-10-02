"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { PATIENT_EDIT_ROLES, PATIENT_VIEW_ROLES } from "@/lib/gateway";
import {
  AMENDMENT_DAYS,
  EMERGENCY_ACCESS_HOURS,
  amendmentDenialLabel,
  consentMethodLabel,
  disclosureMethodLabel,
  disclosurePurposeLabel,
  emergencyReasonLabel,
  requireChartAccess,
} from "@/lib/privacy";

// Front office and billing record disclosures and requests; decisions and chart restriction are for administrators
// and clinicians.
const PRIVACY_ROLES = [...new Set([...PATIENT_EDIT_ROLES, "CLINICIAN", "BILLER"])];
const DECIDE_ROLES = ["ADMIN", "CLINICIAN"];
const CHART_ROLES = [...new Set([...PATIENT_VIEW_ROLES, "BILLER", "CDS"])];

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const day = (fd: FormData, k: string) => {
  const v = str(fd, k);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

function back(patientId: string, msg: { error?: string; ok?: string }): never {
  revalidatePath(`/patients/${patientId}/privacy`);
  revalidatePath("/settings/privacy");
  const q = msg.error ? `?error=${encodeURIComponent(msg.error.slice(0, 300))}` : `?ok=${encodeURIComponent(msg.ok ?? "Saved.")}`;
  redirect(`/patients/${patientId}/privacy${q}`);
}

async function privacyUser(patientId: string, roles = PRIVACY_ROLES) {
  const user = await requireUser(roles);
  const patient = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId }, select: { id: true } });
  if (!patient) redirect("/patients");
  await requireChartAccess(user, patientId, `/patients/${patientId}/privacy`);
  return user;
}

// ---- Accounting of disclosures ----

export async function addDisclosure(patientId: string, fd: FormData) {
  const user = await privacyUser(patientId);
  const disclosedAt = day(fd, "disclosedAt");
  const recipient = str(fd, "recipient").slice(0, 160);
  const description = str(fd, "description").slice(0, 600);
  const purpose = str(fd, "purpose");
  if (!disclosedAt) back(patientId, { error: "Enter the date of the disclosure." });
  if (disclosedAt! > new Date(Date.now() + 86_400_000)) back(patientId, { error: "The disclosure date can't be in the future." });
  if (!recipient) back(patientId, { error: "Enter who received the information." });
  if (!description) back(patientId, { error: "Describe what was disclosed." });
  if (!(purpose in disclosurePurposeLabel)) back(patientId, { error: "Pick the purpose of the disclosure." });
  const method = str(fd, "method");
  const row = await prisma.disclosure.create({
    data: {
      practiceId: user.practiceId,
      patientId,
      disclosedAt: disclosedAt!,
      recipient,
      recipientAddress: str(fd, "recipientAddress").slice(0, 240) || null,
      purpose,
      description,
      method: method in disclosureMethodLabel ? method : null,
      notes: str(fd, "notes").slice(0, 600) || null,
      createdById: user.id,
    },
  });
  await logAudit(user.practiceId, user.id, "LOG_DISCLOSURE", "Disclosure", row.id, `${recipient} · ${purpose}`);
  back(patientId, { ok: "Disclosure recorded." });
}

// A disclosure entered by mistake is removed by an administrator; the removal itself stays in the audit log.
export async function deleteDisclosure(patientId: string, disclosureId: string) {
  const user = await privacyUser(patientId, ["ADMIN"]);
  const row = await prisma.disclosure.findFirst({ where: { id: disclosureId, patientId, practiceId: user.practiceId } });
  if (!row) back(patientId, { error: "Disclosure not found." });
  await prisma.disclosure.delete({ where: { id: row!.id } });
  await logAudit(user.practiceId, user.id, "DELETE_DISCLOSURE", "Disclosure", row!.id, `${row!.recipient} · ${row!.description.slice(0, 80)}`);
  back(patientId, { ok: "Disclosure removed." });
}

// ---- Amendment requests ----

export async function addAmendment(patientId: string, fd: FormData) {
  const user = await privacyUser(patientId);
  const requestedAt = day(fd, "requestedAt");
  const section = str(fd, "section").slice(0, 160);
  const requestText = str(fd, "requestText").slice(0, 2000);
  if (!requestedAt) back(patientId, { error: "Enter the date the request was received." });
  if (!section) back(patientId, { error: "Enter which part of the record the request is about." });
  if (!requestText) back(patientId, { error: "Enter what the patient wants changed." });
  const row = await prisma.amendmentRequest.create({
    data: {
      practiceId: user.practiceId,
      patientId,
      requestedAt: requestedAt!,
      requestedBy: str(fd, "requestedBy").slice(0, 120) || "Patient",
      section,
      requestText,
      reason: str(fd, "reason").slice(0, 1000) || null,
      dueAt: new Date(requestedAt!.getTime() + AMENDMENT_DAYS * 86_400_000),
      createdById: user.id,
    },
  });
  await logAudit(user.practiceId, user.id, "AMENDMENT_REQUEST", "AmendmentRequest", row.id, section);
  back(patientId, { ok: `Amendment request recorded. A decision is due within ${AMENDMENT_DAYS} days.` });
}

export async function decideAmendment(patientId: string, requestId: string, fd: FormData) {
  const user = await privacyUser(patientId, DECIDE_ROLES);
  const row = await prisma.amendmentRequest.findFirst({ where: { id: requestId, patientId, practiceId: user.practiceId } });
  if (!row) back(patientId, { error: "Request not found." });
  if (row!.status !== "PENDING") back(patientId, { error: "This request already has a decision." });
  const decision = str(fd, "decision");
  if (decision !== "ACCEPTED" && decision !== "DENIED") back(patientId, { error: "Choose accept or deny." });
  const denialReason = str(fd, "denialReason");
  if (decision === "DENIED" && !(denialReason in amendmentDenialLabel)) back(patientId, { error: "A denial needs one of the permitted reasons." });
  const note = str(fd, "decisionNote").slice(0, 1000);
  if (decision === "ACCEPTED" && !note) back(patientId, { error: "Note what was changed in the record and who else was told." });
  await prisma.amendmentRequest.update({
    where: { id: row!.id },
    data: {
      status: decision,
      decidedAt: new Date(),
      decidedById: user.id,
      decisionNote: note || null,
      denialReason: decision === "DENIED" ? denialReason : null,
      patientNotifiedAt: day(fd, "patientNotifiedAt"),
    },
  });
  await logAudit(user.practiceId, user.id, `AMENDMENT_${decision}`, "AmendmentRequest", row!.id, row!.section);
  back(patientId, { ok: `Amendment request ${decision === "ACCEPTED" ? "accepted" : "denied"}.` });
}

// After a denial the patient may file a statement of disagreement, which stays with the record.
export async function recordDisagreement(patientId: string, requestId: string, fd: FormData) {
  const user = await privacyUser(patientId);
  const row = await prisma.amendmentRequest.findFirst({ where: { id: requestId, patientId, practiceId: user.practiceId, status: "DENIED" } });
  if (!row) back(patientId, { error: "Request not found." });
  const text = str(fd, "disagreement").slice(0, 2000);
  if (!text) back(patientId, { error: "Enter the patient's statement." });
  await prisma.amendmentRequest.update({ where: { id: row!.id }, data: { disagreement: text } });
  await logAudit(user.practiceId, user.id, "AMENDMENT_DISAGREEMENT", "AmendmentRequest", row!.id, row!.section);
  back(patientId, { ok: "Statement of disagreement filed with the record." });
}

// ---- Consent to texts and calls ----

export async function saveConsent(patientId: string, fd: FormData) {
  const user = await privacyUser(patientId);
  const pick = (k: string) => (["YES", "NO"].includes(str(fd, k)) ? str(fd, k) : null);
  const method = str(fd, "consentMethod");
  const textConsent = pick("textConsent");
  const voiceConsent = pick("voiceConsent");
  if ((textConsent === "YES" || voiceConsent === "YES") && !(method in consentMethodLabel)) back(patientId, { error: "Pick how the consent was given." });
  await prisma.patient.update({
    where: { id: patientId },
    data: { textConsent, voiceConsent, consentMethod: method in consentMethodLabel ? method : null, consentRecordedAt: new Date(), consentRecordedById: user.id },
  });
  await logAudit(user.practiceId, user.id, "UPDATE_CONSENT", "Patient", patientId, `text ${textConsent ?? "not asked"} · calls ${voiceConsent ?? "not asked"}`);
  back(patientId, { ok: "Communication consent saved." });
}

// ---- Restricted chart ----

export async function setRestricted(patientId: string, fd: FormData) {
  const user = await privacyUser(patientId, DECIDE_ROLES);
  const restricted = fd.get("restricted") === "on";
  const reason = str(fd, "restrictedReason").slice(0, 300);
  if (restricted && !reason) back(patientId, { error: "Note why the chart is restricted (for example: employee, VIP, patient request)." });
  await prisma.patient.update({ where: { id: patientId }, data: { restricted, restrictedReason: restricted ? reason : null } });
  await logAudit(user.practiceId, user.id, restricted ? "RESTRICT_CHART" : "UNRESTRICT_CHART", "Patient", patientId, reason || undefined);
  back(patientId, { ok: restricted ? "Chart restricted to the care team." : "Chart restriction removed." });
}

// Break the glass: the reason is recorded, access lasts a few hours, and an administrator reviews it afterwards.
export async function breakGlass(patientId: string, fd: FormData) {
  const user = await requireUser(CHART_ROLES);
  const patient = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId }, select: { id: true, restricted: true } });
  if (!patient) redirect("/patients");
  const nextRaw = str(fd, "next");
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : `/patients/${patientId}`;
  if (!patient.restricted) redirect(next);
  const here = `/patients/${patientId}/break-glass?next=${encodeURIComponent(next)}`;
  const reason = str(fd, "reason");
  const note = str(fd, "note").slice(0, 500);
  if (!(reason in emergencyReasonLabel)) redirect(`${here}&error=${encodeURIComponent("Pick the reason you need this chart.")}`);
  if (reason === "OTHER" && note.length < 10) redirect(`${here}&error=${encodeURIComponent("Explain why you need this chart.")}`);
  if (fd.get("confirm") !== "on") redirect(`${here}&error=${encodeURIComponent("Tick the box to confirm you understand this access is recorded.")}`);
  const row = await prisma.emergencyAccess.create({
    data: { practiceId: user.practiceId, patientId, userId: user.id, reason, note: note || null, expiresAt: new Date(Date.now() + EMERGENCY_ACCESS_HOURS * 3_600_000) },
  });
  await logAudit(user.practiceId, user.id, "BREAK_GLASS", "Patient", patientId, `${reason}${note ? ` · ${note}` : ""} · access ${row.id}`);
  revalidatePath("/settings/privacy");
  redirect(next);
}
