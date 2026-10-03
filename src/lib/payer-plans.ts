import "server-only";
import { prisma } from "@/lib/prisma";

// Plan names under a payer. A payer name already says which line of business it is ("Aetna Medicare Advantage"),
// but a payer can approve the practice for some of its plans and not others. Credentialing keeps that list here;
// the plan names the VOB team types on patients feed it, so each new plan gets a decision once and VOB then sees
// whether the patient's actual plan is one the practice is approved for.

export const planApprovalLabel: Record<string, string> = {
  REVIEW: "Not reviewed yet",
  APPROVED: "Approved",
  NOT_APPROVED: "Not approved",
};

// The practice's payer naming: one payer per line of business, with its plan type.
export const STANDARD_PAYERS: { name: string; segment: string }[] = [
  { name: "AARP Medicare Supplement (UHC)", segment: "MEDICARE_SUPPLEMENTAL" },
  { name: "Aetna Commercial", segment: "COMMERCIAL" },
  { name: "Aetna Medicare Advantage", segment: "MEDICARE_ADVANTAGE" },
  { name: "Ambetter", segment: "COMMERCIAL" },
  { name: "Bankers Fidelity", segment: "MEDICARE_SUPPLEMENTAL" },
  { name: "Blue Cross Blue Shield", segment: "COMMERCIAL" },
  { name: "Blue Cross Blue Shield Medicare Advantage", segment: "MEDICARE_ADVANTAGE" },
  { name: "Blue Cross Blue Shield FEP", segment: "FEDERAL" },
  { name: "Cigna Commercial", segment: "COMMERCIAL" },
  { name: "Cigna HealthSpring Medicare Advantage", segment: "MEDICARE_ADVANTAGE" },
  { name: "Devoted Health", segment: "MEDICARE_ADVANTAGE" },
  { name: "Humana Commercial", segment: "COMMERCIAL" },
  { name: "Humana Medicare Advantage", segment: "MEDICARE_ADVANTAGE" },
  { name: "Medicaid", segment: "MEDICAID" },
  { name: "Medicare RR", segment: "MEDICARE" },
  { name: "Medicare Part B", segment: "MEDICARE" },
  { name: "Mutual of Omaha", segment: "MEDICARE_SUPPLEMENTAL" },
  { name: "TRICARE For Life WPS", segment: "FEDERAL" },
  { name: "TRICARE East (Humana Military)", segment: "FEDERAL" },
  { name: "UnitedHealthcare Commercial", segment: "COMMERCIAL" },
  { name: "UnitedHealthcare Medicare Advantage", segment: "MEDICARE_ADVANTAGE" },
  { name: "VA Community Care Network (VACCN Optum)", segment: "FEDERAL" },
  { name: "Viva Health", segment: "COMMERCIAL" },
  { name: "Viva Medicare", segment: "MEDICARE_ADVANTAGE" },
  { name: "WellCare", segment: "MEDICARE_ADVANTAGE" },
  { name: "WellMed", segment: "MEDICARE_ADVANTAGE" },
];

// "Aetna Medicare Eagle (PPO)" and "aetna medicare eagle ppo" are the same plan.
export const planKey = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Brings the plan list up to date with what is on patients: every plan name on a coverage or a VOB decision
// becomes a plan under its payer (awaiting review if it is new), with how often and how recently it was seen.
export async function syncPlansFromCoverage(practiceId: string) {
  const [coverages, cases, existing] = await Promise.all([
    prisma.insurance.findMany({ where: { patient: { practiceId }, planName: { not: null } }, select: { payerId: true, planName: true, verifiedAt: true, effectiveDate: true } }),
    prisma.vobDecision.findMany({ where: { practiceId, payerId: { not: null }, planName: { not: null } }, select: { payerId: true, planName: true, planSegment: true, createdAt: true } }),
    prisma.payerPlan.findMany({ where: { practiceId } }),
  ]);
  const seen = new Map<string, { payerId: string; name: string; segment: string | null; count: number; last: Date | null }>();
  const note = (payerId: string | null, name: string | null, segment: string | null, at: Date | null) => {
    const key = planKey(name ?? "");
    if (!payerId || !key) return;
    const id = `${payerId}|${key}`;
    const entry = seen.get(id) ?? { payerId, name: name!.trim().slice(0, 160), segment, count: 0, last: null };
    entry.count++;
    entry.segment = entry.segment ?? segment;
    if (at && (!entry.last || at > entry.last)) entry.last = at;
    seen.set(id, entry);
  };
  for (const c of coverages) note(c.payerId, c.planName, null, c.verifiedAt ?? c.effectiveDate);
  for (const c of cases) note(c.payerId, c.planName, c.planSegment, c.createdAt);

  const have = new Map(existing.map((p) => [`${p.payerId}|${p.nameKey}`, p]));
  for (const [id, s] of seen) {
    const plan = have.get(id);
    if (!plan) {
      await prisma.payerPlan.create({
        data: { practiceId, payerId: s.payerId, name: s.name, nameKey: planKey(s.name), planSegment: s.segment, status: "REVIEW", source: "VOB", seenCount: s.count, lastSeenAt: s.last },
      });
    } else if (plan.seenCount !== s.count || (s.last?.getTime() ?? null) !== (plan.lastSeenAt?.getTime() ?? null)) {
      await prisma.payerPlan.update({ where: { id: plan.id }, data: { seenCount: s.count, lastSeenAt: s.last } });
    }
  }
  // A plan no longer on any patient keeps its decision; only its count goes to zero.
  for (const [id, plan] of have) {
    if (!seen.has(id) && plan.seenCount !== 0) await prisma.payerPlan.update({ where: { id: plan.id }, data: { seenCount: 0 } });
  }
}

export type PlanApproval = { status: "REVIEW" | "APPROVED" | "NOT_APPROVED"; name: string; notes: string | null; decidedAt: Date | null };

// Credentialing's answer for one patient's plan. Null when no plan name is on file. A plan seen for the first
// time is added for review, so the credentialing team is asked about it once.
export async function planApproval(practiceId: string, payerId: string | null | undefined, planName: string | null | undefined, planSegment?: string | null): Promise<PlanApproval | null> {
  const key = planKey(planName ?? "");
  if (!payerId || !key) return null;
  const payer = await prisma.payer.findFirst({ where: { id: payerId, practiceId }, select: { id: true } });
  if (!payer) return null;
  const plan = await prisma.payerPlan.upsert({
    where: { payerId_nameKey: { payerId, nameKey: key } },
    update: {},
    create: { practiceId, payerId, name: planName!.trim().slice(0, 160), nameKey: key, planSegment: planSegment ?? null, status: "REVIEW", source: "VOB", seenCount: 1, lastSeenAt: new Date() },
  });
  return { status: plan.status as PlanApproval["status"], name: plan.name, notes: plan.notes, decidedAt: plan.decidedAt };
}
