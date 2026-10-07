import "server-only";
import { prisma } from "@/lib/prisma";
import { resolveBillingRules } from "@/lib/payer-rules";
import { ensureFollowUp, resolveFollowUps } from "@/lib/followups";
import { organizationHold } from "@/lib/organization";
import { logAudit } from "@/lib/audit";
import { getClearinghouseAdapter } from "@/lib/clearinghouse";
import { claimStatusLabel } from "@/lib/claim-format";
import { claimEdits, claimRuleOptions, loadClaimForEdits, logClaimEvent, refreshVisitBillingStatus, type ClaimEdit, type ClaimWithParts } from "@/lib/claims";
import { markBilledIfComplete } from "@/lib/visit-guard";
import { SIGNED_STATUSES } from "@/lib/visit-workflow";
import { EDI_FILE_EVENT, build837ForClaim } from "@/lib/x12-837p";

type Actor = { id: string; practiceId: string };

// Statuses a claim can be released from (electronically or on paper). A claim on hold has to be taken off hold first.
export const RELEASABLE_STATUSES = ["DRAFT", "READY", "EDI_REJECTED"];

// ClaimEvent actions that record a batch: field = batch ID, newValue = outcome, note = what happened.
export const BULK_RELEASE_EVENT = "BULK_RELEASE";
export const PAPER_CLAIM_EVENT = "PAPER_CLAIM";
// clearinghouseStatus of a claim that was printed and mailed instead of sent through the clearinghouse.
export const PAPER_STATUS = "PAPER";

// RELEASED: accepted by the clearinghouse. REJECTED: the clearinghouse refused it. ERROR: it couldn't be reached.
// BLOCKED: never sent, because of the claim's status, its visit, or its claim edits.
export type ReleaseOutcome = { outcome: "RELEASED" | "REJECTED" | "ERROR" | "BLOCKED"; message: string; encounterId: string | null };

export const releaseOutcomeLabel: Record<string, string> = {
  RELEASED: "Released",
  REJECTED: "Rejected by clearinghouse",
  ERROR: "Not sent — clearinghouse error",
  BLOCKED: "Not released — needs fixing",
};

// "RB-261001-4F2A": prefix, date and a short random tail, so batches sort by day and stay easy to read out.
export function batchId(prefix: "RB" | "PB") {
  const d = new Date();
  const day = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `${prefix}-${day}-${Math.random().toString(16).slice(2, 6).toUpperCase().padEnd(4, "0")}`;
}

// The checks every claim passes before it leaves, whichever way it leaves. Returns why it can't go, or null.
// paper: the "no EDI payer ID" warning is the reason the claim is being printed, so it never blocks.
export async function releaseProblem(practiceId: string, claim: ClaimWithParts, opts: { warningsBlock?: boolean; paper?: boolean } = {}): Promise<string | null> {
  const hold = await organizationHold(practiceId);
  if (hold) return hold;
  if (!RELEASABLE_STATUSES.includes(claim.status)) return `A ${claimStatusLabel[claim.status]?.toLowerCase() ?? claim.status} claim can't be submitted.`;
  // Payer billing rules: a hold on the payer stops everything; a paper-only payer stops electronic release.
  const rules = await resolveBillingRules(claim);
  if (rules.hold) return rules.hold;
  if (rules.submissionType === "PAPER" && !opts.paper) return `${claim.payerName} is set up for paper claims — print it from the paper worklist instead of releasing it electronically.`;
  const encounter = await prisma.encounter.findUniqueOrThrow({ where: { id: claim.encounterId }, select: { status: true } });
  if (!SIGNED_STATUSES.includes(encounter.status)) return "The visit isn't signed and ready for billing.";
  const edits = claimEdits(claim, await claimRuleOptions(practiceId, claim));
  const errors = edits.filter((e) => e.severity === "error");
  if (errors.length) return `Fix ${errors.length} claim edit(s) first: ${errors.map((e) => e.message).join(" ")}`;
  const warnings = edits.filter((e) => e.severity === "warning" && !(opts.paper && e.field === "payer"));
  if (opts.warningsBlock && warnings.length) return `${warnings.length} warning(s): ${warnings.map((e) => e.message).join(" ")}`;
  return null;
}

// Edits for a list of claims, for the release and paper worklists.
export async function editsFor(practiceId: string, claimIds: string[]) {
  const out = new Map<string, ClaimEdit[]>();
  for (const id of claimIds) {
    const claim = await loadClaimForEdits(id, practiceId);
    if (claim) out.set(id, claimEdits(claim, await claimRuleOptions(practiceId, claim)));
  }
  return out;
}

// Sends one claim to the clearinghouse. Used by "Submit claim" on the claim screen and by bulk release, so a claim
// goes through the same checks whichever way it is released. warningsBlock also stops a claim that only has warnings.
export async function releaseClaimToClearinghouse(user: Actor, claimId: string, opts: { warningsBlock?: boolean } = {}): Promise<ReleaseOutcome> {
  const claim = await loadClaimForEdits(claimId, user.practiceId);
  if (!claim) return { outcome: "BLOCKED", message: "Claim not found", encounterId: null };
  const problem = await releaseProblem(user.practiceId, claim, opts);
  if (problem) return { outcome: "BLOCKED", message: problem, encounterId: claim.encounterId };

  // The 837P as it leaves. It is kept on the claim log so what was billed can be read back and resent.
  const edi = await build837ForClaim(claim.id, user.practiceId);
  const result = await getClearinghouseAdapter().submitClaim({
    claimId: claim.id,
    payerId: claim.payerId ?? "",
    payerCode: claim.payer?.payerCode ?? null,
    billedCents: claim.billedCents,
    frequencyCode: claim.frequencyCode,
    diagnosisCodes: claim.diagnoses.map((d) => d.icd10),
    lines: claim.lines.map((l) => ({ cptCode: l.cptCode, chargeCents: l.chargeCents, units: l.units, pointers: l.pointers })),
    edi837: edi?.text,
  });

  let out: ReleaseOutcome;
  if (result.status === "ACCEPTED") {
    if (edi) await logClaimEvent(claim.id, user.id, EDI_FILE_EVENT, { field: edi.controlNumber, newValue: result.clearinghouseClaimId ?? null, note: edi.text });
    await prisma.claim.update({
      where: { id: claim.id },
      data: {
        status: "SUBMITTED",
        submittedAt: new Date(),
        clearinghouseStatus: "ACCEPTED",
        clearinghouseClaimId: result.clearinghouseClaimId ?? null,
        rejectionReason: null,
        attempt: claim.status === "EDI_REJECTED" ? claim.attempt + 1 : claim.attempt,
      },
    });
    await logClaimEvent(claim.id, user.id, "SUBMITTED", { note: `Accepted by clearinghouse · ${result.clearinghouseClaimId ?? ""}` });
    if (claim.status === "EDI_REJECTED") await resolveFollowUps(claim.id, "RESUBMITTED", user.id);
    await logAudit(user.practiceId, user.id, "SUBMIT_CLAIM", "Claim", claim.id, result.clearinghouseClaimId);
    await markBilledIfComplete(claim.encounterId, user.id);
    out = { outcome: "RELEASED", message: `Accepted by the clearinghouse${result.clearinghouseClaimId ? ` · ${result.clearinghouseClaimId}` : ""}`, encounterId: claim.encounterId };
  } else if (result.status === "REJECTED") {
    await prisma.claim.update({
      where: { id: claim.id },
      data: { status: "EDI_REJECTED", clearinghouseStatus: "REJECTED", rejectionReason: result.rejectionReason ?? "Rejected" },
    });
    await logClaimEvent(claim.id, user.id, "EDI_REJECTED", { note: result.rejectionReason });
    await ensureFollowUp({ claimId: claim.id, trigger: "REJECTION", note: result.rejectionReason ?? "Rejected by the clearinghouse", userId: user.id });
    await logAudit(user.practiceId, user.id, "EDI_REJECTED", "Claim", claim.id, result.rejectionReason);
    out = { outcome: "REJECTED", message: result.rejectionReason ?? "Rejected by the clearinghouse", encounterId: claim.encounterId };
  } else {
    await prisma.claim.update({
      where: { id: claim.id },
      data: { clearinghouseStatus: "ERROR", rejectionReason: result.rejectionReason ?? "Clearinghouse error" },
    });
    await logClaimEvent(claim.id, user.id, "SUBMIT_ERROR", { note: result.rejectionReason });
    out = { outcome: "ERROR", message: result.rejectionReason ?? "Clearinghouse error — try again", encounterId: claim.encounterId };
  }
  await refreshVisitBillingStatus(claim.encounterId);
  return out;
}

// Marks one claim as printed on a CMS-1500 and mailed. Same checks as an electronic release.
export async function releaseClaimOnPaper(user: Actor, claimId: string, batch: string): Promise<ReleaseOutcome> {
  const claim = await loadClaimForEdits(claimId, user.practiceId);
  if (!claim) return { outcome: "BLOCKED", message: "Claim not found", encounterId: null };
  if (claim.formType !== "CMS1500") return { outcome: "BLOCKED", message: "Only CMS-1500 claims can be printed.", encounterId: claim.encounterId };
  const problem = await releaseProblem(user.practiceId, claim, { paper: true });
  if (problem) return { outcome: "BLOCKED", message: problem, encounterId: claim.encounterId };

  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      status: "SUBMITTED",
      submittedAt: new Date(),
      clearinghouseStatus: PAPER_STATUS,
      clearinghouseClaimId: null,
      rejectionReason: null,
      attempt: claim.status === "EDI_REJECTED" ? claim.attempt + 1 : claim.attempt,
    },
  });
  await logClaimEvent(claim.id, user.id, "SUBMITTED", { note: `Printed on CMS-1500 to mail to the payer · batch ${batch}` });
  await logAudit(user.practiceId, user.id, "PAPER_CLAIM", "Claim", claim.id, batch);
  await markBilledIfComplete(claim.encounterId, user.id);
  await refreshVisitBillingStatus(claim.encounterId);
  return { outcome: "RELEASED", message: "Printed on CMS-1500", encounterId: claim.encounterId };
}
