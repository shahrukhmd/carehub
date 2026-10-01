import "server-only";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { runEligibilityCheck } from "@/lib/clearinghouse/service";

// Batch insurance eligibility (270/271) for upcoming appointments.

export const ELIGIBILITY_ROLES = ["ADMIN", "FRONT_DESK", "SCHEDULER", "VERIFICATION", "BILLER", "INTAKE"];

export function nextBusinessDay(from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

export async function appointmentsForEligibility(practiceId: string, from: Date, to: Date) {
  return prisma.appointment.findMany({
    where: { practiceId, startsAt: { gte: from, lt: to }, status: { in: ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "REQUESTED"] } },
    include: {
      patient: { include: { insurances: { where: { active: true, isPrimary: true }, include: { payer: true } } } },
      provider: true,
      eligibilityChecks: { orderBy: { checkedAt: "desc" }, take: 1 },
    },
    orderBy: { startsAt: "asc" },
  });
}

// Checks every appointment in the range that has insurance and no check in the last `freshDays`.
export async function runBatchEligibility(practiceId: string, from: Date, to: Date, userId: string | null, freshDays = 7) {
  const appts = await appointmentsForEligibility(practiceId, from, to);
  const cutoff = Date.now() - freshDays * 86_400_000;
  let checked = 0;
  let noInsurance = 0;
  let skipped = 0;
  const problems: string[] = [];
  for (const a of appts) {
    if (!a.patient.insurances.length) {
      noInsurance++;
      continue;
    }
    const last = a.eligibilityChecks[0];
    if (last && last.checkedAt.getTime() > cutoff && last.status === "ACTIVE") {
      skipped++;
      continue;
    }
    const r = await runEligibilityCheck({ practiceId, patientId: a.patientId, appointmentId: a.id });
    checked++;
    if (r && r.status !== "ACTIVE") problems.push(`${a.patient.lastName}, ${a.patient.firstName}: ${r.status.toLowerCase()}${r.payerMessage ? ` — ${r.payerMessage}` : ""}`);
  }
  await logAudit(practiceId, userId, userId ? "BATCH_ELIGIBILITY" : "AUTO_ELIGIBILITY", "Appointment", from.toISOString().slice(0, 10), `${checked} checked, ${skipped} already current, ${noInsurance} self-pay, ${problems.length} problems`);
  return { checked, skipped, noInsurance, problems };
}

// Nightly: after 6 pm, check the next business day once per practice that turned it on.
export async function runNightlyEligibility() {
  const now = new Date();
  if (now.getHours() < 18) return 0;
  const practices = await prisma.practiceSettings.findMany({ where: { eligibilityAuto: true }, select: { practiceId: true } });
  let n = 0;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const { practiceId } of practices) {
    const done = await prisma.auditLog.findFirst({ where: { practiceId, action: "AUTO_ELIGIBILITY", createdAt: { gte: today } } });
    if (done) continue;
    const day = nextBusinessDay(now);
    const r = await runBatchEligibility(practiceId, day, new Date(day.getTime() + 86_400_000), null);
    n += r.checked;
  }
  return n;
}
