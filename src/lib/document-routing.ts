import "server-only";
import { prisma } from "@/lib/prisma";
import { createTask } from "@/lib/tasks";
import { DOC_TYPES } from "@/lib/patient-docs";

// Automatic routing of a document that has just been read (a fax, an upload): match it to a patient when the
// name and date of birth it carries match exactly one patient, file it to the patient's open Gateway case, and
// create a task for the team that works that kind of document. A person still reviews and applies it.

const TEAM_FOR_TYPE: Record<string, string> = {
  REFERRAL: "INTAKE",
  FACE_SHEET: "INTAKE",
  PHOTO_ID: "INTAKE",
  CONSENT: "INTAKE",
  INTAKE_PACKET: "INTAKE",
  INSURANCE_CARD: "VERIFICATION",
  H_AND_P: "CLINICIAN",
  ORDERS: "CLINICIAN",
  MEDICATION_LIST: "CLINICIAN",
  LAB_RESULTS: "CLINICIAN",
  PRESCRIPTION: "CLINICIAN",
  LETTER: "INTAKE",
};

type Extraction = { fields?: Record<string, { value?: string }> };

export async function autoRouteDocument(documentId: string) {
  const doc = await prisma.patientDocument.findUnique({ where: { id: documentId }, select: { id: true, practiceId: true, patientId: true, intakeCaseId: true, docType: true, name: true, extraction: true, status: true } });
  if (!doc || doc.status !== "READ") return null;
  let fields: Record<string, { value?: string }> = {};
  try {
    fields = (JSON.parse(doc.extraction ?? "{}") as Extraction).fields ?? {};
  } catch {
    fields = {};
  }
  const v = (k: string) => fields[k]?.value?.trim() ?? "";

  // Match: last name + date of birth, exactly one patient. Nothing is linked on a partial match.
  let patientId = doc.patientId;
  let matched = false;
  if (!patientId && v("patient.lastName") && /^\d{4}-\d{2}-\d{2}$/.test(v("patient.dob"))) {
    const dob = new Date(`${v("patient.dob")}T00:00:00Z`);
    const hits = await prisma.patient.findMany({
      where: { practiceId: doc.practiceId, lastName: { equals: v("patient.lastName") }, dob: { gte: dob, lt: new Date(dob.getTime() + 86_400_000) } },
      select: { id: true, firstName: true },
      take: 3,
    });
    const first = v("patient.firstName").toLowerCase();
    const exact = hits.length === 1 ? hits : hits.filter((h) => first && h.firstName.toLowerCase().startsWith(first));
    if (exact.length === 1) {
      patientId = exact[0].id;
      matched = true;
    }
  }
  let intakeCaseId = doc.intakeCaseId;
  if (patientId && !intakeCaseId) {
    const open = await prisma.intakeCase.findFirst({ where: { practiceId: doc.practiceId, patientId, stage: { notIn: ["CLOSED", "SCHEDULED"] } }, orderBy: { createdAt: "desc" }, select: { id: true } });
    intakeCaseId = open?.id ?? null;
  }
  if (matched || (intakeCaseId && intakeCaseId !== doc.intakeCaseId)) {
    await prisma.patientDocument.update({ where: { id: doc.id }, data: { patientId, intakeCaseId } });
  }

  // One task to the team that works this kind of document, pointing at the document review page.
  const team = TEAM_FOR_TYPE[doc.docType] ?? "INTAKE";
  const typeLabel = DOC_TYPES[doc.docType] ?? "Document";
  await createTask({
    practiceId: doc.practiceId,
    type: "DOCUMENT",
    title: `${typeLabel} to review${patientId ? "" : " — patient not matched"}: ${doc.name}`.slice(0, 200),
    body: matched ? "Matched to the patient by name and date of birth; check and apply." : patientId ? null : "No patient matched the name and date of birth on the document — pick the patient on the review page.",
    patientId: patientId ?? null,
    assignedRole: team,
    priority: doc.docType === "LAB_RESULTS" || doc.docType === "ORDERS" ? "HIGH" : "NORMAL",
    link: `/gateway/documents/${doc.id}`,
    sourceType: "DOCUMENT",
    sourceId: doc.id,
  });
  return { patientId, intakeCaseId, team, matched };
}
