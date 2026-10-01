"use server";

import path from "node:path";
import { unlink } from "node:fs/promises";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { ScanError, saveScanFiles, uploadedFiles } from "@/lib/scans";
import { GATEWAY_ROLES } from "@/lib/gateway";
import { SCAN_GROUPS } from "@/lib/patient-docs";

const SCAN_ROLES = [...GATEWAY_ROLES, "BILLER"];
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function back(patientId: string, msg?: { error?: string; ok?: string }): never {
  revalidatePath(`/patients/${patientId}`);
  revalidatePath(`/patients/${patientId}/scans`);
  const q = msg?.error ? `?error=${encodeURIComponent(msg.error.slice(0, 300))}` : msg?.ok ? `?ok=${encodeURIComponent(msg.ok)}` : "";
  redirect(`/patients/${patientId}/scans${q}`);
}

async function scanUser(patientId: string) {
  const user = await requireUser(SCAN_ROLES);
  const patient = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId }, select: { id: true } });
  if (!patient) redirect("/patients");
  return user;
}

async function visitId(fd: FormData, patientId: string) {
  const id = str(fd, "encounterId");
  if (!id) return null;
  return (await prisma.encounter.findFirst({ where: { id, patientId }, select: { id: true } }))?.id ?? null;
}

export async function addScans(patientId: string, fd: FormData) {
  const user = await scanUser(patientId);
  const files = uploadedFiles(fd, "files");
  if (files.length === 0) back(patientId, { error: "The upload scan file field is required." });
  let added = 0;
  try {
    added = await saveScanFiles({ user, patientId, files, group: str(fd, "group"), encounterId: await visitId(fd, patientId), title: str(fd, "title").slice(0, 160) });
  } catch (err) {
    if (!(err instanceof ScanError)) throw err;
    back(patientId, { error: err.message });
  }
  back(patientId, { ok: `${added} scan${added === 1 ? "" : "s"} added.` });
}

export async function updateScan(patientId: string, scanId: string, fd: FormData) {
  const user = await scanUser(patientId);
  const doc = await prisma.patientDocument.findFirst({ where: { id: scanId, patientId, practiceId: user.practiceId } });
  if (!doc) back(patientId, { error: "Scan not found." });
  const name = str(fd, "name").slice(0, 160);
  if (!name) back(patientId, { error: "The scan needs a title." });
  const group = str(fd, "group") in SCAN_GROUPS ? str(fd, "group") : doc.docType;
  await prisma.patientDocument.update({ where: { id: doc.id }, data: { name, docType: group, encounterId: await visitId(fd, patientId) } });
  await logAudit(user.practiceId, user.id, "UPDATE_SCAN", "PatientDocument", doc.id, name);
  back(patientId, { ok: "Scan updated." });
}

export async function deleteScan(patientId: string, scanId: string) {
  const user = await scanUser(patientId);
  const doc = await prisma.patientDocument.findFirst({ where: { id: scanId, patientId, practiceId: user.practiceId } });
  if (!doc) back(patientId, { error: "Scan not found." });
  if (user.role !== "ADMIN" && doc.uploadedById !== user.id) back(patientId, { error: "Only an administrator or the person who added a scan can delete it." });
  await prisma.patientDocument.delete({ where: { id: doc.id } });
  const root = path.resolve(process.cwd(), "uploads");
  const full = path.resolve(root, doc.filePath);
  if (full.startsWith(root + path.sep)) await unlink(full).catch(() => undefined);
  await logAudit(user.practiceId, user.id, "DELETE_SCAN", "PatientDocument", doc.id, doc.name);
  back(patientId, { ok: "Scan deleted." });
}
