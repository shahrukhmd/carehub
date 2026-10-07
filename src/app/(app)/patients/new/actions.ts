"use server";

import { rolesFor } from "@/lib/permissions";
import path from "node:path";
import { unlink } from "node:fs/promises";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { saveUpload } from "@/lib/storage";
import { processDocument } from "@/lib/document-reader";
import { MAX_SCANS_PER_UPLOAD, uploadedFiles } from "@/lib/scans";

const REGISTER_ROLES = rolesFor("patients.edit");

// Ids of documents already read for this registration, as carried in the form / URL.
function docIds(raw: string) {
  return [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => /^[a-z0-9]{10,40}$/.test(s)))].slice(0, 40);
}

// Step one of Add Patient: store the uploaded documents, read every one (text layer, OCR or Claude), then reopen the
// form filled in from what was found. The documents stay unlinked until the patient is saved.
export async function readRegistrationDocuments(fd: FormData) {
  const user = await requireUser(REGISTER_ROLES);
  const already = docIds(String(fd.get("docs") ?? ""));
  const files = uploadedFiles(fd, "documents");
  function back(ids: string[], error?: string): never {
    const q = [ids.length ? `docs=${ids.join(",")}` : "", error ? `error=${encodeURIComponent(error.slice(0, 300))}` : ""].filter(Boolean).join("&");
    redirect(`/patients/new${q ? `?${q}` : ""}`);
  }
  if (files.length === 0) back(already, "Choose the documents to read first.");
  if (files.length > MAX_SCANS_PER_UPLOAD) back(already, `Upload up to ${MAX_SCANS_PER_UPLOAD} documents at a time.`);

  const created: string[] = [];
  for (const file of files) {
    let stored;
    try {
      stored = await saveUpload(file, user.practiceId);
    } catch (err) {
      back([...already, ...created], `${file.name}: ${err instanceof Error ? err.message : "upload failed"}`);
    }
    const doc = await prisma.patientDocument.create({
      data: {
        practiceId: user.practiceId,
        name: stored.fileName,
        originalName: stored.fileName,
        filePath: stored.filePath,
        mimeType: stored.mimeType,
        sizeBytes: file.size,
        docType: "OTHER",
        uploadedById: user.id,
      },
    });
    created.push(doc.id);
    await logAudit(user.practiceId, user.id, "UPLOAD_PATIENT_DOCUMENT", "PatientDocument", doc.id, stored.fileName);
  }
  // Read them all before showing the form; a document that can't be read is kept and marked as such.
  await Promise.all(created.map((id) => processDocument(id)));
  back([...already, ...created]);
}

// Drops one read document from this registration (it is deleted only if it was never linked to a patient).
export async function removeRegistrationDocument(docId: string, fd: FormData) {
  const user = await requireUser(REGISTER_ROLES);
  const remaining = docIds(String(fd.get("docs") ?? "")).filter((id) => id !== docId);
  const doc = await prisma.patientDocument.findFirst({ where: { id: docId, practiceId: user.practiceId, patientId: null, uploadedById: user.id } });
  if (doc) {
    await prisma.patientDocument.delete({ where: { id: doc.id } });
    const root = path.resolve(process.cwd(), "uploads");
    const full = path.resolve(root, doc.filePath);
    if (full.startsWith(root + path.sep)) await unlink(full).catch(() => undefined);
  }
  redirect(`/patients/new${remaining.length ? `?docs=${remaining.join(",")}` : ""}`);
}
