import { getCurrentUser } from "@/lib/auth";
import { CREDENTIALING_ROLES, credentialingPracticeIds } from "@/lib/scope";
import { prisma } from "@/lib/prisma";
import { readUpload } from "@/lib/storage";
import { logAudit } from "@/lib/audit";
import { ENCOUNTER_VIEW_ROLES } from "@/lib/visit-workflow";
import { GATEWAY_ROLES } from "@/lib/gateway";

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  const { kind, id } = await params;
  // Visit attachments follow chart access; credentialing files follow credentialing access.
  const allowed =
    kind === "attachment"
      ? ENCOUNTER_VIEW_ROLES.includes(user.role)
      : kind === "patientdoc" || kind === "patientphoto"
        ? GATEWAY_ROLES.includes(user.role) || ENCOUNTER_VIEW_ROLES.includes(user.role)
        : CREDENTIALING_ROLES.includes(user.role);
  if (!allowed) return new Response("Forbidden", { status: 403 });

  let file: { path: string; name: string; mimeType: string } | null = null;

  if (kind === "patientdoc") {
    const d = await prisma.patientDocument.findFirst({ where: { id, practiceId: user.practiceId } });
    if (d) file = { path: d.filePath, name: d.name, mimeType: d.mimeType };
  } else if (kind === "patientphoto") {
    const p = await prisma.patient.findFirst({ where: { id, practiceId: user.practiceId }, select: { photoPath: true } });
    if (p?.photoPath) file = { path: p.photoPath, name: "patient-photo", mimeType: mimeFromStoredPath(p.photoPath) };
  } else if (kind === "attachment") {
    const a = await prisma.encounterAttachment.findFirst({ where: { id, encounter: { practiceId: user.practiceId } } });
    if (a) file = { path: a.filePath, name: a.fileName, mimeType: a.mimeType };
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
