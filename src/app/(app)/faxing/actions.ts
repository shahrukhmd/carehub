"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { completeSourceTasks, createTask } from "@/lib/tasks";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { saveUpload } from "@/lib/storage";
import { processDocument } from "@/lib/document-reader";
import { openIntakeCase } from "@/lib/intake";
import { FAX_RECIPIENTS, FAX_ROLES, faxNumberOrNull, getFaxAdapter } from "@/lib/fax";

class FaxError extends Error {}
function fail(message: string): never {
  throw new FaxError(message);
}

async function guarded(back: string, work: (user: Awaited<ReturnType<typeof requireUser>>) => Promise<string | void>) {
  const user = await requireUser(FAX_ROLES);
  let target = back;
  try {
    target = (await work(user)) ?? back;
  } catch (err) {
    if (!(err instanceof FaxError)) throw err;
    target = `${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(err.message.slice(0, 300))}`;
  }
  revalidatePath("/faxing", "layout");
  revalidatePath("/gateway", "layout");
  redirect(target);
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

// ---- Inbound ----

// Files received on the fax line (or scanned faxes brought in by hand) land here and in Patient documents,
// where they're read automatically.
export async function receiveFax(fd: FormData) {
  return guarded("/faxing?tab=inbound", async (user) => {
    const from = faxNumberOrNull(str(fd, "from"));
    if (!from) fail("Enter the sending fax number (10 digits).");
    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) fail("Choose the fax file (PDF or image).");
    for (const file of files) {
      let stored;
      try {
        stored = await saveUpload(file, user.practiceId);
      } catch (err) {
        fail(err instanceof Error ? err.message : "Upload failed.");
      }
      const received = new Date();
      const day = `${received.getFullYear()}-${String(received.getMonth() + 1).padStart(2, "0")}-${String(received.getDate()).padStart(2, "0")}`;
      const name = `Fax from ${from} ${day}${stored.fileName.match(/\.[a-z0-9]+$/i)?.[0] ?? ""}`;
      const doc = await prisma.patientDocument.create({
        data: {
          practiceId: user.practiceId,
          name,
          originalName: stored.fileName,
          filePath: stored.filePath,
          mimeType: stored.mimeType,
          sizeBytes: file.size,
          uploadedById: user.id,
        },
      });
      const fax = await prisma.fax.create({
        data: { practiceId: user.practiceId, direction: "INBOUND", status: "RECEIVED", faxNumber: from, documentId: doc.id, userId: user.id, notes: str(fd, "notes") || null },
      });
      void processDocument(doc.id)
        .then(async () => {
          const read = await prisma.patientDocument.findUnique({ where: { id: doc.id }, select: { pageCount: true } });
          if (read?.pageCount) await prisma.fax.update({ where: { id: fax.id }, data: { pages: read.pageCount } });
        })
        .catch(() => undefined);
      await createTask({
        practiceId: user.practiceId,
        type: "DOCUMENT",
        title: `Inbound fax from ${from} to file`,
        body: str(fd, "notes") || null,
        assignedRole: "INTAKE",
        createdById: user.id,
        link: "/faxing?tab=inbound",
        sourceType: "FAX",
        sourceId: fax.id,
      });
      await logAudit(user.practiceId, user.id, "RECEIVE_FAX", "Fax", fax.id, from);
    }
  });
}

export async function saveFaxNote(id: string, fd: FormData) {
  return guarded("/faxing?tab=inbound", async (user) => {
    await prisma.fax.updateMany({ where: { id, practiceId: user.practiceId }, data: { notes: str(fd, "notes").slice(0, 500) || null } });
  });
}

// "Save to patient record": files the fax to the patient's documents (and open Gateway case).
export async function fileFaxToPatient(id: string, fd: FormData) {
  return guarded("/faxing?tab=inbound", async (user) => {
    const fax = await prisma.fax.findFirst({ where: { id, practiceId: user.practiceId, direction: "INBOUND" } });
    if (!fax) fail("Fax not found.");
    const patient = await prisma.patient.findFirst({ where: { id: str(fd, "patientId"), practiceId: user.practiceId } });
    if (!patient) fail("Find the patient to save this fax to.");
    let intakeCaseId: string | null = null;
    try {
      intakeCaseId = (await openIntakeCase(user, patient.id)).id;
    } catch {
      intakeCaseId = null;
    }
    if (fax.documentId) {
      await prisma.patientDocument.update({ where: { id: fax.documentId }, data: { patientId: patient.id, intakeCaseId, reviewedById: user.id, reviewedAt: new Date() } });
    }
    await prisma.fax.update({ where: { id: fax.id }, data: { status: "FILED", patientId: patient.id } });
    await completeSourceTasks(user.practiceId, "FAX", fax.id, user.id);
    await logAudit(user.practiceId, user.id, "FILE_FAX", "Fax", fax.id, `to ${patient.mrn}`);
  });
}

export async function deleteInboundFax(id: string) {
  return guarded("/faxing?tab=inbound", async (user) => {
    const fax = await prisma.fax.findFirst({ where: { id, practiceId: user.practiceId, direction: "INBOUND" } });
    if (!fax) fail("Fax not found.");
    if (fax.status === "FILED" && user.role !== "ADMIN") fail("This fax is saved to a patient's record — only an administrator can delete it.");
    if (fax.documentId) {
      const doc = await prisma.patientDocument.findUnique({ where: { id: fax.documentId } });
      if (doc) {
        await prisma.patientDocument.delete({ where: { id: doc.id } });
        const root = path.resolve(process.cwd(), "uploads");
        const full = path.resolve(root, doc.filePath);
        if (full.startsWith(root + path.sep)) await unlink(full).catch(() => undefined);
      }
    }
    await prisma.fax.delete({ where: { id: fax.id } });
    await logAudit(user.practiceId, user.id, "DELETE_FAX", "Fax", fax.id, fax.faxNumber);
  });
}

// ---- Outbound ----

// Sends the chosen documentation view for each selected visit to its recipient.
export async function sendFaxes(fd: FormData) {
  const back = String(fd.get("back") ?? "/faxing?tab=outbound");
  const safeBack = back.startsWith("/faxing") ? back : "/faxing?tab=outbound";
  return guarded(safeBack, async (user) => {
    const ids = fd.getAll("encounterIds").map(String);
    if (ids.length === 0) fail("Tick the visits to fax.");
    if (ids.length > 100) fail("Send up to 100 faxes at a time.");
    const recipientType = str(fd, "recipient");
    if (!(recipientType in FAX_RECIPIENTS)) fail("Pick who the fax goes to.");
    const view = await prisma.documentationView.findFirst({ where: { id: str(fd, "viewId"), practiceId: user.practiceId } });
    if (!view) fail("Pick what to send (a documentation view).");
    const other = recipientType === "OTHER" ? faxNumberOrNull(str(fd, "otherNumber")) : null;
    if (recipientType === "OTHER" && !other) fail("Enter the fax number to send to.");
    const settings = await prisma.practiceSettings.findUnique({ where: { practiceId: user.practiceId } });
    const adapter = getFaxAdapter(settings?.faxProvider);

    const encounters = await prisma.encounter.findMany({
      where: { id: { in: ids }, practiceId: user.practiceId },
      include: {
        patient: { include: { referringPhysician: true, intakeCases: { orderBy: { createdAt: "desc" }, take: 1 } } },
        documents: { select: { id: true } },
        appointment: true,
      },
    });
    let sent = 0;
    let failed = 0;
    for (const e of encounters) {
      const c = e.patient.intakeCases[0];
      const target =
        recipientType === "REFERRING"
          ? { number: faxNumberOrNull(e.patient.referringPhysician?.fax), name: e.patient.referringPhysician?.name ?? null }
          : recipientType === "PCP"
            ? { number: faxNumberOrNull(c?.pcpFax), name: c?.pcpName ?? null }
            : recipientType === "REFERRAL_SOURCE"
              ? { number: faxNumberOrNull(c?.referralContactFax), name: c?.referralSourceName ?? c?.referralContactName ?? null }
              : { number: other, name: str(fd, "otherName") || null };
      const pages = 1 + Math.ceil(e.documents.length / 2);
      if (!target.number) {
        await prisma.fax.create({
          data: {
            practiceId: user.practiceId,
            direction: "OUTBOUND",
            status: "NOT_SENT",
            faxNumber: "—",
            recipientName: target.name,
            contentType: view.name,
            viewId: view.id,
            encounterId: e.id,
            appointmentId: e.appointmentId,
            patientId: e.patientId,
            error: `No ${FAX_RECIPIENTS[recipientType].toLowerCase()} fax number on file`,
            userId: user.id,
          },
        });
        failed++;
        continue;
      }
      const result = await adapter.send({ to: target.number, recipientName: target.name, pages, title: view.name });
      await prisma.fax.create({
        data: {
          practiceId: user.practiceId,
          direction: "OUTBOUND",
          status: result.status,
          faxNumber: target.number,
          recipientName: target.name,
          pages: result.pages,
          contentType: view.name,
          viewId: view.id,
          encounterId: e.id,
          appointmentId: e.appointmentId,
          patientId: e.patientId,
          providerRef: result.providerRef ?? null,
          error: result.error ?? null,
          userId: user.id,
          sentAt: new Date(),
        },
      });
      if (result.status === "SUCCESS") sent++;
      else failed++;
    }
    await logAudit(user.practiceId, user.id, "SEND_FAX", "Fax", view.id, `${view.name}: ${sent} sent, ${failed} not sent`);
    return `${safeBack}${safeBack.includes("?") ? "&" : "?"}sent=${sent}&failed=${failed}`;
  });
}

export async function resendFax(id: string) {
  return guarded("/faxing?tab=history", async (user) => {
    const fax = await prisma.fax.findFirst({ where: { id, practiceId: user.practiceId, direction: "OUTBOUND" } });
    if (!fax) fail("Fax not found.");
    if (!faxNumberOrNull(fax.faxNumber)) fail("There's no fax number to resend to — send it again from Outbound with a recipient that has one.");
    const settings = await prisma.practiceSettings.findUnique({ where: { practiceId: user.practiceId } });
    const result = await getFaxAdapter(settings?.faxProvider).send({ to: fax.faxNumber, recipientName: fax.recipientName, pages: fax.pages ?? 1, title: fax.contentType ?? "Document" });
    await prisma.fax.create({
      data: {
        practiceId: user.practiceId,
        direction: "OUTBOUND",
        status: result.status,
        faxNumber: fax.faxNumber,
        recipientName: fax.recipientName,
        pages: result.pages,
        contentType: fax.contentType,
        viewId: fax.viewId,
        encounterId: fax.encounterId,
        appointmentId: fax.appointmentId,
        patientId: fax.patientId,
        providerRef: result.providerRef ?? null,
        error: result.error ?? null,
        notes: `Resend of an earlier fax`,
        userId: user.id,
        sentAt: new Date(),
      },
    });
  });
}
