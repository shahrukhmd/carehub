"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getClearinghouseAdapter } from "@/lib/clearinghouse";
import {
  ClaimError,
  claimEdits,
  createClaimFromVisit,
  loadClaimForEdits,
  logClaimEvent,
  recomputeClaimTotals,
  refreshVisitBillingStatus,
} from "@/lib/claims";
import { markBilledIfComplete } from "@/lib/visit-guard";
import { SIGNED_STATUSES } from "@/lib/visit-workflow";
import { placeOfServiceLabel } from "@/lib/superbill";
import {
  EDITABLE_CLAIM_STATUSES,
  MAX_CLAIM_DIAGNOSES,
  MAX_CLAIM_LINES,
  claimFrequencyLabel,
  claimStatusLabel,
  delayReasonLabel,
  normalizePointers,
} from "@/lib/claim-format";

const BILLING_ROLES = ["ADMIN", "BILLER"];
type User = Awaited<ReturnType<typeof requireUser>>;

function fail(message: string): never {
  throw new ClaimError(message);
}

// User-fixable problems come back as a banner on the claim instead of an error screen.
async function guarded(back: string, work: () => Promise<string | void>) {
  let message: string | null = null;
  let next: string | void = undefined;
  try {
    next = await work();
  } catch (err) {
    if (!(err instanceof ClaimError)) throw err;
    message = err.message;
  }
  if (message) redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(message.slice(0, 400))}`);
  redirect(next ?? back);
}

function text(fd: FormData, key: string) {
  const v = String(fd.get(key) ?? "").trim();
  return v || null;
}

function dateField(fd: FormData, key: string) {
  const v = text(fd, key);
  if (!v) return null;
  const d = new Date(`${v}T12:00:00`);
  if (Number.isNaN(d.getTime())) fail(`${key}: invalid date`);
  return d;
}

function money(fd: FormData, key: string) {
  const v = text(fd, key);
  if (!v) return null;
  const n = Number(v.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) fail(`${key}: must be a dollar amount`);
  return Math.round(n * 100);
}

async function loadClaim(user: User, claimId: string) {
  const claim = await prisma.claim.findFirst({ where: { id: claimId, practiceId: user.practiceId } });
  if (!claim) fail("Claim not found");
  return claim;
}

function refreshAll(claimId: string, encounterId: string) {
  revalidatePath("/billing");
  revalidatePath(`/billing/claims/${claimId}`);
  revalidatePath(`/encounters/${encounterId}`);
}

// ---- Create ----

export async function createClaim(encounterId: string, rank: string) {
  const user = await requireUser(BILLING_ROLES);
  return guarded(`/billing?tab=visits`, async () => {
    const claim = await createClaimFromVisit(user, encounterId, rank);
    await logAudit(user.practiceId, user.id, "CREATE_CLAIM", "Claim", claim.id, rank);
    revalidatePath("/billing");
    return `/billing/claims/${claim.id}`;
  });
}

// ---- Edit (header boxes, diagnoses A–L, service lines) ----

const HEADER_FIELDS = [
  "insuranceId",
  "frequencyCode",
  "originalReference",
  "placeOfService",
  "billingProviderId",
  "renderingProviderId",
  "referringProviderId",
  "supervisingProviderId",
  "orderingProviderId",
  "serviceLocationId",
  "priorAuthNumber",
  "referralNumber",
  "patientAccountNumber",
  "autoAccidentState",
  "claimNote",
  "cliaNumber",
  "delayReasonCode",
] as const;
const DATE_FIELDS = ["onsetDate", "initialTreatmentDate", "unableToWorkFrom", "unableToWorkTo", "hospitalFrom", "hospitalTo"] as const;
const FLAG_FIELDS = ["acceptAssignment", "employmentRelated", "autoAccident", "otherAccident", "outsideLab"] as const;

function show(v: unknown) {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

export async function saveClaim(claimId: string, fd: FormData) {
  const user = await requireUser(BILLING_ROLES);
  return guarded(`/billing/claims/${claimId}`, async () => {
    const claim = await prisma.claim.findFirst({
      where: { id: claimId, practiceId: user.practiceId },
      include: { lines: { orderBy: { lineNumber: "asc" } }, diagnoses: { orderBy: { sequence: "asc" } } },
    });
    if (!claim) fail("Claim not found");
    if (!EDITABLE_CLAIM_STATUSES.includes(claim.status)) {
      fail(`A ${claimStatusLabel[claim.status]?.toLowerCase() ?? claim.status} claim can't be edited — create a corrected claim instead.`);
    }

    // Validate references belong to this practice.
    const insuranceId = text(fd, "insuranceId");
    const insurance = insuranceId
      ? await prisma.insurance.findFirst({ where: { id: insuranceId, patientId: claim.patientId }, include: { payer: true } })
      : null;
    if (insuranceId && !insurance) fail("Insurance does not belong to this patient.");
    for (const key of ["renderingProviderId", "referringProviderId", "supervisingProviderId", "orderingProviderId"] as const) {
      const id = text(fd, key);
      if (id && !(await prisma.renderingProvider.findFirst({ where: { id, practiceId: user.practiceId } }))) fail(`${key}: not found`);
    }
    const billingProviderId = text(fd, "billingProviderId");
    if (billingProviderId && !(await prisma.billingProvider.findFirst({ where: { id: billingProviderId, practiceId: user.practiceId } }))) {
      fail("Billing provider not found");
    }
    const serviceLocationId = text(fd, "serviceLocationId");
    if (serviceLocationId && !(await prisma.location.findFirst({ where: { id: serviceLocationId, practiceId: user.practiceId } }))) {
      fail("Service facility not found");
    }
    const frequencyCode = text(fd, "frequencyCode") ?? "1";
    if (!(frequencyCode in claimFrequencyLabel)) fail("Invalid claim frequency");
    const delay = text(fd, "delayReasonCode");
    if (delay && !(delay in delayReasonLabel)) fail("Invalid delay reason code");
    const pos = text(fd, "placeOfService");
    if (pos && !(pos in placeOfServiceLabel)) fail("Invalid place of service");

    const header: Record<string, unknown> = {};
    for (const f of HEADER_FIELDS) header[f] = text(fd, f);
    header.frequencyCode = frequencyCode;
    for (const f of DATE_FIELDS) header[f] = dateField(fd, f);
    for (const f of FLAG_FIELDS) header[f] = fd.get(f) === "on";
    header.outsideLabChargesCents = money(fd, "outsideLabCharges");
    if (insurance) {
      header.payerId = insurance.payerId;
      header.payerName = insurance.payer.name;
    }

    // Diagnoses A–L.
    const diagnoses: { sequence: number; icd10: string; description: string | null }[] = [];
    for (let i = 0; i < MAX_CLAIM_DIAGNOSES; i++) {
      const code = text(fd, `dx_${i}`)?.toUpperCase().replace(/\s/g, "");
      if (!code) continue;
      if (!/^[A-Z][0-9][0-9A-Z](\.?[0-9A-Z]{1,4})?$/.test(code)) fail(`Diagnosis ${String.fromCharCode(65 + diagnoses.length)}: "${code}" is not an ICD-10 code.`);
      diagnoses.push({ sequence: diagnoses.length, icd10: code, description: text(fd, `dxd_${i}`) });
    }

    // Service lines.
    const rowCount = Math.min(Number(fd.get("lineRows") ?? 0), MAX_CLAIM_LINES);
    const lines: Prisma.ClaimLineCreateManyInput[] = [];
    for (let i = 0; i < rowCount; i++) {
      const cpt = text(fd, `l_${i}_cpt`)?.toUpperCase();
      if (!cpt) continue;
      const from = dateField(fd, `l_${i}_from`);
      if (!from) fail(`Line ${lines.length + 1}: date of service is required.`);
      const to = dateField(fd, `l_${i}_to`) ?? from;
      const units = Number(text(fd, `l_${i}_units`) ?? "1");
      if (!Number.isFinite(units) || units <= 0) fail(`Line ${lines.length + 1}: units must be greater than zero.`);
      const chargeCents = money(fd, `l_${i}_charge`) ?? 0;
      const linePos = text(fd, `l_${i}_pos`) ?? pos ?? "11";
      if (!(linePos in placeOfServiceLabel)) fail(`Line ${lines.length + 1}: invalid place of service.`);
      const modifiers = [1, 2, 3, 4]
        .map((m) => text(fd, `l_${i}_m${m}`)?.toUpperCase())
        .filter(Boolean)
        .join(",");
      const ndcQty = text(fd, `l_${i}_ndcqty`);
      lines.push({
        claimId,
        chargeId: text(fd, `l_${i}_chargeId`),
        lineNumber: lines.length + 1,
        dosFrom: from,
        dosTo: to,
        placeOfService: linePos,
        emergency: fd.get(`l_${i}_emg`) === "on",
        cptCode: cpt,
        modifiers: modifiers || null,
        pointers: normalizePointers(text(fd, `l_${i}_ptr`) ?? "", diagnoses.length),
        units,
        chargeCents,
        ndcCode: text(fd, `l_${i}_ndc`),
        ndcQuantity: ndcQty ? Number(ndcQty) : null,
        ndcUnit: text(fd, `l_${i}_ndcunit`),
        lineNote: text(fd, `l_${i}_note`),
      });
    }
    if (lines.length === 0) fail("A claim needs at least one service line.");

    // Change log: header fields, then a summary for diagnoses and lines.
    const changes: { field: string; oldValue: string; newValue: string }[] = [];
    for (const [field, value] of Object.entries(header)) {
      if (["payerId", "payerName"].includes(field)) continue;
      const before = show((claim as Record<string, unknown>)[field]);
      const after = show(value);
      if (before !== after) changes.push({ field, oldValue: before, newValue: after });
    }
    const dxBefore = claim.diagnoses.map((d) => d.icd10).join(" ");
    const dxAfter = diagnoses.map((d) => d.icd10).join(" ");
    if (dxBefore !== dxAfter) changes.push({ field: "diagnoses", oldValue: dxBefore, newValue: dxAfter });
    const lineSig = (l: { cptCode: string; modifiers: string | null; pointers: string; units: number; chargeCents: number }) =>
      `${l.cptCode}${l.modifiers ? `-${l.modifiers}` : ""} ×${l.units} ${(l.chargeCents / 100).toFixed(2)} [${l.pointers}]`;
    const linesBefore = claim.lines.map(lineSig).join("; ");
    const linesAfter = lines.map((l) => lineSig({ ...l, modifiers: l.modifiers ?? null, units: Number(l.units) })).join("; ");
    if (linesBefore !== linesAfter) changes.push({ field: "service lines", oldValue: linesBefore, newValue: linesAfter });

    await prisma.$transaction([
      prisma.claim.update({ where: { id: claimId }, data: header as Prisma.ClaimUncheckedUpdateInput }),
      prisma.claimDiagnosis.deleteMany({ where: { claimId } }),
      prisma.claimDiagnosis.createMany({ data: diagnoses.map((d) => ({ ...d, claimId })) }),
      prisma.claimLine.deleteMany({ where: { claimId } }),
      prisma.claimLine.createMany({ data: lines }),
    ]);
    await recomputeClaimTotals(claimId);
    for (const c of changes) await logClaimEvent(claimId, user.id, "EDITED", c);

    // A clean claim is ready to submit; one with errors goes back to draft.
    const fresh = await loadClaimForEdits(claimId, user.practiceId);
    if (fresh && ["DRAFT", "READY"].includes(fresh.status)) {
      const hasErrors = claimEdits(fresh).some((e) => e.severity === "error");
      const next = hasErrors ? "DRAFT" : "READY";
      if (next !== fresh.status) {
        await prisma.claim.update({ where: { id: claimId }, data: { status: next } });
        await logClaimEvent(claimId, user.id, "STATUS", { field: "status", oldValue: fresh.status, newValue: next });
      }
    }
    await refreshVisitBillingStatus(claim.encounterId);
    refreshAll(claimId, claim.encounterId);
  });
}

// ---- Submit ----

export async function submitClaim(claimId: string) {
  const user = await requireUser(BILLING_ROLES);
  return guarded(`/billing/claims/${claimId}`, async () => {
    const claim = await loadClaimForEdits(claimId, user.practiceId);
    if (!claim) fail("Claim not found");
    if (!["DRAFT", "READY", "EDI_REJECTED"].includes(claim.status)) fail(`A ${claimStatusLabel[claim.status]?.toLowerCase()} claim can't be submitted.`);
    const encounter = await prisma.encounter.findUniqueOrThrow({ where: { id: claim.encounterId } });
    if (!SIGNED_STATUSES.includes(encounter.status)) fail("The visit isn't signed and ready for billing.");
    const errors = claimEdits(claim).filter((e) => e.severity === "error");
    if (errors.length) fail(`Fix ${errors.length} claim edit(s) first: ${errors.map((e) => e.message).join(" ")}`);

    const result = await getClearinghouseAdapter().submitClaim({
      claimId: claim.id,
      payerId: claim.payerId ?? "",
      payerCode: claim.payer?.payerCode ?? null,
      billedCents: claim.billedCents,
      frequencyCode: claim.frequencyCode,
      diagnosisCodes: claim.diagnoses.map((d) => d.icd10),
      lines: claim.lines.map((l) => ({ cptCode: l.cptCode, chargeCents: l.chargeCents, units: l.units, pointers: l.pointers })),
    });

    if (result.status === "ACCEPTED") {
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
      await logAudit(user.practiceId, user.id, "SUBMIT_CLAIM", "Claim", claim.id, result.clearinghouseClaimId);
      await markBilledIfComplete(claim.encounterId, user.id);
    } else if (result.status === "REJECTED") {
      await prisma.claim.update({
        where: { id: claim.id },
        data: { status: "EDI_REJECTED", clearinghouseStatus: "REJECTED", rejectionReason: result.rejectionReason ?? "Rejected" },
      });
      await logClaimEvent(claim.id, user.id, "EDI_REJECTED", { note: result.rejectionReason });
      await logAudit(user.practiceId, user.id, "EDI_REJECTED", "Claim", claim.id, result.rejectionReason);
    } else {
      await prisma.claim.update({
        where: { id: claim.id },
        data: { clearinghouseStatus: "ERROR", rejectionReason: result.rejectionReason ?? "Clearinghouse error" },
      });
      await logClaimEvent(claim.id, user.id, "SUBMIT_ERROR", { note: result.rejectionReason });
    }
    await refreshVisitBillingStatus(claim.encounterId);
    refreshAll(claim.id, claim.encounterId);
  });
}

// ---- Status changes ----

const MANUAL_STATUSES = ["DENIED", "APPEAL", "DELINQUENT", "IN_COLLECTION", "WRITTEN_OFF", "ACCEPTED"];

export async function setClaimStatus(claimId: string, fd: FormData) {
  const user = await requireUser(BILLING_ROLES);
  return guarded(`/billing/claims/${claimId}`, async () => {
    const claim = await loadClaim(user, claimId);
    const status = text(fd, "status");
    if (!status || !MANUAL_STATUSES.includes(status)) fail("Pick a status.");
    if (EDITABLE_CLAIM_STATUSES.includes(claim.status)) fail("Submit the claim before recording a payer outcome.");
    const note = text(fd, "note");
    if (["DENIED", "WRITTEN_OFF"].includes(status) && !note) fail("A reason is required.");
    await prisma.claim.update({
      where: { id: claim.id },
      data: { status, statusNote: note, denialReason: status === "DENIED" ? note : claim.denialReason },
    });
    await logClaimEvent(claim.id, user.id, "STATUS", { field: "status", oldValue: claim.status, newValue: status, note });
    await logAudit(user.practiceId, user.id, "SET_CLAIM_STATUS", "Claim", claim.id, status);
    await refreshVisitBillingStatus(claim.encounterId);
    refreshAll(claim.id, claim.encounterId);
  });
}

export async function holdClaim(claimId: string, fd: FormData) {
  const user = await requireUser(BILLING_ROLES);
  return guarded(`/billing/claims/${claimId}`, async () => {
    const claim = await loadClaim(user, claimId);
    if (!["DRAFT", "READY", "EDI_REJECTED"].includes(claim.status)) fail("Only unsent claims can be held.");
    const note = text(fd, "note");
    if (!note) fail("A reason is required for a hold.");
    await prisma.claim.update({ where: { id: claim.id }, data: { status: "HOLD", statusNote: note } });
    await logClaimEvent(claim.id, user.id, "STATUS", { field: "status", oldValue: claim.status, newValue: "HOLD", note });
    await refreshVisitBillingStatus(claim.encounterId);
    refreshAll(claim.id, claim.encounterId);
  });
}

export async function releaseClaim(claimId: string) {
  const user = await requireUser(BILLING_ROLES);
  return guarded(`/billing/claims/${claimId}`, async () => {
    const claim = await loadClaim(user, claimId);
    if (claim.status !== "HOLD") fail("Claim isn't on hold.");
    await prisma.claim.update({ where: { id: claim.id }, data: { status: "DRAFT", statusNote: null } });
    await logClaimEvent(claim.id, user.id, "STATUS", { field: "status", oldValue: "HOLD", newValue: "DRAFT" });
    await refreshVisitBillingStatus(claim.encounterId);
    refreshAll(claim.id, claim.encounterId);
  });
}

// Denied claims can be resent unchanged (e.g. after the payer fixed eligibility).
export async function resubmitDenied(claimId: string) {
  const user = await requireUser(BILLING_ROLES);
  return guarded(`/billing/claims/${claimId}`, async () => {
    const claim = await loadClaim(user, claimId);
    if (!["DENIED", "APPEAL"].includes(claim.status)) fail("Only denied or appealed claims can be resubmitted.");
    await prisma.claim.update({
      where: { id: claim.id },
      data: { status: "SUBMITTED", submittedAt: new Date(), denialReason: null, attempt: claim.attempt + 1 },
    });
    await logClaimEvent(claim.id, user.id, "RESUBMITTED", { note: `Attempt ${claim.attempt + 1}` });
    await refreshVisitBillingStatus(claim.encounterId);
    refreshAll(claim.id, claim.encounterId);
  });
}

// Corrected (7) or void (8) claim: copies the claim, references the payer's original claim number
// and voids the original so it no longer counts toward AR.
export async function correctClaim(claimId: string, frequency: "7" | "8") {
  const user = await requireUser(BILLING_ROLES);
  return guarded(`/billing/claims/${claimId}`, async () => {
    const c = await prisma.claim.findFirst({
      where: { id: claimId, practiceId: user.practiceId },
      include: { lines: true, diagnoses: true },
    });
    if (!c) fail("Claim not found");
    if (EDITABLE_CLAIM_STATUSES.includes(c.status) || c.status === "VOID") fail("Only a claim the payer has received can be corrected or voided.");
    if (c.paidCents || c.adjustedCents) fail("Payments are posted on this claim — reverse them before replacing it.");
    const { id: _id, createdAt: _c, updatedAt: _u, lines, diagnoses, ...rest } = c;
    void _id;
    void _c;
    void _u;
    const copy = await prisma.claim.create({
      data: {
        ...rest,
        frequencyCode: frequency,
        originalReference: c.clearinghouseClaimId ?? c.originalReference,
        replacesClaimId: c.id,
        status: "DRAFT",
        submittedAt: null,
        clearinghouseStatus: null,
        clearinghouseClaimId: null,
        rejectionReason: null,
        denialReason: null,
        statusNote: null,
        attempt: 1,
        diagnoses: { create: diagnoses.map((d) => ({ sequence: d.sequence, icd10: d.icd10, description: d.description })) },
        lines: {
          create: lines.map(({ id: _lid, claimId: _cid, paidCents: _p, adjustedCents: _a, ...l }) => {
            void _lid;
            void _cid;
            void _p;
            void _a;
            return l;
          }),
        },
      },
    });
    await prisma.claim.update({ where: { id: c.id }, data: { status: "VOID", statusNote: `Replaced by frequency ${frequency} claim` } });
    await logClaimEvent(c.id, user.id, "STATUS", { field: "status", oldValue: c.status, newValue: "VOID", note: `Replaced by ${copy.id}` });
    await logClaimEvent(copy.id, user.id, "CREATED", { note: `${frequency === "7" ? "Corrected" : "Void"} claim for ${c.id}` });
    await refreshVisitBillingStatus(c.encounterId);
    refreshAll(copy.id, c.encounterId);
    return `/billing/claims/${copy.id}`;
  });
}

// ---- Payments against a claim ----

export async function applyPayment(claimId: string, fd: FormData) {
  const user = await requireUser(BILLING_ROLES);
  return guarded(`/billing/claims/${claimId}`, async () => {
    const claim = await prisma.claim.findFirst({
      where: { id: claimId, practiceId: user.practiceId },
      include: { patient: { include: { insurances: true } } },
    });
    if (!claim) fail("Claim not found");
    if (EDITABLE_CLAIM_STATUSES.includes(claim.status) || claim.status === "VOID") fail("Post payments after the claim is submitted.");
    const depositId = text(fd, "depositId");
    const deposit = depositId ? await prisma.deposit.findFirst({ where: { id: depositId, practiceId: user.practiceId } }) : null;
    if (!deposit) fail("Pick a deposit to apply from.");
    const amountCents = money(fd, "amount") ?? 0;
    const type = fd.get("type") === "ADJUSTMENT" ? "ADJUSTMENT" : "PAYMENT";
    if (amountCents <= 0) fail("Amount must be greater than zero.");
    if (amountCents > deposit.unappliedCents) fail("Amount exceeds the deposit's unapplied balance.");

    const paidCents = claim.paidCents + (type === "PAYMENT" ? amountCents : 0);
    const adjustedCents = claim.adjustedCents + (type === "ADJUSTMENT" ? amountCents : 0);
    const balance = claim.billedCents - paidCents - adjustedCents;
    const nextRank = claim.payerRank === "PRIMARY" ? "SECONDARY" : claim.payerRank === "SECONDARY" ? "TERTIARY" : null;
    const hasNextPayer = Boolean(nextRank && claim.patient.insurances.some((i) => i.rank === nextRank && i.active));
    // Insurance paid part: the rest goes to the next payer if there is one, otherwise to the patient.
    const status = balance <= 0 ? "PAID" : deposit.payerType === "INSURANCE" && hasNextPayer ? "TRANSFERRED" : "PARTIAL";
    const balanceResponsibility =
      balance > 0 && deposit.payerType === "INSURANCE" && !hasNextPayer ? "PATIENT" : claim.balanceResponsibility;

    await prisma.$transaction([
      prisma.paymentApplication.create({ data: { depositId: deposit.id, claimId: claim.id, amountCents, type } }),
      prisma.deposit.update({ where: { id: deposit.id }, data: { unappliedCents: deposit.unappliedCents - amountCents } }),
      prisma.claim.update({ where: { id: claim.id }, data: { paidCents, adjustedCents, status, balanceResponsibility } }),
    ]);
    await logClaimEvent(claim.id, user.id, type === "PAYMENT" ? "PAYMENT" : "ADJUSTMENT", {
      note: `${deposit.payerName} · $${(amountCents / 100).toFixed(2)}${status !== claim.status ? ` · ${claimStatusLabel[status]}` : ""}`,
    });
    await logAudit(user.practiceId, user.id, type === "ADJUSTMENT" ? "POST_ADJUSTMENT" : "POST_PAYMENT", "Claim", claim.id, `$${(amountCents / 100).toFixed(2)}`);
    await refreshVisitBillingStatus(claim.encounterId);
    refreshAll(claim.id, claim.encounterId);
  });
}

export async function setBalanceResponsibility(claimId: string, fd: FormData) {
  const user = await requireUser(BILLING_ROLES);
  return guarded(`/billing/claims/${claimId}`, async () => {
    const claim = await loadClaim(user, claimId);
    const value = fd.get("value") === "PATIENT" ? "PATIENT" : "INSURANCE";
    await prisma.claim.update({ where: { id: claim.id }, data: { balanceResponsibility: value } });
    await logClaimEvent(claim.id, user.id, "EDITED", { field: "balanceResponsibility", oldValue: claim.balanceResponsibility, newValue: value });
    await refreshVisitBillingStatus(claim.encounterId);
    refreshAll(claim.id, claim.encounterId);
  });
}
