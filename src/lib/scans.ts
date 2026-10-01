import "server-only";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { saveUpload } from "@/lib/storage";
import { processDocument } from "@/lib/document-reader";
import { SCAN_GROUPS, extensionOf, parseExtraction, suggestedDocumentName } from "@/lib/patient-docs";

export class ScanError extends Error {}

export const MAX_SCANS_PER_UPLOAD = 20;

export function uploadedFiles(fd: FormData, key: string) {
  return fd.getAll(key).filter((f): f is File => f instanceof File && f.size > 0);
}

// "2026-10-01 Referral - Doe, Jane.pdf", made unique among the patient's scans.
async function patientScanName(doc: { id: string; patientId: string | null; docType: string; originalName: string; mimeType: string; extraction: string | null }, patient: { firstName: string; lastName: string }) {
  const referralDate = parseExtraction(doc.extraction)?.fields["referral.referralDate"]?.value || null;
  const ext = extensionOf(doc.originalName, doc.mimeType);
  const base = suggestedDocumentName({ docType: doc.docType, lastName: patient.lastName, firstName: patient.firstName, date: referralDate, ext });
  const taken = new Set((await prisma.patientDocument.findMany({ where: { patientId: doc.patientId, id: { not: doc.id } }, select: { name: true } })).map((d) => d.name));
  let name = base;
  for (let n = 2; taken.has(name) && n < 50; n++) name = `${base.slice(0, base.length - ext.length)} (${n})${ext}`;
  return name;
}

// Files a read (or unreadable) document under its patient's Scans: named after what it is and who it is for.
export async function fileScan(docId: string, opts: { rename: boolean; reviewedById?: string | null }) {
  const doc = await prisma.patientDocument.findUnique({ where: { id: docId }, include: { patient: { select: { firstName: true, lastName: true } } } });
  if (!doc || !doc.patient) return;
  await prisma.patientDocument.update({
    where: { id: doc.id },
    data: {
      status: "APPLIED",
      appliedAt: new Date(),
      reviewedById: opts.reviewedById ?? doc.reviewedById,
      // A document the reader couldn't classify keeps the name it was uploaded with.
      ...(opts.rename && doc.docType !== "OTHER" ? { name: await patientScanName(doc, doc.patient) } : {}),
    },
  });
}

// Reads a stored document (text layer, OCR or Claude), works out what it is, then files it.
export async function readAndFileScan(docId: string, rename: boolean) {
  await processDocument(docId);
  await fileScan(docId, { rename });
}

// Files uploaded for a patient become scans on their chart (Scans page and dashboard widget).
// A scan left "Unsorted" or filed as an insurance card is read first so it can be classified, named and used to fill insurance.
export async function saveScanFiles(input: {
  user: { id: string; practiceId: string };
  patientId: string;
  files: File[];
  group: string;
  encounterId?: string | null;
  title?: string | null;
}) {
  const { user, patientId, files } = input;
  if (files.length > MAX_SCANS_PER_UPLOAD) throw new ScanError(`Add up to ${MAX_SCANS_PER_UPLOAD} documents at a time.`);
  const group = input.group in SCAN_GROUPS ? input.group : "OTHER";
  const toRead = group === "OTHER" || group === "INSURANCE_CARD";
  const read: { id: string; rename: boolean }[] = [];
  for (const file of files) {
    let stored;
    try {
      stored = await saveUpload(file, user.practiceId);
    } catch (err) {
      throw new ScanError(`${file.name}: ${err instanceof Error ? err.message : "upload failed"}`);
    }
    const titled = files.length === 1 && Boolean(input.title);
    const doc = await prisma.patientDocument.create({
      data: {
        practiceId: user.practiceId,
        patientId,
        encounterId: input.encounterId ?? null,
        name: titled ? input.title! : stored.fileName,
        originalName: stored.fileName,
        filePath: stored.filePath,
        mimeType: stored.mimeType,
        sizeBytes: file.size,
        docType: group,
        status: toRead ? "PROCESSING" : "APPLIED",
        uploadedById: user.id,
      },
    });
    // A title the user typed is kept; otherwise the scan is named after what the reader finds.
    if (toRead) read.push({ id: doc.id, rename: !titled });
    await logAudit(user.practiceId, user.id, "ADD_SCAN", "PatientDocument", doc.id, `${SCAN_GROUPS[group]}: ${doc.name}`);
  }
  // Reading runs after the response.
  for (const r of read) void readAndFileScan(r.id, r.rename).catch(() => undefined);
  return files.length;
}
