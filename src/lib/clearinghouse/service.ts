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
  // Gateway case the check belongs to (data entry runs it before hand-off).
  intakeCaseId?: string | null;
}) {
  const insurance = await prisma.insurance.findFirst({
    where: params.insuranceId ? { id: params.insuranceId, patientId: params.patientId } : { patientId: params.patientId, isPrimary: true },
    orderBy: { active: "desc" },
    include: { payer: true, patient: { select: { firstName: true, lastName: true, dob: true, sex: true } } },
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
    payerCode: insurance.payer.eligibilityPayerId || insurance.payer.payerCode,
    memberId: insurance.memberId,
    providerNpi,
    serviceDate: new Date(),
    // The policy holder when the patient isn't the subscriber.
    subscriber:
      insurance.relationshipToInsured !== "18" && insurance.insuredFirstName && insurance.insuredLastName
        ? { firstName: insurance.insuredFirstName, lastName: insurance.insuredLastName, dob: insurance.insuredDob, sex: insurance.insuredSex }
        : insurance.patient,
    groupNumber: insurance.groupNumber,
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
      intakeCaseId: params.intakeCaseId ?? null,
      benefits: result.benefits ? JSON.stringify(result.benefits) : null,
      raw: result.raw ?? null,
    },
  });
  // The visit's expected copay follows the latest eligibility response.
  if (params.appointmentId && result.copayCents !== undefined && result.copayCents !== null) {
    await prisma.appointment.updateMany({ where: { id: params.appointmentId }, data: { copayDueCents: result.copayCents } });
  }
  return check;
}
