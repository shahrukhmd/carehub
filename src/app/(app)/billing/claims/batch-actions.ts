"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { ClaimError, createClaimFromVisit, logClaimEvent } from "@/lib/claims";
import { BULK_RELEASE_EVENT, PAPER_CLAIM_EVENT, batchId, releaseClaimOnPaper, releaseClaimToClearinghouse } from "@/lib/claim-submit";
import { DX_LETTERS, PAYER_RANKS, normalizePointers } from "@/lib/claim-format";
import { scheduleFor } from "@/lib/charge-schedules";
import { placeOfServiceLabel } from "@/lib/superbill";

const BILLING_ROLES = ["ADMIN", "BILLER"];
const MAX_BULK_RELEASE = 200;
const MAX_PAPER_CLAIMS = 75;
const MANUAL_DIAGNOSES = 4;
const MANUAL_LINES = 6;

const back = (path: string, kind: "error" | "ok", message: string): never =>
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message.slice(0, 400))}`);

const selectedClaims = (fd: FormData) => [...new Set(fd.getAll("claim").map(String).filter((id) => /^[a-z0-9]{10,40}$/.test(id)))];

function text(fd: FormData, key: string) {
  const v = String(fd.get(key) ?? "").trim();
  return v || null;
}

// ---- Bulk release: send every ticked claim to the clearinghouse and record the result under one batch ID ----

export async function bulkRelease(fd: FormData) {
  const user = await requireUser(BILLING_ROLES);
  const ids = selectedClaims(fd);
  if (ids.length === 0) back("/billing/claims/release", "error", "Tick at least one claim to bill.");
  if (ids.length > MAX_BULK_RELEASE) back("/billing/claims/release", "error", `Bill up to ${MAX_BULK_RELEASE} claims at a time.`);
  const warningsBlock = fd.get("warningsBlock") === "on";

  const batch = batchId("RB");
  for (const id of ids) {
    const result = await releaseClaimToClearinghouse(user, id, { warningsBlock });
    if (!result.encounterId) continue; // not a claim of this practice
    await logClaimEvent(id, user.id, BULK_RELEASE_EVENT, { field: batch, newValue: result.outcome, note: result.message });
    revalidatePath(`/billing/claims/${id}`);
  }
  await logAudit(user.practiceId, user.id, "BULK_RELEASE", "Claim", undefined, `${batch} · ${ids.length} claim(s)`);
  revalidatePath("/billing");
  redirect(`/billing/claims/release/status?batch=${batch}`);
}

// ---- Paper claims: mark the ticked claims as printed and mailed, then offer the batch PDF ----

export async function createPaperClaims(fd: FormData) {
  const user = await requireUser(BILLING_ROLES);
  const ids = selectedClaims(fd);
  // Problems come back to the list the biller was looking at.
  const here = `/billing/claims/paper${fd.get("view") === "UNSENT" ? "?status=UNSENT" : ""}`;
  if (ids.length === 0) back(here, "error", "Tick at least one claim to print.");
  if (ids.length > MAX_PAPER_CLAIMS) back(here, "error", `The maximum number of paper claims to create is ${MAX_PAPER_CLAIMS} at a time.`);

  const batch = batchId("PB");
  let printed = 0;
  const skipped: string[] = [];
  for (const id of ids) {
    const result = await releaseClaimOnPaper(user, id, batch);
    if (!result.encounterId) continue;
    await logClaimEvent(id, user.id, PAPER_CLAIM_EVENT, { field: batch, newValue: result.outcome, note: result.message });
    if (result.outcome === "RELEASED") printed++;
    else skipped.push(result.message);
    revalidatePath(`/billing/claims/${id}`);
  }
  revalidatePath("/billing");
  if (printed === 0) back(here, "error", `No paper claims were created. ${skipped[0] ?? ""}`);

  const p = new URLSearchParams({ status: "PRINTED", batch, printed: String(printed), skipped: String(skipped.length) });
  if (fd.get("omitPayments") === "on") p.set("omitPayments", "on");
  if (fd.get("dataOnly") === "on") p.set("dataOnly", "on");
  redirect(`/billing/claims/paper?${p}`);
}

// ---- Generate claims: a primary claim for every ticked signed visit, into the pre-release queue ----

const MAX_GENERATE = 200;

export async function generateClaims(fd: FormData) {
  const user = await requireUser(BILLING_ROLES);
  const here = "/billing?tab=visits";
  const ids = [...new Set(fd.getAll("visit").map(String).filter((id) => /^[a-z0-9]{10,40}$/.test(id)))];
  if (ids.length === 0) back(here, "error", "Tick at least one visit to generate claims for.");
  if (ids.length > MAX_GENERATE) back(here, "error", `Generate up to ${MAX_GENERATE} claims at a time.`);

  let created = 0;
  let clean = 0;
  const skipped: string[] = [];
  for (const id of ids) {
    try {
      const claim = await createClaimFromVisit(user, id, "PRIMARY");
      await logAudit(user.practiceId, user.id, "CREATE_CLAIM", "Claim", claim.id, "PRIMARY · generated");
      created++;
      if (claim.status === "READY") clean++;
      revalidatePath(`/encounters/${id}`);
    } catch (err) {
      if (!(err instanceof ClaimError)) throw err;
      const visit = await prisma.encounter.findFirst({ where: { id, practiceId: user.practiceId }, select: { date: true, patient: { select: { lastName: true, firstName: true } } } });
      skipped.push(`${visit ? `${visit.patient.lastName}, ${visit.patient.firstName} (${visit.date.toISOString().slice(0, 10)})` : id}: ${err.message}`);
    }
  }
  revalidatePath("/billing");
  if (created === 0) back(here, "error", `No claims were generated. ${skipped.slice(0, 3).join(" · ")}`);
  const note = `${created} claim${created === 1 ? "" : "s"} generated into the pre-release queue — ${clean} ready to bill, ${created - clean} need${created - clean === 1 ? "s" : ""} fixing.${skipped.length ? ` ${skipped.length} visit${skipped.length === 1 ? "" : "s"} skipped: ${skipped.slice(0, 3).join(" · ")}${skipped.length > 3 ? " …" : ""}` : ""}`;
  back("/billing/claims/release", "ok", note);
}

// ---- Create new claim ----

export async function createClaimForVisit(patientId: string, encounterId: string, rank: string) {
  const user = await requireUser(BILLING_ROLES);
  const here = `/billing/claims/new?patient=${patientId}`;
  let claimId: string | null = null;
  try {
    const claim = await createClaimFromVisit(user, encounterId, rank);
    await logAudit(user.practiceId, user.id, "CREATE_CLAIM", "Claim", claim.id, rank);
    claimId = claim.id;
  } catch (err) {
    if (!(err instanceof ClaimError)) throw err;
    back(here, "error", err.message);
  }
  revalidatePath("/billing");
  redirect(`/billing/claims/${claimId}`);
}

// A claim keyed by billing for a service that has no chart visit in CareHub (a visit documented elsewhere, a
// late charge). It is stored as a billing-only visit so the claim, its charges and its payments stay linked
// the same way as every other claim.
export async function createManualClaim(patientId: string, fd: FormData) {
  const user = await requireUser(BILLING_ROLES);
  const here = `/billing/claims/new?patient=${patientId}`;
  const stop = (message: string): never => back(here, "error", message);

  const patient = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId }, select: { id: true } });
  if (!patient) redirect("/billing/claims/new");

  const rank = text(fd, "rank") ?? "PRIMARY";
  if (!PAYER_RANKS.includes(rank)) stop("Pick which coverage to bill.");
  const dosText = text(fd, "dos");
  const dos = dosText && /^\d{4}-\d{2}-\d{2}$/.test(dosText) ? new Date(`${dosText}T12:00:00`) : null;
  if (!dos || Number.isNaN(dos.getTime())) stop("Enter the date of service.");
  if (dos! > new Date()) stop("The date of service can't be in the future.");
  const pos = text(fd, "placeOfService") ?? "11";
  if (!(pos in placeOfServiceLabel)) stop("Invalid place of service.");
  const provider = await prisma.renderingProvider.findFirst({
    where: { id: text(fd, "provider") ?? "", practiceId: user.practiceId, userId: { not: null } },
    select: { id: true, userId: true },
  });
  if (!provider?.userId) stop("Pick the rendering provider.");
  const coverage = await prisma.insurance.findFirst({ where: { patientId, active: true, rank }, select: { payerId: true } });
  const site = await prisma.patient.findFirst({ where: { id: patientId }, select: { siteOfServiceId: true } });
  const schedule = await scheduleFor(user.practiceId, { date: dos!, locationId: site?.siteOfServiceId, providerId: provider!.id, payerId: coverage?.payerId });

  const catalog = await prisma.practiceCode.findMany({ where: { practiceId: user.practiceId, active: true } });
  const describe = (type: string, code: string) => catalog.find((c) => c.type === type && c.code.toUpperCase() === code);

  const diagnoses: { icd10: string; description: string }[] = [];
  for (let i = 0; i < MANUAL_DIAGNOSES; i++) {
    const code = text(fd, `dx_${i}`)?.toUpperCase().replace(/\s/g, "");
    if (!code) continue;
    if (!/^[A-Z][0-9][0-9A-Z](\.?[0-9A-Z]{1,4})?$/.test(code)) stop(`Diagnosis ${DX_LETTERS[diagnoses.length]}: "${code}" is not an ICD-10 code.`);
    diagnoses.push({ icd10: code, description: describe("ICD10", code)?.description ?? code });
  }
  if (diagnoses.length === 0) stop("Enter at least one diagnosis code.");

  const lines: { cptCode: string; description: string; modifiers: string | null; units: number; amountCents: number; pointers: string[] }[] = [];
  for (let i = 0; i < MANUAL_LINES; i++) {
    const cpt = text(fd, `l_${i}_cpt`)?.toUpperCase();
    if (!cpt) continue;
    const n = lines.length + 1;
    if (!/^[A-Z0-9]{5}$/.test(cpt)) stop(`Line ${n}: "${cpt}" is not a 5-character CPT / HCPCS code.`);
    const units = Number(text(fd, `l_${i}_units`) ?? "1");
    if (!Number.isInteger(units) || units <= 0) stop(`Line ${n}: units must be a whole number greater than zero.`);
    const known = describe("CPT", cpt);
    const chargeText = text(fd, `l_${i}_charge`);
    const charge = chargeText ? Number(chargeText.replace(/[$,\s]/g, "")) : null;
    if (charge !== null && (!Number.isFinite(charge) || charge < 0)) stop(`Line ${n}: the charge must be a dollar amount.`);
    // No charge typed: the fee from the charge schedule covering the visit, else the practice code list, times the units.
    const fee = schedule?.fees.get(cpt)?.feeCents ?? known?.feeCents ?? 0;
    const amountCents = charge !== null ? Math.round(charge * 100) : fee * units;
    if (charge === null && !fee) stop(`Line ${n}: enter a charge — ${cpt} has no fee on a charge schedule or the practice code list.`);
    const modifiers = (text(fd, `l_${i}_mod`) ?? "")
      .toUpperCase()
      .split(/[\s,]+/)
      .filter(Boolean);
    if (modifiers.length > 4 || modifiers.some((m) => !/^[A-Z0-9]{2}$/.test(m))) stop(`Line ${n}: up to 4 two-character modifiers.`);
    const pointers = normalizePointers(text(fd, `l_${i}_ptr`) ?? "A", diagnoses.length).split(",").filter(Boolean);
    if (pointers.length === 0) stop(`Line ${n}: the diagnosis pointer must be one of ${DX_LETTERS.slice(0, diagnoses.length).join(", ")}.`);
    lines.push({ cptCode: cpt, description: known?.description ?? cpt, modifiers: modifiers.join(",") || null, units, amountCents, pointers });
  }
  if (lines.length === 0) stop("Enter at least one service line.");

  const encounter = await prisma.encounter.create({
    data: {
      practiceId: user.practiceId,
      patientId,
      providerId: provider!.userId!,
      date: dos!,
      type: "BILLING_ONLY",
      status: "READY_FOR_BILLING",
      placeOfService: pos,
      chiefComplaint: "Billing-only claim — entered by billing, no chart note in CareHub.",
      finalizedAt: new Date(),
    },
  });
  let claimId: string | null = null;
  let problem: string | null = null;
  try {
    const dxIds: string[] = [];
    for (const [i, d] of diagnoses.entries()) {
      dxIds.push((await prisma.encounterDiagnosis.create({ data: { encounterId: encounter.id, icd10: d.icd10, description: d.description, priority: i + 1 } })).id);
    }
    await prisma.charge.createMany({
      data: lines.map((l) => ({
        practiceId: user.practiceId,
        encounterId: encounter.id,
        cptCode: l.cptCode,
        description: l.description,
        units: l.units,
        amountCents: l.amountCents,
        modifiers: l.modifiers,
        placeOfService: pos,
        diagnosisPointers: l.pointers.map((p) => dxIds[DX_LETTERS.indexOf(p)]).join(","),
      })),
    });
    const claim = await createClaimFromVisit(user, encounter.id, rank);
    await logClaimEvent(claim.id, user.id, "NOTE", { note: "Created with Create new claim — billing-only, no chart visit." });
    await logAudit(user.practiceId, user.id, "CREATE_CLAIM", "Claim", claim.id, `${rank} · billing-only`);
    claimId = claim.id;
  } catch (err) {
    // Nothing is left behind when the claim can't be created (for example no coverage of that rank).
    await prisma.encounter.delete({ where: { id: encounter.id } });
    if (!(err instanceof ClaimError)) throw err;
    problem = err.message;
  }
  if (problem) stop(problem);
  revalidatePath("/billing");
  redirect(`/billing/claims/${claimId}`);
}
