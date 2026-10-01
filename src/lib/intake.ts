import "server-only";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { OPEN_INTAKE_STAGES } from "@/lib/gateway";
import { parseExtraction } from "@/lib/patient-docs";

// Returns the patient's open gateway case, opening one (pre-filled from the primary insurance) if none exists.
// Callers are responsible for checking the user may work the data entry queue.
export async function openIntakeCase(user: { id: string; practiceId: string }, patientId: string) {
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, practiceId: user.practiceId },
    include: { insurances: true, intakeCases: { where: { stage: { in: OPEN_INTAKE_STAGES } } } },
  });
  if (!patient) throw new Error("Patient not found");
  if (patient.intakeCases[0]) return patient.intakeCases[0];

  const primary = patient.insurances.find((i) => i.isPrimary) ?? patient.insurances[0];
  const created = await prisma.intakeCase.create({
    data: {
      practiceId: user.practiceId,
      patientId,
      ownerId: user.id,
      referralDate: new Date(),
      payerId: primary?.payerId ?? null,
      memberId: primary && primary.memberId !== "PENDING" ? primary.memberId : null,
    },
  });
  await prisma.intakeActivity.create({
    data: { caseId: created.id, userId: user.id, stage: created.stage, action: "OPENED", note: "Intake case opened" },
  });
  await logAudit(user.practiceId, user.id, "intake.opened", "IntakeCase", created.id);
  return created;
}

function sourceTypeFor(name: string | undefined, physician: string | undefined) {
  if (name) {
    if (/hospital|medical cent|health system|discharge/i.test(name)) return "HOSPITAL";
    if (/nursing|rehab|assisted|\balf\b|\bsnf\b|senior living|memory care/i.test(name)) return "SNF";
    if (/home health|home care|hospice|visiting nurse/i.test(name)) return "HOME_HEALTH";
    if (/health plan|case manage/i.test(name)) return "PAYER";
  }
  return physician ? "PHYSICIAN" : "OTHER";
}

// Fills the case's referral source and PCP from documents that were read at registration.
// Only blanks are filled; where documents disagree, the most confident reading wins.
export async function fillCaseFromDocuments(caseId: string, docIds: string[]) {
  if (docIds.length === 0) return 0;
  const [c, docs] = await Promise.all([
    prisma.intakeCase.findUnique({ where: { id: caseId } }),
    prisma.patientDocument.findMany({ where: { id: { in: docIds } }, select: { extraction: true } }),
  ]);
  if (!c) return 0;
  const rank = { high: 3, medium: 2, low: 1 } as Record<string, number>;
  const best = new Map<string, { value: string; score: number }>();
  for (const d of docs) {
    for (const [key, f] of Object.entries(parseExtraction(d.extraction)?.fields ?? {})) {
      if (!f?.value) continue;
      const score = rank[f.confidence] ?? 0;
      if (score > (best.get(key)?.score ?? -1)) best.set(key, { value: f.value, score });
    }
  }
  const get = (key: string) => best.get(key)?.value;
  const source = get("referral.sourceName") ?? get("referral.physicianName");
  const date = get("referral.referralDate");
  const data = {
    ...(!c.referralSourceName && source ? { referralSourceName: source } : {}),
    ...(!c.referralSourceType && source ? { referralSourceType: sourceTypeFor(get("referral.sourceName"), get("referral.physicianName")) } : {}),
    ...(date && !Number.isNaN(new Date(`${date}T12:00:00`).getTime()) ? { referralDate: new Date(`${date}T12:00:00`) } : {}),
    ...(!c.referralContactName && get("referral.contactName") ? { referralContactName: get("referral.contactName") } : {}),
    ...(!c.referralContactPhone && get("referral.contactPhone") ? { referralContactPhone: get("referral.contactPhone") } : {}),
    ...(!c.referralContactFax && get("referral.contactFax") ? { referralContactFax: get("referral.contactFax") } : {}),
    ...(!c.servicesRequested && get("referral.servicesRequested") ? { servicesRequested: get("referral.servicesRequested") } : {}),
    ...(!c.referralNotes && get("referral.diagnoses") ? { referralNotes: `Diagnoses: ${get("referral.diagnoses")}` } : {}),
    ...(!c.pcpName && get("pcp.name") ? { pcpName: get("pcp.name") } : {}),
    ...(!c.pcpPhone && get("pcp.phone") ? { pcpPhone: get("pcp.phone") } : {}),
    ...(!c.pcpFax && get("pcp.fax") ? { pcpFax: get("pcp.fax") } : {}),
  };
  const filled = Object.keys(data).length;
  if (filled) {
    await prisma.intakeCase.update({ where: { id: c.id }, data });
    await prisma.intakeActivity.create({
      data: { caseId: c.id, userId: null, stage: c.stage, action: "DOCUMENTS_READ", note: `Referral source and PCP details filled from the uploaded documents (${filled} field${filled === 1 ? "" : "s"})` },
    });
  }
  return filled;
}
