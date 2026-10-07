"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { rolesFor } from "@/lib/permissions";
import { BILL_UNDER, CROSSOVER, LOOP_RULES, PAPER_FORMS, PAY_TO, SUBMISSION_TYPES, TAX_ID_TYPES } from "@/lib/payer-rules";

const str = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);
const pick = (fd: FormData, k: string, options: Record<string, string>, dflt: string) => (str(fd, k, 40) in options ? str(fd, k, 40) : dflt);
const date = (fd: FormData, k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(str(fd, k, 10)) ? new Date(`${str(fd, k, 10)}T00:00:00`) : null);

function back(payerId: string, msg: { ok?: string; error?: string }, extra = ""): never {
  revalidatePath(`/settings/directories/insurance/${payerId}/rules`);
  redirect(`/settings/directories/insurance/${payerId}/rules?${msg.error ? `error=${encodeURIComponent(msg.error)}` : msg.ok ? `ok=${encodeURIComponent(msg.ok)}` : ""}${extra}`);
}

async function ownPayer(payerId: string) {
  const user = await requireUser(rolesFor("settings.insurance"));
  const payer = await prisma.payer.findFirst({ where: { id: payerId, practiceId: user.practiceId }, select: { id: true, name: true } });
  if (!payer) redirect("/settings/directories?section=insurance");
  return { user, payer: payer! };
}

// Create or update a dated rule set for the payer.
export async function saveRuleSet(payerId: string, ruleSetId: string | null, fd: FormData) {
  const { user, payer } = await ownPayer(payerId);
  const effectiveFrom = date(fd, "effectiveFrom");
  if (!effectiveFrom) back(payerId, { error: "Pick the date the rules take effect." });
  const effectiveTo = date(fd, "effectiveTo");
  if (effectiveTo && effectiveTo < effectiveFrom) back(payerId, { error: "The end date is before the start date." });
  const data = {
    effectiveFrom,
    effectiveTo,
    submissionType: pick(fd, "submissionType", SUBMISSION_TYPES, "ELECTRONIC"),
    paperForm: pick(fd, "paperForm", PAPER_FORMS, "CMS1500"),
    claimPayerId: str(fd, "claimPayerId", 80) || null,
    eligibilityPayerId: str(fd, "eligibilityPayerId", 80) || null,
    statusPayerId: str(fd, "statusPayerId", 80) || null,
    crossover: pick(fd, "crossover", CROSSOVER, "AUTO"),
    renderingRule: pick(fd, "renderingRule", LOOP_RULES, "ALWAYS"),
    serviceLocationRule: pick(fd, "serviceLocationRule", LOOP_RULES, "ALWAYS"),
    homeBound: fd.get("homeBound") === "on",
    hold: fd.get("hold") === "on",
    holdReason: str(fd, "holdReason", 200) || null,
    holdUntil: date(fd, "holdUntil"),
    notes: str(fd, "notes", 500) || null,
  };
  if (data.hold && !data.holdReason) back(payerId, { error: "Say why submissions are on hold." });
  const rs = ruleSetId
    ? await prisma.payerRuleSet.update({ where: { id: ruleSetId, practiceId: user.practiceId }, data })
    : await prisma.payerRuleSet.create({ data: { practiceId: user.practiceId, payerId, ...data } });
  await logAudit(user.practiceId, user.id, ruleSetId ? "UPDATE_PAYER_RULES" : "CREATE_PAYER_RULES", "Payer", payerId, `${payer.name}: ${data.submissionType}${data.hold ? " · HOLD" : ""} from ${effectiveFrom.toISOString().slice(0, 10)}`);
  back(payerId, { ok: `Rules ${ruleSetId ? "updated" : "added"} effective ${effectiveFrom.toISOString().slice(0, 10)}.` }, `&set=${rs.id}`);
}

export async function deleteRuleSet(payerId: string, ruleSetId: string) {
  const { user } = await ownPayer(payerId);
  await prisma.payerRuleSet.deleteMany({ where: { id: ruleSetId, practiceId: user.practiceId } });
  await logAudit(user.practiceId, user.id, "DELETE_PAYER_RULES", "Payer", payerId, ruleSetId);
  back(payerId, { ok: "Rule set removed." });
}

// One override row under a rule set: whom to bill under for a site and/or provider.
export async function saveOverride(payerId: string, ruleSetId: string, fd: FormData) {
  const { user } = await ownPayer(payerId);
  const rs = await prisma.payerRuleSet.findFirst({ where: { id: ruleSetId, practiceId: user.practiceId } });
  if (!rs) back(payerId, { error: "Rule set not found." });
  const locationId = str(fd, "locationId", 40) || null;
  const renderingProviderId = str(fd, "renderingProviderId", 40) || null;
  if (locationId && !(await prisma.location.findFirst({ where: { id: locationId, practiceId: user.practiceId } }))) back(payerId, { error: "Pick a site of this practice." });
  if (renderingProviderId && !(await prisma.renderingProvider.findFirst({ where: { id: renderingProviderId, practiceId: user.practiceId } }))) back(payerId, { error: "Pick a provider of this practice." });
  const payTo = pick(fd, "payTo", PAY_TO, "PRACTICE");
  const data = {
    locationId,
    renderingProviderId,
    billUnder: pick(fd, "billUnder", BILL_UNDER, "PRACTICE"),
    taxIdType: pick(fd, "taxIdType", TAX_ID_TYPES, "EIN"),
    payTo,
    payToName: payTo === "CUSTOM" ? str(fd, "payToName", 120) || null : null,
    payToLine1: payTo === "CUSTOM" ? str(fd, "payToLine1", 120) || null : null,
    payToLine2: payTo === "CUSTOM" ? str(fd, "payToLine2", 120) || null : null,
    payToCity: payTo === "CUSTOM" ? str(fd, "payToCity", 80) || null : null,
    payToState: payTo === "CUSTOM" ? str(fd, "payToState", 2).toUpperCase() || null : null,
    payToZip: payTo === "CUSTOM" ? str(fd, "payToZip", 10) || null : null,
    taxonomy: str(fd, "taxonomy", 10).toUpperCase() || null,
    legacyId: str(fd, "legacyId", 40) || null,
  };
  if (payTo === "CUSTOM" && !data.payToLine1) back(payerId, { error: "Enter the custom pay-to address." });
  // One row per scope.
  const existing = await prisma.payerBillingOverride.findFirst({ where: { ruleSetId, locationId, renderingProviderId } });
  if (existing) await prisma.payerBillingOverride.update({ where: { id: existing.id }, data });
  else await prisma.payerBillingOverride.create({ data: { ruleSetId, ...data } });
  await logAudit(user.practiceId, user.id, "SAVE_PAYER_OVERRIDE", "Payer", payerId, `${data.billUnder} / ${data.taxIdType} / ${payTo}`);
  back(payerId, { ok: "Override saved." }, `&set=${ruleSetId}`);
}

export async function deleteOverride(payerId: string, overrideId: string) {
  const { user } = await ownPayer(payerId);
  const o = await prisma.payerBillingOverride.findFirst({ where: { id: overrideId, ruleSet: { practiceId: user.practiceId } } });
  if (o) await prisma.payerBillingOverride.delete({ where: { id: o.id } });
  back(payerId, { ok: "Override removed." }, o ? `&set=${o.ruleSetId}` : "");
}
