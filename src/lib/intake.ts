import "server-only";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { OPEN_INTAKE_STAGES } from "@/lib/gateway";

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
