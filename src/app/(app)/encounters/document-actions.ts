"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { canEditClinical, visitStatusLabel } from "@/lib/visit-workflow";
import { collectValues, parseFields } from "@/lib/chart-forms";
import { getUploadedFile, saveUpload } from "@/lib/storage";

class DocumentError extends Error {}

function fail(message: string): never {
  throw new DocumentError(message);
}

// `next` is "templateKey" or "templateKey.woundId" — where to go after saving.
function stepHref(encounterId: string, next: string, error?: string) {
  const params = new URLSearchParams();
  const m = next.match(/^([a-z0-9_]+)(?:\.([a-z0-9]+))?$/);
  if (m) {
    params.set("step", m[1]);
    if (m[2]) params.set("wound", m[2]);
  }
  if (error) params.set("error", error.slice(0, 300));
  const q = params.toString();
  return `/encounters/${encounterId}${q ? `?${q}` : ""}`;
}

async function guarded(encounterId: string, back: string, work: () => Promise<string | void>) {
  let target: string;
  try {
    const next = await work();
    target = stepHref(encounterId, next ?? back);
  } catch (err) {
    if (!(err instanceof DocumentError)) throw err;
    target = stepHref(encounterId, back, err.message);
  }
  revalidatePath(`/encounters/${encounterId}`, "layout");
  redirect(target);
}

async function editableEncounter(encounterId: string, user: { practiceId: string; role: string }) {
  const e = await prisma.encounter.findFirst({
    where: { id: encounterId, practiceId: user.practiceId },
    include: { patient: { include: { wounds: { where: { status: { not: "HEALED" } }, select: { id: true } } } } },
  });
  if (!e) fail("Visit not found.");
  if (!canEditClinical(e.status, user.role)) {
    fail(`Documents can't be changed while the visit is "${visitStatusLabel[e.status] ?? e.status}".`);
  }
  return e;
}

export async function saveDocument(encounterId: string, templateId: string, woundKey: string, fd: FormData) {
  const back = String(fd.get("back") ?? "");
  return guarded(encounterId, back, async () => {
    const user = await requireUser(["ADMIN", "CLINICIAN"]);
    const e = await editableEncounter(encounterId, user);
    const template = await prisma.documentTemplate.findFirst({ where: { id: templateId, practiceId: user.practiceId, kind: "FORM" } });
    if (!template) fail("Document template not found.");
    if (template.perWound && !e.patient.wounds.some((w) => w.id === woundKey)) fail("Pick an open wound for this document.");
    if (!template.perWound) woundKey = "";

    const existing = await prisma.encounterDocument.findUnique({
      where: { encounterId_templateId_woundKey: { encounterId, templateId, woundKey } },
    });
    if (existing?.signedAt) fail(`${template.name} is signed — remove the signature to make changes.`);

    const fields = parseFields(template.fields);
    const { values, missing, answered, score } = collectValues(fields, fd);
    const complete = answered && missing.length === 0;
    const data = {
      data: JSON.stringify(values),
      status: complete ? "COMPLETE" : "DRAFT",
      score,
      templateVersion: template.version,
      completedById: complete ? (existing?.completedById ?? user.id) : null,
      completedAt: complete ? (existing?.completedAt ?? new Date()) : null,
    };
    await prisma.encounterDocument.upsert({
      where: { encounterId_templateId_woundKey: { encounterId, templateId, woundKey } },
      update: data,
      create: { encounterId, templateId, woundKey, ...data },
    });
    revalidatePath("/encounters");
    if (answered && missing.length) fail(`Saved as draft — still required: ${missing.join(", ")}`);
    return String(fd.get("next") ?? "") || back;
  });
}

export async function signDocument(encounterId: string, documentId: string, fd: FormData) {
  const back = String(fd.get("back") ?? "");
  return guarded(encounterId, back, async () => {
    const user = await requireUser(["ADMIN", "CLINICIAN"]);
    await editableEncounter(encounterId, user);
    const doc = await prisma.encounterDocument.findFirst({ where: { id: documentId, encounterId }, include: { template: true } });
    if (!doc) fail("Document not found.");
    if (doc.status !== "COMPLETE") fail("Complete the required fields before signing.");
    if (doc.signedAt) fail("Already signed.");
    if (fd.get("attest") !== "on") fail("Tick the attestation to sign.");
    const signedName = String(fd.get("signedName") ?? "").trim();
    if (!signedName) fail("Type your name to sign.");
    const onFile = await prisma.user.findUnique({ where: { id: user.id }, select: { signatureImage: true } });
    await prisma.encounterDocument.update({
      where: { id: doc.id },
      data: { signedById: user.id, signedName, signedAt: new Date(), signatureImage: onFile?.signatureImage ?? null },
    });
    await logAudit(user.practiceId, user.id, "SIGN_DOCUMENT", "EncounterDocument", doc.id, doc.template.name);
  });
}

export async function unsignDocument(encounterId: string, documentId: string, fd: FormData) {
  const back = String(fd.get("back") ?? "");
  return guarded(encounterId, back, async () => {
    const user = await requireUser(["ADMIN", "CLINICIAN"]);
    await editableEncounter(encounterId, user);
    const doc = await prisma.encounterDocument.findFirst({ where: { id: documentId, encounterId }, include: { template: true } });
    if (!doc?.signedAt) fail("Document isn't signed.");
    if (doc.signedById !== user.id && user.role !== "ADMIN") fail("Only the signer (or an administrator) can remove this signature.");
    await prisma.encounterDocument.update({
      where: { id: doc.id },
      data: { signedById: null, signedName: null, signedAt: null, signatureImage: null },
    });
    await logAudit(user.practiceId, user.id, "UNSIGN_DOCUMENT", "EncounterDocument", doc.id, doc.template.name);
  });
}

export async function setEncounterWorkflow(encounterId: string, fd: FormData) {
  return guarded(encounterId, "", async () => {
    const user = await requireUser(["ADMIN", "CLINICIAN"]);
    const e = await editableEncounter(encounterId, user);
    const workflowId = String(fd.get("workflowId") ?? "");
    const wf = await prisma.chartWorkflow.findFirst({ where: { id: workflowId, practiceId: user.practiceId, active: true } });
    if (!wf) fail("Pick a chart workflow.");
    await prisma.encounter.update({ where: { id: e.id }, data: { workflowId: wf.id } });
    await prisma.encounterEvent.create({
      data: { encounterId: e.id, userId: user.id, fromStatus: e.status, toStatus: e.status, note: `Chart workflow: ${wf.name}` },
    });
  });
}

const ATTACHMENT_ROLES = ["ADMIN", "CLINICIAN", "CDS", "BILLER"];

export async function uploadAttachment(encounterId: string, fd: FormData) {
  const back = String(fd.get("back") ?? "scans");
  return guarded(encounterId, back, async () => {
    const user = await requireUser(ATTACHMENT_ROLES);
    const e = await prisma.encounter.findFirst({ where: { id: encounterId, practiceId: user.practiceId } });
    if (!e) fail("Visit not found.");
    const file = getUploadedFile(fd, "file");
    if (!file) fail("Choose a file to upload.");
    const category = String(fd.get("category") ?? "SCAN");
    if (!["SCAN", "TEST_RESULT", "PHOTO", "OTHER"].includes(category)) fail("Invalid category.");
    let stored;
    try {
      stored = await saveUpload(file, user.practiceId);
    } catch (err) {
      fail(err instanceof Error ? err.message : "Upload failed.");
    }
    const title = String(fd.get("title") ?? "").trim() || stored.fileName;
    await prisma.encounterAttachment.create({
      data: { encounterId, category, title: title.slice(0, 200), ...stored, uploadedById: user.id },
    });
    await logAudit(user.practiceId, user.id, "UPLOAD_ATTACHMENT", "Encounter", encounterId, title);
  });
}

export async function removeAttachment(encounterId: string, attachmentId: string, fd: FormData) {
  const back = String(fd.get("back") ?? "scans");
  return guarded(encounterId, back, async () => {
    const user = await requireUser(ATTACHMENT_ROLES);
    const a = await prisma.encounterAttachment.findFirst({ where: { id: attachmentId, encounterId, encounter: { practiceId: user.practiceId } } });
    if (!a) fail("File not found.");
    if (a.uploadedById !== user.id && user.role !== "ADMIN") fail("Only the person who uploaded the file (or an administrator) can remove it.");
    await prisma.encounterAttachment.delete({ where: { id: a.id } });
    await logAudit(user.practiceId, user.id, "REMOVE_ATTACHMENT", "Encounter", encounterId, a.title);
  });
}

// ---- Problem list (Documentation → Problem List) ----

export async function addProblem(encounterId: string, fd: FormData) {
  return guarded(encounterId, "problems", async () => {
    const user = await requireUser(["ADMIN", "CLINICIAN"]);
    const e = await editableEncounter(encounterId, user);
    const icd10 = String(fd.get("icd10") ?? "").trim().toUpperCase();
    const description = String(fd.get("description") ?? "").trim();
    if (!/^[A-Z][0-9][0-9A-Z](\.?[0-9A-Z]{1,4})?$/.test(icd10)) fail("Enter a valid ICD-10 code (e.g. L89.154).");
    if (!description) fail("Describe the problem.");
    const onset = String(fd.get("onsetDate") ?? "");
    await prisma.problem.create({
      data: {
        patientId: e.patientId,
        icd10,
        description: description.slice(0, 300),
        onsetDate: /^\d{4}-\d{2}-\d{2}$/.test(onset) ? new Date(`${onset}T00:00:00Z`) : null,
      },
    });
    revalidatePath(`/patients/${e.patientId}`);
  });
}

export async function setProblemStatus(encounterId: string, problemId: string, fd: FormData) {
  return guarded(encounterId, "problems", async () => {
    const user = await requireUser(["ADMIN", "CLINICIAN"]);
    const e = await editableEncounter(encounterId, user);
    const status = String(fd.get("status") ?? "");
    if (!["ACTIVE", "RESOLVED", "INACTIVE"].includes(status)) fail("Invalid problem status.");
    const problem = await prisma.problem.findFirst({ where: { id: problemId, patientId: e.patientId } });
    if (!problem) fail("Problem not found.");
    await prisma.problem.update({ where: { id: problem.id }, data: { status } });
    revalidatePath(`/patients/${e.patientId}`);
  });
}
