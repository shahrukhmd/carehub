"use server";

import { rolesFor } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { planSegmentLabel } from "@/lib/format";
import { STANDARD_PAYERS, planApprovalLabel, planKey } from "@/lib/payer-plans";
import { CREDENTIALING_ROLES, credentialingPracticeIds } from "@/lib/scope";

const HERE = "/credentialing?tab=board&view=plans";
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function back(msg: { error?: string; ok?: string }): never {
  revalidatePath("/credentialing", "layout");
  redirect(`${HERE}&${msg.error ? `error=${encodeURIComponent(msg.error.slice(0, 300))}` : `ok=${encodeURIComponent(msg.ok ?? "Saved.")}`}`);
}

// Credentialing's decision on a plan: approved, not approved, or back to review.
export async function decidePlan(planId: string, fd: FormData) {
  const user = await requireUser(CREDENTIALING_ROLES);
  const plan = await prisma.payerPlan.findFirst({ where: { id: planId, practiceId: { in: credentialingPracticeIds(user) } }, include: { payer: true } });
  if (!plan) back({ error: "Plan not found." });
  const status = str(fd, "status");
  if (!(status in planApprovalLabel)) back({ error: "Pick approved or not approved." });
  const segment = str(fd, "planSegment");
  await prisma.payerPlan.update({
    where: { id: plan!.id },
    data: {
      status,
      notes: str(fd, "notes").slice(0, 400) || null,
      planSegment: segment in planSegmentLabel ? segment : plan!.planSegment,
      decidedById: status === "REVIEW" ? null : user.id,
      decidedAt: status === "REVIEW" ? null : new Date(),
    },
  });
  await logAudit(plan!.practiceId, user.id, "DECIDE_PAYER_PLAN", "PayerPlan", plan!.id, `${plan!.payer.name} / ${plan!.name}: ${status}`);
  back({ ok: `${plan!.name}: ${planApprovalLabel[status].toLowerCase()}.` });
}

export async function addPlan(fd: FormData) {
  const user = await requireUser(CREDENTIALING_ROLES);
  const payer = await prisma.payer.findFirst({ where: { id: str(fd, "payerId"), practiceId: { in: credentialingPracticeIds(user) } } });
  if (!payer) back({ error: "Pick the payer." });
  const name = str(fd, "name").slice(0, 160);
  const key = planKey(name);
  if (!key) back({ error: "Enter the plan name." });
  if (await prisma.payerPlan.findUnique({ where: { payerId_nameKey: { payerId: payer!.id, nameKey: key } } })) back({ error: `“${name}” is already listed under ${payer!.name}.` });
  const status = str(fd, "status");
  const decided = status === "APPROVED" || status === "NOT_APPROVED";
  const plan = await prisma.payerPlan.create({
    data: {
      practiceId: payer!.practiceId,
      payerId: payer!.id,
      name,
      nameKey: key,
      planSegment: payer!.planSegment,
      status: decided ? status : "REVIEW",
      source: "CREDENTIALING",
      notes: str(fd, "notes").slice(0, 400) || null,
      decidedById: decided ? user.id : null,
      decidedAt: decided ? new Date() : null,
    },
  });
  await logAudit(payer!.practiceId, user.id, "ADD_PAYER_PLAN", "PayerPlan", plan.id, `${payer!.name} / ${name}`);
  back({ ok: `${name} added under ${payer!.name}.` });
}

// A plan added by mistake. One that patients carry comes back on its own, so only unused plans can go.
export async function removePlan(planId: string) {
  const user = await requireUser(CREDENTIALING_ROLES);
  const plan = await prisma.payerPlan.findFirst({ where: { id: planId, practiceId: { in: credentialingPracticeIds(user) } } });
  if (!plan) back({ error: "Plan not found." });
  if (plan!.seenCount > 0) back({ error: `${plan!.name} is on ${plan!.seenCount} patient record(s), so it stays on the list. Mark it not approved instead.` });
  await prisma.payerPlan.delete({ where: { id: plan!.id } });
  await logAudit(plan!.practiceId, user.id, "REMOVE_PAYER_PLAN", "PayerPlan", plan!.id, plan!.name);
  back({ ok: `${plan!.name} removed.` });
}

// The plan type a payer name stands for.
export async function setPayerSegment(payerId: string, fd: FormData) {
  const user = await requireUser(CREDENTIALING_ROLES);
  const payer = await prisma.payer.findFirst({ where: { id: payerId, practiceId: { in: credentialingPracticeIds(user) } } });
  if (!payer) back({ error: "Payer not found." });
  const segment = str(fd, "planSegment");
  await prisma.payer.update({ where: { id: payer!.id }, data: { planSegment: segment in planSegmentLabel ? segment : null } });
  await logAudit(payer!.practiceId, user.id, "SET_PAYER_PLAN_TYPE", "Payer", payer!.id, segment || "cleared");
  back({ ok: `${payer!.name}: plan type saved.` });
}

// Adds the practice's standard payer names (one per line of business) that are not in the payer list yet, and
// fills in the plan type on the ones that are.
export async function loadStandardPayers() {
  const user = await requireUser(rolesFor("settings.admin"));
  const existing = await prisma.payer.findMany({ where: { practiceId: user.practiceId } });
  const byName = new Map(existing.map((p) => [p.name.trim().toLowerCase(), p]));
  let added = 0;
  let typed = 0;
  for (const s of STANDARD_PAYERS) {
    const have = byName.get(s.name.toLowerCase());
    if (!have) {
      await prisma.payer.create({ data: { practiceId: user.practiceId, name: s.name, planSegment: s.segment } });
      added++;
    } else if (!have.planSegment) {
      await prisma.payer.update({ where: { id: have.id }, data: { planSegment: s.segment } });
      typed++;
    }
  }
  await logAudit(user.practiceId, user.id, "LOAD_STANDARD_PAYERS", "Payer", undefined, `${added} added, ${typed} plan types filled`);
  back({ ok: `${added} payer${added === 1 ? "" : "s"} added, plan type filled in on ${typed}. Payer IDs, addresses and filing limits still need entering under Directories.` });
}
