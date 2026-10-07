import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SIGNED_STATUSES } from "@/lib/visit-workflow";
import { parsePointerIds } from "@/lib/superbill";
import { DX_LETTERS, EDITABLE_CLAIM_STATUSES, MAX_CLAIM_DIAGNOSES } from "@/lib/claim-format";
import { networkStatusForPayer } from "@/lib/credentialing";
import { vobScopeAllows } from "@/lib/workflow-rules";
import { visitNumber } from "@/lib/practice-settings";

export class ClaimError extends Error {}

const RANK_ORDER = ["PRIMARY", "SECONDARY", "TERTIARY"];
const ADJUDICATED = ["PAID", "PARTIAL", "DENIED", "TRANSFERRED", "WRITTEN_OFF"];

export async function logClaimEvent(
  claimId: string,
  userId: string | null,
  action: string,
  detail: { field?: string; oldValue?: string | null; newValue?: string | null; note?: string | null } = {}
) {
  await prisma.claimEvent.create({
    data: {
      claimId,
      userId,
      action,
      field: detail.field ?? null,
      oldValue: detail.oldValue ?? null,
      newValue: detail.newValue ?? null,
      note: detail.note ?? null,
    },
  });
}

// Creates the visit's claim for a payer rank from the signed visit: diagnoses, service lines,
// care team, auth number and insurance are copied so the claim can be edited on its own.
export async function createClaimFromVisit(user: { id: string; practiceId: string }, encounterId: string, rank = "PRIMARY") {
  if (!RANK_ORDER.includes(rank)) throw new ClaimError("Invalid payer rank");
  const e = await prisma.encounter.findFirst({
    where: { id: encounterId, practiceId: user.practiceId },
    include: {
      patient: {
        include: {
          insurances: { include: { payer: true } },
          intakeCases: { where: { authStatus: "APPROVED" }, orderBy: { authDecisionAt: "desc" } },
        },
      },
      diagnoses: { orderBy: [{ priority: "asc" }, { id: "asc" }] },
      charges: { orderBy: { id: "asc" } },
      appointment: { include: { intakeCase: true } },
      claims: true,
    },
  });
  if (!e) throw new ClaimError("Visit not found");
  if (!SIGNED_STATUSES.includes(e.status)) throw new ClaimError("The visit must be signed before a claim is created.");
  if (e.charges.length === 0) throw new ClaimError("The visit has no charges on its superbill.");
  const settings = await prisma.practiceSettings.findUnique({ where: { practiceId: user.practiceId } });

  const active = e.claims.filter((c) => c.status !== "VOID");
  if (active.some((c) => c.payerRank === rank && c.frequencyCode !== "8")) {
    throw new ClaimError(`A ${rank.toLowerCase()} claim already exists for this visit.`);
  }
  const prevRank = RANK_ORDER[RANK_ORDER.indexOf(rank) - 1];
  if (prevRank) {
    const prev = active.find((c) => c.payerRank === prevRank);
    if (!prev || !ADJUDICATED.includes(prev.status)) {
      throw new ClaimError(`The ${prevRank.toLowerCase()} claim must be adjudicated before billing the ${rank.toLowerCase()} payer.`);
    }
  }

  const insurance =
    e.patient.insurances.find((i) => i.rank === rank && i.active) ??
    (rank === "PRIMARY" ? e.patient.insurances.find((i) => i.isPrimary) : undefined);
  if (!insurance) throw new ClaimError(`The patient has no ${rank.toLowerCase()} insurance on file.`);

  const rendering = await prisma.renderingProvider.findFirst({
    where: { practiceId: user.practiceId, userId: e.providerId },
  });
  const billingProviderId =
    e.billingProviderId ??
    (await prisma.billingProvider.findFirst({ where: { practiceId: user.practiceId, active: true } }))?.id ??
    null;

  const dxs = e.diagnoses.slice(0, MAX_CLAIM_DIAGNOSES);
  const letterFor = new Map(dxs.map((d, i) => [d.id, DX_LETTERS[i]]));
  const dos = e.appointment?.startsAt ?? e.date;
  const pos = e.placeOfService ?? "11";
  const auth =
    (e.appointment?.intakeCase?.authStatus === "APPROVED" ? e.appointment.intakeCase.authNumber : null) ??
    e.patient.intakeCases.find((c) => (!c.authStartDate || c.authStartDate <= dos) && (!c.authEndDate || c.authEndDate >= dos))
      ?.authNumber ??
    // Otherwise an encounter authorization on this coverage that covers the date of service.
    (
      await prisma.insuranceAuthorization.findFirst({
        where: {
          insuranceId: insurance.id,
          kind: "ENCOUNTER",
          authNumber: { not: null },
          AND: [{ OR: [{ startDate: null }, { startDate: { lte: dos } }] }, { OR: [{ endDate: null }, { endDate: { gte: new Date(dos.getTime() - 86_400_000) } }] }],
        },
        orderBy: { createdAt: "desc" },
      })
    )?.authNumber ??
    null;

  const lines = e.charges.map((c, i) => ({
    chargeId: c.id,
    lineNumber: i + 1,
    dosFrom: dos,
    dosTo: dos,
    placeOfService: c.placeOfService || pos,
    cptCode: c.cptCode,
    modifiers: c.modifiers,
    pointers: parsePointerIds(c.diagnosisPointers)
      .map((id) => letterFor.get(id))
      .filter(Boolean)
      .join(","),
    units: c.units,
    chargeCents: c.amountCents,
  }));

  const claim = await prisma.claim.create({
    data: {
      practiceId: user.practiceId,
      encounterId: e.id,
      patientId: e.patientId,
      payerRank: rank,
      insuranceId: insurance.id,
      payerId: insurance.payerId,
      payerName: insurance.payer.name,
      status: "DRAFT",
      placeOfService: pos,
      billingProviderId,
      renderingProviderId: rendering?.id ?? null,
      referringProviderId: e.patient.referringPhysicianId,
      supervisingProviderId: e.supervisingProviderId,
      serviceLocationId: e.appointment?.locationId ?? null,
      priorAuthNumber: auth,
      patientAccountNumber: settings?.useVisitNumbers ? visitNumber(e.id) : e.patient.mrn,
      billedCents: lines.reduce((s, l) => s + l.chargeCents, 0),
      diagnoses: { create: dxs.map((d, i) => ({ sequence: i, icd10: d.icd10, description: d.description })) },
      lines: { create: lines },
    },
  });
  await logClaimEvent(claim.id, user.id, "CREATED", { note: `${rank.toLowerCase()} claim created from the signed visit` });
  // A claim that already passes every claim edit goes straight to "ready to bill"; the rest wait in the
  // pre-release queue as drafts with the problems listed.
  const ready = await settleClaimStatus(claim.id, user.practiceId, user.id);
  await refreshVisitBillingStatus(e.id);
  return ready ?? claim;
}

// Runs the claim edits on an unsent claim and sets DRAFT (problems) or READY (clean). Returns the claim, or
// null when it is not in a pre-release status.
export async function settleClaimStatus(claimId: string, practiceId: string, userId: string) {
  const fresh = await loadClaimForEdits(claimId, practiceId);
  if (!fresh || !["DRAFT", "READY"].includes(fresh.status)) return null;
  const hasErrors = claimEdits(fresh, await claimRuleOptions(practiceId, fresh)).some((e) => e.severity === "error");
  const next = hasErrors ? "DRAFT" : "READY";
  if (next === fresh.status) return fresh;
  const updated = await prisma.claim.update({ where: { id: fresh.id }, data: { status: next } });
  await logClaimEvent(fresh.id, userId, "STATUS", { field: "status", oldValue: fresh.status, newValue: next, note: next === "READY" ? "Passed claim edits — ready to bill" : "Claim edits found problems" });
  return { ...fresh, ...updated };
}

// Billed amount follows the service lines (paid/adjusted are maintained as payments post).
export async function recomputeClaimTotals(claimId: string) {
  const lines = await prisma.claimLine.findMany({ where: { claimId }, select: { chargeCents: true } });
  await prisma.claim.update({
    where: { id: claimId },
    data: { billedCents: lines.reduce((s, l) => s + l.chargeCents, 0) },
  });
}

// Practice Mate style status for the visit, derived from its claims and balances.
export async function refreshVisitBillingStatus(encounterId: string) {
  const e = await prisma.encounter.findUnique({ where: { id: encounterId }, include: { claims: true, charges: true } });
  if (!e) return;
  const claims = e.claims.filter((c) => c.status !== "VOID" && c.frequencyCode !== "8");
  let status: string;
  if (claims.length === 0) {
    status = SIGNED_STATUSES.includes(e.status) ? "READY_FOR_CLAIM" : "OPEN";
  } else {
    const byRank = [...claims].sort((a, b) => RANK_ORDER.indexOf(b.payerRank) - RANK_ORDER.indexOf(a.payerRank));
    const latest = byRank[0];
    const charges = e.charges.reduce((s, c) => s + c.amountCents, 0);
    const collected = claims.reduce((s, c) => s + c.paidCents + c.adjustedCents, 0);
    const balance = charges - collected;
    if (claims.some((c) => c.status === "IN_COLLECTION")) status = "IN_COLLECTION";
    else if (claims.some((c) => c.status === "DELINQUENT")) status = "DELINQUENT";
    else if (latest.status === "APPEAL") status = "APPEAL";
    else if (latest.status === "DENIED") status = "INSURANCE_DENIED";
    else if (ADJUDICATED.includes(latest.status) && balance < 0) status = "INSURANCE_OVERPAYMENT";
    else if (ADJUDICATED.includes(latest.status) && balance === 0) status = "CLOSED";
    else if (ADJUDICATED.includes(latest.status) && latest.balanceResponsibility === "PATIENT") status = "PATIENT_RESPONSIBILITY";
    else if (latest.payerRank === "PRIMARY")
      status = EDITABLE_CLAIM_STATUSES.includes(latest.status) ? "CLAIM_CREATED_PRIMARY" : "BILLED_PRIMARY";
    else status = EDITABLE_CLAIM_STATUSES.includes(latest.status) ? "CLAIM_CREATED_SECONDARY" : "BILLED_SECONDARY";
  }
  if (status !== e.billingStatus) {
    await prisma.encounter.update({ where: { id: encounterId }, data: { billingStatus: status } });
  }
}

export type ClaimWithParts = Prisma.ClaimGetPayload<{
  include: {
    lines: true;
    diagnoses: true;
    insurance: true;
    payer: true;
    billingProvider: true;
    renderingProvider: true;
    patient: true;
  };
}>;

export type ClaimEdit = { severity: "error" | "warning"; field: string; message: string };

// Facility setup rules that change how claim edits behave.
export type ClaimRuleOptions = {
  rulesEnabled?: boolean;
  allowZeroCharge?: boolean;
  credentialingProblem?: string | null;
  // The VOB approved E&M and debridement only, and the practice enforces it on the claim.
  vobLimited?: boolean;
  // The payer requires CDS review and this visit never went through it.
  visitReviewProblem?: string | null;
};

export async function claimRuleOptions(
  practiceId: string,
  claim: { payerId: string | null; renderingProviderId: string | null; renderingProvider?: { name: string } | null; payerName?: string; patientId?: string; encounterId?: string }
): Promise<ClaimRuleOptions> {
  const s = await prisma.practiceSettings.findUnique({ where: { practiceId } });
  let vobLimited = false;
  if (s?.enforceVobScope && claim.patientId) {
    const c = await prisma.intakeCase.findFirst({ where: { practiceId, patientId: claim.patientId }, orderBy: { createdAt: "desc" }, select: { vobDecision: true } });
    vobLimited = c?.vobDecision === "APPROVED_LIMITED";
  }
  let visitReviewProblem: string | null = null;
  if (claim.payerId && claim.encounterId) {
    const [payer, enc] = await Promise.all([
      prisma.payer.findFirst({ where: { id: claim.payerId }, select: { requiresVisitReview: true, name: true } }),
      prisma.encounter.findFirst({ where: { id: claim.encounterId }, select: { submittedToCdsAt: true, type: true } }),
    ]);
    if (payer?.requiresVisitReview && enc && !enc.submittedToCdsAt) {
      visitReviewProblem = `${payer.name} requires CDS review of the visit before billing${enc.type === "BILLING_ONLY" ? " — a billing-only claim can't be sent to this payer" : ""}.`;
    }
  }
  let credentialingProblem: string | null = null;
  if (s?.holdClaimsForCredentialing && claim.payerId && claim.renderingProviderId) {
    const network = await networkStatusForPayer(practiceId, claim.payerId);
    const mine = network.find((n) => n.providerId === claim.renderingProviderId);
    if (!mine || mine.network !== "IN_NETWORK") {
      credentialingProblem = `Held for provider credentialing: ${claim.renderingProvider?.name ?? "the rendering provider"} is ${
        mine?.network === "PENDING" ? "still being credentialed" : "not credentialed"
      } with ${claim.payerName ?? "this payer"}.`;
    }
  }
  return {
    rulesEnabled: s?.enableClaimRules ?? true,
    allowZeroCharge: s?.allowZeroChargeClaims ?? false,
    credentialingProblem,
    vobLimited,
    visitReviewProblem,
  };
}

// Claim rules can be turned off in Facility setup; these structural problems still block submission.
const ALWAYS_BLOCKING = new Set(["insurance", "lines", "diagnoses", "credentialing", "vob", "review"]);

const NPI = /^\d{10}$/;

// Claim edits run before a claim can be submitted (the full scrubber builds on these).
export function claimEdits(c: ClaimWithParts, opts: ClaimRuleOptions = {}): ClaimEdit[] {
  const out: ClaimEdit[] = [];
  const err = (field: string, message: string) => out.push({ severity: "error", field, message });
  const warn = (field: string, message: string) => out.push({ severity: "warning", field, message });

  if (!c.insuranceId || !c.insurance) err("insurance", "No insurance selected (box 1a / 11).");
  else if (!c.insurance.memberId || c.insurance.memberId === "PENDING") err("insurance", "Insured's member ID is missing (box 1a).");
  if (!c.payer?.payerCode) warn("payer", "Payer has no EDI payer ID — the claim can only be printed on paper.");
  if (!c.patient.dob) err("patient", "Patient date of birth is missing (box 3).");
  if (!c.patient.addressLine1 || !c.patient.city || !c.patient.state || !c.patient.zip) err("patient", "Patient address is incomplete (box 5).");

  if (!c.billingProvider) err("billingProvider", "No billing provider (box 33).");
  else {
    if (!c.billingProvider.npi || !NPI.test(c.billingProvider.npi)) err("billingProvider", "Billing provider NPI must be 10 digits (box 33a).");
    if (!c.billingProvider.taxId) err("billingProvider", "Billing provider tax ID is missing (box 25).");
    if (!c.billingProvider.addressLine1 || !c.billingProvider.zip) err("billingProvider", "Billing provider address is incomplete (box 33).");
  }
  if (!c.renderingProvider) warn("renderingProvider", "No rendering provider — the billing provider will be reported as rendering (box 24J).");
  else if (!c.renderingProvider.npi || !NPI.test(c.renderingProvider.npi)) err("renderingProvider", "Rendering provider NPI must be 10 digits (box 24J).");

  if (c.diagnoses.length === 0) err("diagnoses", "At least one diagnosis code is required (box 21).");
  if (c.diagnoses.length > 12) err("diagnoses", "No more than 12 diagnosis codes (box 21 A–L).");
  if (c.lines.length === 0) err("lines", "At least one service line is required (box 24).");

  const today = new Date();
  const letters = DX_LETTERS.slice(0, c.diagnoses.length);
  for (const l of c.lines) {
    const tag = `Line ${l.lineNumber}`;
    if (!/^[A-Z0-9]{5}$/.test(l.cptCode)) err(`line-${l.lineNumber}`, `${tag}: CPT/HCPCS code "${l.cptCode}" is not a valid 5-character code.`);
    if (l.chargeCents < 0 || (l.chargeCents === 0 && !opts.allowZeroCharge)) err(`line-${l.lineNumber}`, `${tag}: charge must be greater than zero.`);
    if (!(l.units > 0)) err(`line-${l.lineNumber}`, `${tag}: units must be greater than zero.`);
    const ptrs = l.pointers ? l.pointers.split(",") : [];
    if (ptrs.length === 0) err(`line-${l.lineNumber}`, `${tag}: diagnosis pointer is required (box 24E).`);
    if (ptrs.some((p) => !letters.includes(p))) err(`line-${l.lineNumber}`, `${tag}: pointer refers to a diagnosis that isn't on the claim.`);
    const mods = l.modifiers ? l.modifiers.split(",").filter(Boolean) : [];
    if (mods.length > 4) err(`line-${l.lineNumber}`, `${tag}: no more than 4 modifiers.`);
    if (mods.some((m) => !/^[A-Z0-9]{2}$/.test(m))) err(`line-${l.lineNumber}`, `${tag}: modifiers must be 2 characters.`);
    if (l.dosFrom > today) err(`line-${l.lineNumber}`, `${tag}: date of service is in the future.`);
    if (l.dosTo < l.dosFrom) err(`line-${l.lineNumber}`, `${tag}: "to" date is before the "from" date.`);
    if (opts.vobLimited && !vobScopeAllows(l.cptCode)) err("vob", `${tag}: ${l.cptCode} is outside the VOB approval (E&M and debridement only) — remove it or have the VOB team widen the decision.`);
  }
  if (opts.visitReviewProblem) err("review", opts.visitReviewProblem);
  if (["7", "8"].includes(c.frequencyCode) && !c.originalReference) {
    err("frequency", "Corrected or void claims need the payer's original claim number (box 22).");
  }
  if (c.autoAccident && !c.autoAccidentState) err("conditions", "Auto accident needs the state (box 10b).");
  if (opts.credentialingProblem) err("credentialing", opts.credentialingProblem);
  if (opts.rulesEnabled === false) {
    return out.map((e) => (e.severity === "error" && !ALWAYS_BLOCKING.has(e.field) ? { ...e, severity: "warning" as const } : e));
  }
  return out;
}

export async function loadClaimForEdits(claimId: string, practiceId: string) {
  return prisma.claim.findFirst({
    where: { id: claimId, practiceId },
    include: {
      lines: { orderBy: { lineNumber: "asc" } },
      diagnoses: { orderBy: { sequence: "asc" } },
      insurance: true,
      payer: true,
      billingProvider: true,
      renderingProvider: true,
      patient: true,
    },
  });
}
