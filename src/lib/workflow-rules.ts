import "server-only";
import { prisma } from "@/lib/prisma";
import { networkStatusForPayer } from "@/lib/credentialing";

// Workflow rules: the practice decides which team steps are hard dependencies (Practice setup → Workflow rules).
// Each check returns the reason the step can't go ahead, or null.

export async function workflowRules(practiceId: string) {
  const s = await prisma.practiceSettings.findUnique({
    where: { practiceId },
    select: { bookingRequiresGateway: true, bookingChecksCredentialing: true, chartRequiresCheckIn: true, enforceVobScope: true },
  });
  return { bookingRequiresGateway: false, bookingChecksCredentialing: false, chartRequiresCheckIn: false, enforceVobScope: false, ...s };
}

// Stages where the Gateway has not cleared the patient for booking.
const NOT_READY_STAGES = ["DATA_ENTRY", "VERIFICATION", "AUTH_PENDING", "PCC_REFERRAL"];

// Booking: the Gateway case must have reached scheduling and the VOB must not have denied the patient. A patient
// with no case (walk-in, established patient) is not held.
export async function bookingBlockedByGateway(practiceId: string, patientId: string): Promise<string | null> {
  const c = await prisma.intakeCase.findFirst({ where: { practiceId, patientId }, orderBy: { createdAt: "desc" }, select: { stage: true, vobDecision: true } });
  if (!c) return null;
  if (c.vobDecision === "DENIED") return "The VOB team denied this patient — the case has to be reopened before a visit is booked.";
  if (NOT_READY_STAGES.includes(c.stage)) return `The Gateway case is still with ${c.stage === "DATA_ENTRY" ? "data entry" : c.stage === "VERIFICATION" ? "the VOB team" : c.stage === "AUTH_PENDING" ? "authorization" : "the PCC referral"} — it has to reach scheduling before a visit is booked.`;
  return null;
}

// Booking: the provider (a User) must be credentialed with the patient's primary payer.
export async function bookingBlockedByCredentialing(practiceId: string, patientId: string, providerUserId: string): Promise<string | null> {
  const [coverage, rendering] = await Promise.all([
    prisma.insurance.findFirst({ where: { patientId, active: true, rank: "PRIMARY" }, select: { payerId: true, payer: { select: { name: true } } } }),
    prisma.renderingProvider.findFirst({ where: { practiceId, userId: providerUserId }, select: { id: true, name: true } }),
  ]);
  if (!coverage || !rendering) return null;
  const rows = await networkStatusForPayer(practiceId, coverage.payerId);
  const row = rows.find((r) => r.providerId === rendering.id);
  if (row?.network === "IN_NETWORK") return null;
  return `${rendering.name} is ${row?.network === "PENDING" ? "still being credentialed" : "not credentialed"} with ${coverage.payer.name} — book with an in-network provider, or turn the rule off in Practice setup.`;
}

// Codes a limited VOB covers: E&M office visits and debridement.
const VOB_LIMITED_OK = /^(99[2-4]\d\d|99341|99342|99344|99345|99347|99348|99349|99350|G0438|G0439|11042|11043|11044|11045|11046|11047|97597|97598|11000|11001)$/;
export const vobScopeAllows = (cpt: string) => VOB_LIMITED_OK.test(cpt.toUpperCase());
