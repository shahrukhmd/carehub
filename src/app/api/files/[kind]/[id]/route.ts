import { getCurrentUser } from "@/lib/auth";
import { chartAccess } from "@/lib/privacy";
import { CREDENTIALING_ROLES, credentialingPracticeIds } from "@/lib/scope";
import { prisma } from "@/lib/prisma";
import { readUpload } from "@/lib/storage";
import { logAudit } from "@/lib/audit";
import { ENCOUNTER_VIEW_ROLES } from "@/lib/visit-workflow";
import { GATEWAY_ROLES } from "@/lib/gateway";
import { allowed } from "@/lib/permissions";

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  const { kind, id } = await params;
  // Visit attachments follow chart access; credentialing files follow credentialing access.
  const permitted =
    kind === "attachment"
      ? allowed(user, ENCOUNTER_VIEW_ROLES)
      : kind === "patientdoc" || kind === "patientphoto"
        ? allowed(user, GATEWAY_ROLES) || allowed(user, ENCOUNTER_VIEW_ROLES)
        : allowed(user, CREDENTIALING_ROLES);
  if (!permitted) return new Response("Forbidden", { status: 403 });

  let file: { path: string; name: string; mimeType: string } | null = null;
  // Restricted charts: a file of a patient the user may not open is not served either.
  let patientId: string | null = null;

  if (kind === "patientdoc") {
    const d = await prisma.patientDocument.findFirst({ where: { id, practiceId: user.practiceId } });
    if (d) file = { path: d.filePath, name: d.name, mimeType: d.mimeType };
    patientId = d?.patientId ?? null;
  } else if (kind === "patientphoto") {
    const p = await prisma.patient.findFirst({ where: { id, practiceId: user.practiceId }, select: { photoPath: true } });
    if (p?.photoPath) file = { path: p.photoPath, name: "patient-photo", mimeType: mimeFromStoredPath(p.photoPath) };
    patientId = id;
  } else if (kind === "attachment") {
    const a = await prisma.encounterAttachment.findFirst({ where: { id, encounter: { practiceId: user.practiceId } }, include: { encounter: { select: { patientId: true } } } });
    if (a) file = { path: a.filePath, name: a.fileName, mimeType: a.mimeType };
    patientId = a?.encounter.patientId ?? null;
  } else if (kind === "document") {
    const doc = await prisma.providerDocument.findFirst({
      where: { id, renderingProvider: { practiceId: { in: credentialingPracticeIds(user) } } },
    });
    if (doc) file = { path: doc.filePath, name: doc.fileName, mimeType: doc.mimeType };
  } else if (kind === "groupdoc") {
    const doc = await prisma.groupDocument.findFirst({ where: { id, billingProvider: { practiceId: { in: credentialingPracticeIds(user) } } } });
    if (doc) file = { path: doc.filePath, name: doc.fileName, mimeType: doc.mimeType };
  } else if (kind === "approval") {
    const enrollment = await prisma.providerEnrollment.findFirst({
      where: { id, renderingProvider: { practiceId: { in: credentialingPracticeIds(user) } } },
    });
    if (enrollment?.approvalLetterPath) {
      const name = enrollment.approvalLetterName ?? "approval-letter";
      file = { path: enrollment.approvalLetterPath, name, mimeType: mimeFromStoredPath(enrollment.approvalLetterPath) };
    }
  }

  if (!file) return new Response("Not found", { status: 404 });
  if (patientId && (await chartAccess(user, patientId)) === "BLOCKED") return new Response("This chart is restricted", { status: 403 });

  let bytes: Buffer;
  try {
    bytes = await readUpload(file.path);
  } catch {
    return new Response("File is missing from storage", { status: 404 });
  }
  await logAudit(user.practiceId, user.id, "VIEW_FILE", kind, id, file.name);

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `inline; filename="${file.name.replace(/["\r\n]/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// Stored names always carry the extension saveUpload derived from the validated MIME type.
function mimeFromStoredPath(storedPath: string) {
  if (storedPath.endsWith(".pdf")) return "application/pdf";
  if (storedPath.endsWith(".png")) return "image/png";
  if (storedPath.endsWith(".jpg")) return "image/jpeg";
  if (storedPath.endsWith(".doc")) return "application/msword";
  if (storedPath.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}
