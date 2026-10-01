"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { openIntakeCase } from "@/lib/intake";
import { GATEWAY_ROLES, canWorkTeam } from "@/lib/gateway";
import { saveUpload } from "@/lib/storage";
import { processDocument } from "@/lib/document-reader";
import { DOC_FIELDS, DOC_TYPES, normalizeDate, normalizePhone, normalizeSex } from "@/lib/patient-docs";

class DocError extends Error {}
function fail(message: string): never {
  throw new DocError(message);
}

type User = Awaited<ReturnType<typeof requireUser>>;

async function dataEntryUser() {
  const user = await requireUser(GATEWAY_ROLES);
  if (!canWorkTeam(user.role, "DATA_ENTRY")) fail("Only the data entry team can upload and apply patient documents.");
  return user;
}

async function guarded(back: string, work: () => Promise<string | void>) {
  let target = back;
  try {
    target = (await work()) ?? back;
  } catch (err) {
    if (!(err instanceof DocError)) throw err;
    target = `${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(err.message.slice(0, 300))}`;
  }
  revalidatePath("/gateway", "layout");
  revalidatePath("/");
  redirect(target);
}

async function ownDocument(user: User, id: string) {
  const doc = await prisma.patientDocument.findFirst({ where: { id, practiceId: user.practiceId } });
  if (!doc) fail("Document not found.");
  return doc;
}

// Reading runs after the response; the review page refreshes until it's done.
function startReading(id: string) {
  void processDocument(id).catch(() => undefined);
}

export async function uploadPatientDocuments(fd: FormData) {
  const caseId = String(fd.get("caseId") ?? "") || null;
  const back = caseId ? `/gateway/${caseId}` : "/gateway/documents";
  return guarded(back, async () => {
    const user = await dataEntryUser();
    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) fail("Choose at least one document to upload.");
    if (files.length > 20) fail("Upload up to 20 documents at a time.");
    let patientId = String(fd.get("patientId") ?? "") || null;
    if (caseId) {
      const c = await prisma.intakeCase.findFirst({ where: { id: caseId, practiceId: user.practiceId } });
      if (!c) fail("Intake case not found.");
      patientId = c.patientId;
    } else if (patientId && !(await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId } }))) {
      fail("Patient not found.");
    }
    const docType = String(fd.get("docType") ?? "OTHER");
    const ids: string[] = [];
    for (const file of files) {
      let stored;
      try {
        stored = await saveUpload(file, user.practiceId);
      } catch (err) {
        fail(`${file.name}: ${err instanceof Error ? err.message : "upload failed"}`);
      }
      const doc = await prisma.patientDocument.create({
        data: {
          practiceId: user.practiceId,
          patientId,
          intakeCaseId: caseId,
          name: stored.fileName,
          originalName: stored.fileName,
          filePath: stored.filePath,
          mimeType: stored.mimeType,
          sizeBytes: file.size,
          docType: docType in DOC_TYPES ? docType : "OTHER",
          uploadedById: user.id,
        },
      });
      ids.push(doc.id);
      await logAudit(user.practiceId, user.id, "UPLOAD_PATIENT_DOCUMENT", "PatientDocument", doc.id, stored.fileName);
    }
    ids.forEach(startReading);
    return ids.length === 1 ? `/gateway/documents/${ids[0]}` : `${back}${caseId ? "" : "?uploaded=" + ids.length}`;
  });
}

export async function saveDocumentDetails(id: string, fd: FormData) {
  return guarded(`/gateway/documents/${id}`, async () => {
    const user = await dataEntryUser();
    const doc = await ownDocument(user, id);
    const name = String(fd.get("name") ?? "").trim().replace(/[\\/:*?"<>|]+/g, "-");
    if (!name) fail("Give the document a name.");
    const docType = String(fd.get("docType") ?? doc.docType);
    await prisma.patientDocument.update({
      where: { id: doc.id },
      data: { name: name.slice(0, 180), docType: docType in DOC_TYPES ? docType : doc.docType, reviewedById: user.id, reviewedAt: new Date() },
    });
    return `/gateway/documents/${id}?saved=1`;
  });
}

export async function rereadDocument(id: string) {
  return guarded(`/gateway/documents/${id}`, async () => {
    const user = await dataEntryUser();
    const doc = await ownDocument(user, id);
    await prisma.patientDocument.update({ where: { id: doc.id }, data: { status: "PROCESSING", error: null } });
    startReading(doc.id);
  });
}

export async function deletePatientDocument(id: string) {
  return guarded(`/gateway/documents/${id}`, async () => {
    const user = await dataEntryUser();
    const doc = await ownDocument(user, id);
    if (doc.status === "APPLIED" && user.role !== "ADMIN") fail("This document has been applied to a patient — only an administrator can remove it.");
    await prisma.patientDocument.delete({ where: { id: doc.id } });
    const root = path.resolve(process.cwd(), "uploads");
    const full = path.resolve(root, doc.filePath);
    if (full.startsWith(root + path.sep)) await unlink(full).catch(() => undefined);
    await logAudit(user.practiceId, user.id, "DELETE_PATIENT_DOCUMENT", "PatientDocument", doc.id, doc.name);
    return doc.intakeCaseId ? `/gateway/${doc.intakeCaseId}` : "/gateway/documents";
  });
}

// ---- Apply the reviewed details ----

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

// The reviewer ticks each value to use; unticked or blank values are left alone.
function chosenValues(fd: FormData) {
  const out: Record<string, string> = {};
  for (const f of DOC_FIELDS) {
    if (fd.get(`use_${f.key}`) !== "on") continue;
    let v = str(fd, `val_${f.key}`);
    if (!v) continue;
    if (f.kind === "date") {
      const d = normalizeDate(v);
      if (!d) fail(`${f.label}: "${v}" isn't a valid date.`);
      v = d;
    } else if (f.kind === "phone") {
      const p = normalizePhone(v);
      if (!p) fail(`${f.label}: "${v}" isn't a 10-digit phone number.`);
      v = p;
    } else if (f.kind === "sex") {
      const s = normalizeSex(v) ?? (["M", "F", "U"].includes(v.toUpperCase()) ? v.toUpperCase() : null);
      if (!s) fail(`${f.label}: use M or F.`);
      v = s;
    } else if (f.kind === "state") {
      if (!/^[A-Za-z]{2}$/.test(v)) fail(`${f.label}: use the 2-letter state code.`);
      v = v.toUpperCase();
    } else if (f.kind === "zip") {
      if (!/^\d{5}(-?\d{4})?$/.test(v)) fail(`${f.label}: ZIP must be 5 or 9 digits.`);
    }
    out[f.key] = v.slice(0, 500);
  }
  return out;
}

const PATIENT_COLUMNS = [
  "firstName",
  "lastName",
  "phone",
  "email",
  "addressLine1",
  "city",
  "state",
  "zip",
  "preferredLanguage",
  "maritalStatus",
  "emergencyContactName",
  "emergencyContactPhone",
  "emergencyContactRelationship",
  "middleName",
  "ssnLast4",
  "phone2",
  "addressLine2",
  "county",
  "occupation",
] as const;

function nextMrn() {
  return `CH-${Math.floor(100000 + Math.random() * 899999)}`;
}

export async function applyDocument(id: string, fd: FormData) {
  return guarded(`/gateway/documents/${id}`, async () => {
    const user = await dataEntryUser();
    const doc = await ownDocument(user, id);
    const v = chosenValues(fd);
    const mode = str(fd, "mode");

    const patientData: Record<string, string | Date> = {};
    for (const col of PATIENT_COLUMNS) if (v[`patient.${col}`]) patientData[col] = v[`patient.${col}`];
    if (v["patient.dob"]) patientData.dob = new Date(`${v["patient.dob"]}T00:00:00Z`);
    if (v["patient.sex"]) patientData.sex = v["patient.sex"];
    if (v["referral.onsetDate"]) patientData.onsetDate = new Date(`${v["referral.onsetDate"]}T12:00:00`);
    for (const [key, col] of [["pharmacy.name", "pharmacyName"], ["pharmacy.phone", "pharmacyPhone"], ["pharmacy.fax", "pharmacyFax"], ["pharmacy.address", "pharmacyAddress"], ["homeHealth.company", "homeHealthCompany"], ["homeHealth.nurse", "homeHealthNurse"]]) {
      if (v[key]) patientData[col] = v[key];
    }

    const payerId = str(fd, "payerId") || null;
    const secondaryPayerId = str(fd, "secondaryPayerId") || null;
    const referringPhysicianId = str(fd, "referringPhysicianId") || null;
    for (const pid of [payerId, secondaryPayerId]) {
      if (pid && !(await prisma.payer.findFirst({ where: { id: pid, practiceId: user.practiceId } }))) fail("Pick a payer from the directory.");
    }
    if (referringPhysicianId && !(await prisma.renderingProvider.findFirst({ where: { id: referringPhysicianId, practiceId: user.practiceId, isReferring: true } }))) {
      fail("Pick a referring physician from the directory.");
    }

    // ---- Patient: create new, or update the linked / chosen one ----
    let patientId: string;
    if (mode === "create") {
      if (doc.patientId) fail("This document is already linked to a patient.");
      const missing = ["firstName", "lastName", "dob", "sex"].filter((k) => !patientData[k]);
      if (missing.length) fail(`To register a new patient, tick and fill: ${missing.join(", ").replace("dob", "date of birth")}.`);
      const dupe = await prisma.patient.findFirst({
        where: {
          practiceId: user.practiceId,
          dob: patientData.dob as Date,
          lastName: { equals: patientData.lastName as string },
          firstName: { equals: patientData.firstName as string },
        },
      });
      if (dupe && str(fd, "confirmNew") !== "on") {
        fail(`${dupe.lastName}, ${dupe.firstName} (${dupe.mrn}) already has this name and date of birth — link to them instead, or tick "Register anyway".`);
      }
      const created = await prisma.patient.create({
        data: {
          practiceId: user.practiceId,
          mrn: nextMrn(),
          firstName: patientData.firstName as string,
          lastName: patientData.lastName as string,
          dob: patientData.dob as Date,
          sex: patientData.sex as string,
          ...Object.fromEntries(Object.entries(patientData).filter(([k]) => !["firstName", "lastName", "dob", "sex"].includes(k))),
          referringPhysicianId,
        },
      });
      patientId = created.id;
      await logAudit(user.practiceId, user.id, "CREATE_PATIENT", "Patient", created.id, `from document ${doc.name}`);
    } else {
      patientId = doc.patientId ?? str(fd, "patientId");
      const patient = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId } });
      if (!patient) fail("Choose the patient to update, or register a new one.");
      await prisma.patient.update({
        where: { id: patient.id },
        data: { ...patientData, ...(referringPhysicianId ? { referringPhysicianId } : {}) },
      });
      await logAudit(user.practiceId, user.id, "UPDATE_PATIENT", "Patient", patient.id, `from document ${doc.name}: ${Object.keys(patientData).join(", ") || "no demographics"}`);
    }

    // ---- Insurance ----
    const upsertCoverage = async (pid: string, rank: "PRIMARY" | "SECONDARY", prefix: "insurance" | "secondary") => {
      const memberId = v[`${prefix}.memberId`];
      const groupNumber = v[`${prefix}.groupNumber`];
      const planName = prefix === "insurance" ? v["insurance.planName"] : undefined;
      const existing = await prisma.insurance.findFirst({ where: { patientId, payerId: pid } });
      if (existing) {
        await prisma.insurance.update({
          where: { id: existing.id },
          data: { ...(memberId ? { memberId } : {}), ...(groupNumber ? { groupNumber } : {}), ...(planName ? { planName } : {}), rank, isPrimary: rank === "PRIMARY", active: true },
        });
      } else {
        if (rank === "PRIMARY") {
          // The document's plan becomes primary; an older primary moves to secondary for verification to confirm.
          await prisma.insurance.updateMany({ where: { patientId, rank: "PRIMARY", active: true }, data: { rank: "SECONDARY", isPrimary: false } });
        }
        await prisma.insurance.create({
          data: { patientId, payerId: pid, memberId: memberId ?? "PENDING", groupNumber: groupNumber ?? null, planName: planName ?? null, rank, isPrimary: rank === "PRIMARY" },
        });
      }
    };
    if (payerId) await upsertCoverage(payerId, "PRIMARY", "insurance");
    if (secondaryPayerId && secondaryPayerId !== payerId) await upsertCoverage(secondaryPayerId, "SECONDARY", "secondary");

    // ---- Intake case: referral and PCP ----
    const intake = await openIntakeCase(user, patientId);
    const current = await prisma.intakeCase.findUniqueOrThrow({ where: { id: intake.id } });
    const append = (old: string | null, add: string | undefined) => (add ? [old, add].filter(Boolean).join("\n").slice(0, 4000) : undefined);
    const physicianNote =
      !referringPhysicianId && (v["referral.physicianName"] || v["referral.physicianNpi"])
        ? `Referring physician: ${[v["referral.physicianName"], v["referral.physicianNpi"] ? `NPI ${v["referral.physicianNpi"]}` : ""].filter(Boolean).join(", ")}`
        : undefined;
    const notes = [v["referral.diagnoses"] ? `Diagnoses: ${v["referral.diagnoses"]}` : "", physicianNote ?? ""].filter(Boolean).join("\n");
    await prisma.intakeCase.update({
      where: { id: intake.id },
      data: {
        ...(v["referral.referralDate"] ? { referralDate: new Date(`${v["referral.referralDate"]}T00:00:00Z`) } : {}),
        ...(v["referral.sourceName"] ? { referralSourceName: v["referral.sourceName"] } : {}),
        ...(!current.referralSourceType && (v["referral.physicianName"] || referringPhysicianId || v["referral.sourceName"])
          ? { referralSourceType: v["referral.physicianName"] || referringPhysicianId ? "PHYSICIAN" : "OTHER" }
          : {}),
        ...(!current.referralSourceName && !v["referral.sourceName"] && v["referral.physicianName"] ? { referralSourceName: v["referral.physicianName"] } : {}),
        ...(v["referral.contactName"] ? { referralContactName: v["referral.contactName"] } : {}),
        ...(v["referral.contactPhone"] ? { referralContactPhone: v["referral.contactPhone"] } : {}),
        ...(v["referral.contactFax"] ? { referralContactFax: v["referral.contactFax"] } : {}),
        ...(v["referral.servicesRequested"] ? { servicesRequested: v["referral.servicesRequested"] } : {}),
        ...(notes ? { referralNotes: append(current.referralNotes, notes) } : {}),
        ...(v["pcp.name"] ? { pcpName: v["pcp.name"] } : {}),
        ...(v["pcp.phone"] ? { pcpPhone: v["pcp.phone"] } : {}),
        ...(v["pcp.fax"] ? { pcpFax: v["pcp.fax"] } : {}),
        ...(payerId ? { payerId, ...(v["insurance.memberId"] ? { memberId: v["insurance.memberId"] } : {}) } : {}),
      },
    });
    await prisma.intakeActivity.create({
      data: {
        caseId: intake.id,
        userId: user.id,
        stage: current.stage,
        action: "DOCUMENT_APPLIED",
        note: `${DOC_TYPES[str(fd, "docType")] ?? "Document"} "${str(fd, "name") || doc.name}" — ${Object.keys(v).length} detail(s) filled`,
      },
    });

    const name = str(fd, "name").replace(/[\\/:*?"<>|]+/g, "-") || doc.name;
    const docType = str(fd, "docType");
    await prisma.patientDocument.update({
      where: { id: doc.id },
      data: {
        patientId,
        intakeCaseId: intake.id,
        name: name.slice(0, 180),
        docType: docType in DOC_TYPES ? docType : doc.docType,
        status: "APPLIED",
        reviewedById: user.id,
        reviewedAt: new Date(),
        appliedAt: new Date(),
      },
    });
    await logAudit(user.practiceId, user.id, "APPLY_PATIENT_DOCUMENT", "PatientDocument", doc.id, `${Object.keys(v).length} fields`);
    revalidatePath(`/patients/${patientId}`);
    return `/gateway/${intake.id}?docApplied=1`;
  });
}

// Attach to an existing patient without filling anything (e.g. a consent form).
export async function linkDocument(id: string, fd: FormData) {
  return guarded(`/gateway/documents/${id}`, async () => {
    const user = await dataEntryUser();
    const doc = await ownDocument(user, id);
    const patient = await prisma.patient.findFirst({ where: { id: str(fd, "patientId"), practiceId: user.practiceId } });
    if (!patient) fail("Choose a patient.");
    const intake = await openIntakeCase(user, patient.id);
    await prisma.patientDocument.update({
      where: { id: doc.id },
      data: { patientId: patient.id, intakeCaseId: intake.id, reviewedById: user.id, reviewedAt: new Date() },
    });
    return `/gateway/documents/${id}?linked=1`;
  });
}
