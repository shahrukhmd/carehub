import "server-only";
import { prisma } from "@/lib/prisma";
import { getClearinghouseAdapter } from "@/lib/clearinghouse";

export async function runEligibilityCheck(params: {
  practiceId: string;
  patientId: string;
  appointmentId?: string | null;
  // A specific coverage (defaults to the active primary) and who asked for the check.
  insuranceId?: string | null;
  checkedById?: string | null;
}) {
  const insurance = await prisma.insurance.findFirst({
    where: params.insuranceId ? { id: params.insuranceId, patientId: params.patientId } : { patientId: params.patientId, isPrimary: true },
    orderBy: { active: "desc" },
    include: { payer: true },
  });
  if (!insurance) return null;

  let providerNpi: string | null = null;
  if (params.appointmentId) {
    const appt = await prisma.appointment.findUnique({
      where: { id: params.appointmentId },
      include: { provider: true },
    });
    providerNpi = appt?.provider.npi ?? null;
  }

  const adapter = getClearinghouseAdapter();
  const result = await adapter.checkEligibility({
    patientId: params.patientId,
    payerId: insurance.payerId,
    payerCode: insurance.payer.payerCode,
    memberId: insurance.memberId,
    providerNpi,
    serviceDate: new Date(),
  });

  const check = await prisma.eligibilityCheck.create({
    data: {
      practiceId: params.practiceId,
      patientId: params.patientId,
      appointmentId: params.appointmentId ?? null,
      payerId: insurance.payerId,
      status: result.status,
      planName: result.planName ?? null,
      copayCents: result.copayCents ?? null,
      coinsurancePercent: result.coinsurancePercent ?? null,
      deductibleRemainingCents: result.deductibleRemainingCents ?? null,
      outOfPocketRemainingCents: result.outOfPocketRemainingCents ?? null,
      payerMessage: result.payerMessage ?? null,
      insuranceId: insurance.id,
      checkedById: params.checkedById ?? null,
    },
  });
  // The visit's expected copay follows the latest eligibility response.
  if (params.appointmentId && result.copayCents !== undefined && result.copayCents !== null) {
    await prisma.appointment.updateMany({ where: { id: params.appointmentId }, data: { copayDueCents: result.copayCents } });
  }
  return check;
}
