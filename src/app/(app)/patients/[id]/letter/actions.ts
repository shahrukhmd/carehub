"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { saveGenerated } from "@/lib/storage";
import { LETTER_ROLES, letterPdf } from "@/lib/letters";
import { faxNumberOrNull, getFaxAdapter } from "@/lib/fax";

export async function createLetter(patientId: string, fd: FormData) {
  const user = await requireUser(LETTER_ROLES);
  const patient = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId } });
  if (!patient) redirect("/patients");
  const subject = String(fd.get("subject") ?? "").trim().slice(0, 200);
  const body = String(fd.get("body") ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 20000);
  const name = String(fd.get("name") ?? "Letter").trim().slice(0, 80) || "Letter";
  if (!body) redirect(`/patients/${patientId}/letter?error=${encodeURIComponent("The letter is empty.")}`);
  if (/\{\{[\w.]+\}\}/.test(body + subject)) redirect(`/patients/${patientId}/letter?error=${encodeURIComponent("Some merge fields could not be filled — edit the text before saving.")}`);
  const me = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const bytes = await letterPdf({ practiceId: user.practiceId, patient, subject, body, signatureImage: fd.get("sign") === "on" ? me.signatureImage : null });
  const stored = await saveGenerated(user.practiceId, bytes, ".pdf");
  const day = new Date().toISOString().slice(0, 10);
  const doc = await prisma.patientDocument.create({
    data: {
      practiceId: user.practiceId,
      patientId,
      name: `${day} ${name} - ${patient.lastName}, ${patient.firstName}.pdf`.slice(0, 180),
      originalName: `${name}.pdf`,
      filePath: stored.filePath,
      mimeType: "application/pdf",
      sizeBytes: stored.sizeBytes,
      docType: "LETTER",
      status: "APPLIED",
      pageCount: 1,
      uploadedById: user.id,
    },
  });
  await logAudit(user.practiceId, user.id, "CREATE_LETTER", "PatientDocument", doc.id, name);
  const faxTo = faxNumberOrNull(String(fd.get("faxTo") ?? ""));
  if (faxTo) {
    const settings = await prisma.practiceSettings.findUnique({ where: { practiceId: user.practiceId } });
    const r = await getFaxAdapter(settings?.faxProvider).send({ to: faxTo, recipientName: String(fd.get("faxName") ?? "") || null, pages: 1, title: name });
    await prisma.fax.create({
      data: { practiceId: user.practiceId, direction: "OUTBOUND", status: r.status, faxNumber: faxTo, recipientName: String(fd.get("faxName") ?? "") || null, pages: 1, contentType: `Letter: ${name}`, patientId, documentId: doc.id, error: r.error ?? null, providerRef: r.providerRef ?? null, userId: user.id, sentAt: new Date() },
    });
  }
  revalidatePath(`/patients/${patientId}`);
  redirect(`/gateway/documents/${doc.id}`);
}
