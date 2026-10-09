"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { collectValues, parseFields, typedSignature, type DocValues } from "@/lib/chart-forms";
import { saveUpload } from "@/lib/storage";
import { processDocument } from "@/lib/document-reader";
import { LOCK_MINUTES, MAX_DOB_ATTEMPTS, isPortalVerified, loadPortalRequest, portalState, startPortalSession } from "@/lib/connect/portal";
import { finalizeIntakeRequest, packetTemplates, parseAnswers } from "@/lib/connect/submit";
import { createIntakeRequest } from "@/lib/connect/core";

const back = (token: string, params: Record<string, string> = {}) => {
  const q = new URLSearchParams(params).toString();
  return `/p/${token}${q ? `?${q}` : ""}`;
};

async function openRequest(token: string) {
  const r = await loadPortalRequest(token);
  if (!r || portalState(r) !== "open") redirect(`/p/${token}`);
  if (!(await isPortalVerified(r))) redirect(`/p/${token}`);
  return r;
}

export async function verifyDob(token: string, fd: FormData) {
  const r = await loadPortalRequest(token);
  if (!r || !r.patient || portalState(r) !== "open") redirect(`/p/${token}`);
  if (r.lockedUntil && r.lockedUntil > new Date()) redirect(back(token, { error: "locked" }));
  const entered = String(fd.get("dob") ?? "");
  const actual = r.patient.dob.toISOString().slice(0, 10);
  if (entered !== actual) {
    const attempts = r.verifyAttempts + 1;
    await prisma.intakeRequest.update({
      where: { id: r.id },
      data: attempts >= MAX_DOB_ATTEMPTS ? { verifyAttempts: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { verifyAttempts: attempts },
    });
    redirect(back(token, { error: attempts >= MAX_DOB_ATTEMPTS ? "locked" : "dob" }));
  }
  await startPortalSession(r.id);
  await prisma.intakeRequest.update({
    where: { id: r.id },
    data: { verifyAttempts: 0, lockedUntil: null, status: r.status === "SENT" ? "OPENED" : r.status, openedAt: r.openedAt ?? new Date() },
  });
  redirect(back(token, { s: String(r.currentStep) }));
}

const DOC_TYPE_FOR = (label: string) =>
  /insurance/i.test(label) ? "INSURANCE_CARD" : /photo id|license|\bid\b/i.test(label) ? "PHOTO_ID" : "OTHER";

export async function saveStep(token: string, step: number, fd: FormData) {
  const r = await openRequest(token);
  const templates = await packetTemplates(r.practiceId, r.packet.templateKeys);
  const t = templates[step];
  if (!t) redirect(back(token, { s: String(templates.length) }));
  const fields = parseFields(t.fields);
  const answers = parseAnswers(r.answers);
  const previous: DocValues = answers[t.key] ?? {};
  const { values } = collectValues(fields, fd);

  // A signature already on file keeps its original time unless the signer typed a different name.
  for (const f of fields.filter((x) => x.type === "signature")) {
    const before = typedSignature(previous[f.id]);
    if (before && typedSignature(values[f.id])?.name === before.name) values[f.id] = previous[f.id];
  }
  // Photos / files are filed straight into Patient documents and read automatically.
  let uploadError: string | null = null;
  for (const f of fields.filter((x) => x.type === "file")) {
    const file = fd.get(`f_${f.id}`);
    if (file instanceof File && file.size > 0) {
      try {
        const stored = await saveUpload(file, r.practiceId);
        const doc = await prisma.patientDocument.create({
          data: {
            practiceId: r.practiceId,
            patientId: r.patientId,
            name: `${f.label}${r.patient ? ` - ${r.patient.lastName}, ${r.patient.firstName}` : ""}${stored.fileName.match(/\.[a-z0-9]+$/i)?.[0] ?? ""}`.slice(0, 180),
            originalName: stored.fileName,
            filePath: stored.filePath,
            mimeType: stored.mimeType,
            sizeBytes: file.size,
            docType: DOC_TYPE_FOR(f.label),
          },
        });
        void processDocument(doc.id).catch(() => undefined);
        values[f.id] = doc.id;
      } catch (err) {
        uploadError = err instanceof Error ? err.message : "Upload failed";
      }
    } else if (previous[f.id]) {
      values[f.id] = previous[f.id];
    }
  }
  answers[t.key] = values;
  // Remember the form exactly as answered (the designer may change it later).
  let snapshots: Record<string, { version: number; fields: string }> = {};
  try {
    snapshots = JSON.parse(r.formSnapshots || "{}");
  } catch {
    snapshots = {};
  }
  snapshots[t.key] = { version: t.version, fields: t.fields };
  const missing = fields.filter((f) => f.required && ["text", "textarea", "number", "date", "yesno", "select", "radio", "checkboxes", "checkbox", "consent", "signature", "file"].includes(f.type)).filter((f) => {
    const v = values[f.id];
    return Array.isArray(v) ? v.length === 0 : !v;
  });
  const nextStep = missing.length || uploadError ? step : step + 1;
  await prisma.intakeRequest.update({
    where: { id: r.id },
    data: { answers: JSON.stringify(answers), formSnapshots: JSON.stringify(snapshots), currentStep: Math.max(r.currentStep, nextStep), status: "IN_PROGRESS" },
  });
  if (uploadError) redirect(back(token, { s: String(step), error: "upload", msg: uploadError.slice(0, 120) }));
  if (missing.length) redirect(back(token, { s: String(step), error: "missing", msg: missing.map((f) => f.label).join(", ").slice(0, 200) }));
  redirect(back(token, { s: String(nextStep) }));
}

export async function submitPacket(token: string) {
  const r = await openRequest(token);
  const templates = await packetTemplates(r.practiceId, r.packet.templateKeys);
  const answers = parseAnswers(r.answers);
  for (const [i, t] of templates.entries()) {
    const values = answers[t.key] ?? {};
    const missing = parseFields(t.fields).filter((f) => f.required && !["heading", "note", "score"].includes(f.type) && !values[f.id]);
    if (missing.length) redirect(back(token, { s: String(i), error: "missing", msg: missing.map((f) => f.label).join(", ").slice(0, 200) }));
  }
  await finalizeIntakeRequest(r.id);
  redirect(`/p/${token}`);
}

// Walk-in self-registration: a kiosk / QR link starts a new packet with no chart yet (no DOB check).
export async function startKiosk(kioskToken: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(kioskToken)) redirect("/");
  const k = await prisma.kioskLink.findUnique({ where: { token: kioskToken } });
  if (!k || !k.active) redirect(`/k/${kioskToken}`);
  const r = await createIntakeRequest({ practiceId: k.practiceId, packetId: k.packetId, patientId: null, channel: "KIOSK", kioskLinkId: k.id });
  await startPortalSession(r.id);
  await prisma.intakeRequest.update({ where: { id: r.id }, data: { status: "OPENED", openedAt: new Date() } });
  redirect(`/p/${r.token}?s=0`);
}
