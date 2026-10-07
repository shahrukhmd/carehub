import "server-only";
import { prisma } from "@/lib/prisma";
import { canEditClinical, canEditCoding, visitStatusLabel } from "@/lib/visit-workflow";
import { selfReviewBlock } from "@/lib/separation";

// Enforces the visit workflow on every chart edit: clinical content belongs to the provider and clinical
// team until the chart goes to CDS; the superbill belongs to CDS during review; signed charts are locked.
export async function assertChartEditable(
  encounterId: string,
  user: { id: string; practiceId: string; role: string },
  area: "clinical" | "coding"
) {
  const encounter = await prisma.encounter.findFirst({
    where: { id: encounterId, practiceId: user.practiceId },
    select: { status: true },
  });
  if (!encounter) throw new Error("Encounter not found");
  const allowed = area === "clinical" ? canEditClinical(encounter.status, user) : canEditCoding(encounter.status, user);
  if (!allowed) {
    throw new Error(
      `This chart is "${visitStatusLabel[encounter.status] ?? encounter.status}" — ${area === "clinical" ? "documentation" : "coding"} can't be changed by your role at this stage.`
    );
  }
  if (area === "coding") {
    const self = await selfReviewBlock(encounterId, user.id, "coding");
    if (self) throw new Error(self);
  }
}

// A signed visit becomes "Billing completed" once its primary claim has gone out to the payer.
export async function markBilledIfComplete(encounterId: string, userId: string) {
  const encounter = await prisma.encounter.findUnique({
    where: { id: encounterId },
    include: { claims: { where: { payerRank: "PRIMARY", status: { notIn: ["DRAFT", "READY", "HOLD", "EDI_REJECTED", "VOID"] } } } },
  });
  if (!encounter || encounter.status !== "READY_FOR_BILLING" || encounter.claims.length === 0) return;
  await prisma.encounter.update({ where: { id: encounterId }, data: { status: "BILLED", statusChangedAt: new Date() } });
  await prisma.encounterEvent.create({
    data: { encounterId, userId, fromStatus: "READY_FOR_BILLING", toStatus: "BILLED", note: "Primary claim submitted" },
  });
}
