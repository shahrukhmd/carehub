"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { saveGenerated } from "@/lib/storage";
import { parseCcd, type CcdImport } from "@/lib/ccda";

const ROLES = ["ADMIN", "CLINICIAN", "FRONT_DESK", "INTAKE", "CDS"];

export async function uploadCcda(patientId: string, fd: FormData) {
  const user = await requireUser(ROLES);
  const patient = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId } });
  if (!patient) redirect("/patients");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) redirect(`/patients/${patientId}?ccdaError=${encodeURIComponent("Choose a C-CDA XML file.")}#records`);
  if (file.size > 10_000_000) redirect(`/patients/${patientId}?ccdaError=${encodeURIComponent("The file is larger than 10 MB.")}#records`);
  const xml = await file.text();
  let parsed: CcdImport;
  try {
    parsed = parseCcd(xml);
  } catch (err) {
    redirect(`/patients/${patientId}?ccdaError=${encodeURIComponent((err as Error).message)}#records`);
  }
  const stored = await saveGenerated(user.practiceId, Buffer.from(xml, "utf8"), ".xml");
  const doc = await prisma.patientDocument.create({
    data: {
      practiceId: user.practiceId,
      patientId,
      name: `${new Date().toISOString().slice(0, 10)} C-CDA - ${file.name}`.slice(0, 180),
      originalName: file.name.slice(0, 200),
      filePath: stored.filePath,
      mimeType: "application/xml",
      sizeBytes: stored.sizeBytes,
      docType: "CCDA",
      status: "READ",
      readMethod: "TEXT",
      extraction: JSON.stringify(parsed!),
      uploadedById: user.id,
    },
  });
  await logAudit(user.practiceId, user.id, "IMPORT_CCDA", "PatientDocument", doc.id, file.name);
  redirect(`/patients/${patientId}/ccda/${doc.id}`);
}

export async function applyCcda(patientId: string, docId: string, fd: FormData) {
  const user = await requireUser(ROLES);
  const doc = await prisma.patientDocument.findFirst({ where: { id: docId, patientId, practiceId: user.practiceId, docType: "CCDA" } });
  if (!doc?.extraction) redirect(`/patients/${patientId}`);
  const data = JSON.parse(doc!.extraction!) as CcdImport;
  const picked = new Set(fd.getAll("pick").map(String));
  let n = 0;
  for (const [i, x] of data.problems.entries())
    if (picked.has(`p${i}`) && x.code) {
      await prisma.problem.create({ data: { patientId, icd10: x.code.slice(0, 10), description: x.description.slice(0, 200) || x.code } });
      n++;
    }
  for (const [i, x] of data.medications.entries())
    if (picked.has(`m${i}`)) {
      await prisma.medication.create({ data: { patientId, name: x.name.slice(0, 200), sig: x.sig.slice(0, 300) || "See outside record", status: "ACTIVE" } });
      n++;
    }
  for (const [i, x] of data.allergies.entries())
    if (picked.has(`a${i}`)) {
      await prisma.allergy.create({ data: { patientId, allergen: x.allergen.slice(0, 120), reaction: x.reaction.slice(0, 200) || "Unknown", severity: "Unknown" } });
      n++;
    }
  for (const [i, x] of data.immunizations.entries())
    if (picked.has(`i${i}`) && x.date) {
      await prisma.immunization.create({ data: { practiceId: user.practiceId, patientId, vaccine: x.vaccine.slice(0, 120) || "Vaccine", cvxCode: x.cvx, administeredAt: new Date(`${x.date}T12:00:00`), source: "HISTORICAL", notes: `From C-CDA ${doc!.originalName}` } });
      n++;
    }
  await prisma.patientDocument.update({ where: { id: docId }, data: { status: "APPLIED", reviewedById: user.id, reviewedAt: new Date() } });
  await logAudit(user.practiceId, user.id, "APPLY_CCDA", "Patient", patientId, `${n} items imported`);
  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}?ccdaApplied=${n}#records`);
}
