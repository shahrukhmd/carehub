import { getCurrentUser } from "@/lib/auth";
import { CREDENTIALING_ROLES, credentialingPracticeIds } from "@/lib/scope";
import { prisma } from "@/lib/prisma";
import { readUpload } from "@/lib/storage";
import { logAudit } from "@/lib/audit";

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  if (!CREDENTIALING_ROLES.includes(user.role)) return new Response("Forbidden", { status: 403 });

  const { kind, id } = await params;
  let file: { path: string; name: string; mimeType: string } | null = null;

  if (kind === "document") {
    const doc = await prisma.providerDocument.findFirst({
      where: { id, renderingProvider: { practiceId: { in: credentialingPracticeIds(user) } } },
    });
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
