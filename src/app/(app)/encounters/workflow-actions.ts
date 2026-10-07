"use server";

import { rolesFor } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { selfReviewBlock } from "@/lib/separation";
import { recordFlow } from "@/lib/flow";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { parsePointerIds } from "@/lib/superbill";
import { refreshVisitBillingStatus } from "@/lib/claims";
import { workflowFinalizeGaps } from "@/lib/chart-setup";
import {
  HOLD_STATUSES,
  PROVIDER_ATTESTATION,
  SUPERVISOR_ATTESTATION,
  canEditClinical,
  builtinDoneMap,
  canHold,
  chartChecklist,
  gapsFor,
  isCdsRole,
  visitStatusLabel,
  CDS_ROLES,
  CDS_STAGES,
  CODING_ROLES,
  isCoderRole,
} from "@/lib/visit-workflow";
import { placeOfServiceLabel } from "@/lib/superbill";

type User = Awaited<ReturnType<typeof requireUser>>;

// Problems the user can fix are shown as a banner on the chart rather than an error screen.
class WorkflowError extends Error {}

function fail(message: string): never {
  throw new WorkflowError(message);
}

async function guarded(encounterId: string, work: () => Promise<void>) {
  let message: string | null = null;
  try {
    await work();
  } catch (err) {
    if (!(err instanceof WorkflowError)) throw err;
    message = err.message;
  }
  redirect(`/encounters/${encounterId}${message ? `?error=${encodeURIComponent(message.slice(0, 300))}` : ""}`);
}

function text(fd: FormData, key: string) {
  const value = String(fd.get(key) ?? "").trim();
  return value || null;
}

async function loadEncounter(user: User, id: string) {
  const encounter = await prisma.encounter.findFirst({
    where: { id, practiceId: user.practiceId },
    include: {
      vitals: true,
      diagnoses: true,
      charges: true,
      signatures: true,
      supervisingProvider: true,
      woundAssessments: { select: { woundId: true } },
      appointment: { select: { visitType: true } },
      patient: {
        include: {
          wounds: { where: { status: { not: "HEALED" } }, select: { id: true } },
          _count: { select: { problems: true } },
        },
      },
    },
  });
  if (!encounter) fail("Encounter not found");
  return encounter;
}

type Loaded = Awaited<ReturnType<typeof loadEncounter>>;

function requiredSignatureRoles(e: { supervisingProviderId: string | null }) {
  return e.supervisingProviderId ? ["PROVIDER", "SUPERVISOR"] : ["PROVIDER"];
}

function checklistFor(e: Loaded) {
  const assessed = new Set(e.woundAssessments.map((w) => w.woundId));
  return chartChecklist({
    chiefComplaint: e.chiefComplaint,
    subjective: e.subjective,
    objective: e.objective,
    assessment: e.assessment,
    plan: e.plan,
    vitals: e.vitals,
    woundCount: e.patient.wounds.length,
    woundAssessedCount: e.patient.wounds.filter((w) => assessed.has(w.id)).length,
    diagnosisCount: e.diagnoses.length,
    chargeCount: e.charges.length,
    chargesMissingPointers: e.charges.filter((c) => parsePointerIds(c.diagnosisPointers).length === 0).length,
    billingProviderId: e.billingProviderId,
    mdmLevel: e.mdmLevel,
    signatureCount: e.signatures.length,
    signaturesRequired: e.supervisingProviderId ? 2 : 1,
  });
}

async function transition(
  user: User,
  e: { id: string; status: string; appointmentId: string | null },
  toStatus: string,
  note: string | null,
  data: Prisma.EncounterUpdateInput = {}
) {
  await prisma.encounter.update({
    where: { id: e.id },
    data: { ...data, status: toStatus, statusChangedAt: new Date() },
  });
  await prisma.encounterEvent.create({
    data: { encounterId: e.id, userId: user.id, fromStatus: e.status, toStatus, note },
  });
  await logAudit(user.practiceId, user.id, `visit.${toStatus.toLowerCase()}`, "Encounter", e.id, note ?? undefined);
  revalidatePath("/encounters");
  revalidatePath("/billing");
  revalidatePath("/schedule");
}

function requireStatus(e: { status: string }, allowed: string[]) {
  if (!allowed.includes(e.status)) fail(`Not available while the visit is "${visitStatusLabel[e.status] ?? e.status}".`);
}

// ---- Provider & clinical team ----

export async function updateCareTeam(encounterId: string, fd: FormData) {
  return guarded(encounterId, async () => {
    const user = await requireUser(rolesFor("chart.edit"));
    const e = await loadEncounter(user, encounterId);
    if (!canEditClinical(e.status, user)) fail("The care team can only be changed while the visit is being documented.");

    const clinicalStaffId = text(fd, "clinicalStaffId");
    if (clinicalStaffId) {
      const member = await prisma.membership.findFirst({ where: { userId: clinicalStaffId, practiceId: user.practiceId } });
      if (!member) fail("Clinical staff member is not part of this practice.");
    }
    const supervisingProviderId = text(fd, "supervisingProviderId");
    if (supervisingProviderId) {
      const sup = await prisma.renderingProvider.findFirst({
        where: { id: supervisingProviderId, practiceId: user.practiceId, isSupervising: true },
      });
      if (!sup) fail("Pick a supervising physician from the provider directory.");
    }
    const placeOfService = text(fd, "placeOfService");
    if (placeOfService && !(placeOfService in placeOfServiceLabel)) fail("Invalid site of service.");

    await prisma.encounter.update({
      where: { id: e.id },
      data: { clinicalStaffId, supervisingProviderId, placeOfService },
    });
  });
}

export async function submitToCds(encounterId: string) {
  return guarded(encounterId, async () => {
    const user = await requireUser(rolesFor("chart.edit"));
    const e = await loadEncounter(user, encounterId);
    requireStatus(e, ["IN_PROGRESS", "CDS_QUERY"]);
    // The chart workflow decides which documents must be complete (Finalize visit admin).
    const gaps = await workflowFinalizeGaps(
      user.practiceId,
      e,
      builtinDoneMap(checklistFor(e), e.patient._count.problems),
      e.patient.wounds.map((w) => w.id)
    );
    if (gaps.length) fail(`Complete before finalizing the visit: ${gaps.join(", ")}`);

    await transition(user, e, "READY_FOR_CDS", e.status === "CDS_QUERY" ? "Query answered, resubmitted to CDS" : "Documentation complete", {
      submittedToCdsAt: new Date(),
      cdsQueryNote: null,
    });
    // The visit itself is done once the chart leaves the provider.
    if (e.appointmentId) {
      await prisma.appointment.update({ where: { id: e.appointmentId }, data: { status: "COMPLETED" } });
      if (!(await prisma.appointmentEvent.findFirst({ where: { appointmentId: e.appointmentId, status: "COMPLETED" } }))) await recordFlow(e.appointmentId, "COMPLETED", user.id);
    }
  });
}

// ---- CDS ----

// CDS can send the chart back to the provider from its own review, or when a coding query needs the provider.
export async function queryProvider(encounterId: string, fd: FormData) {
  return guarded(encounterId, async () => {
    const user = await requireUser(CDS_ROLES);
    const e = await loadEncounter(user, encounterId);
    requireStatus(e, CDS_STAGES);
    const self = await selfReviewBlock(e.id, user.id, "cds");
    if (self) fail(self);
    const note = text(fd, "note");
    if (!note) fail("Tell the provider what's missing or needs clarification.");
    await transition(user, e, "CDS_QUERY", note, { cdsQueryNote: note });
  });
}

// CDS has reviewed the documentation (or dealt with the coding team's query): the chart goes to coding.
export async function sendToCoding(encounterId: string, fd: FormData) {
  return guarded(encounterId, async () => {
    const user = await requireUser(CDS_ROLES);
    const e = await loadEncounter(user, encounterId);
    requireStatus(e, CDS_STAGES);
    const self = await selfReviewBlock(e.id, user.id, "cds");
    if (self) fail(self);
    const answering = e.status === "CODING_QUERY";
    const note = text(fd, "note");
    if (answering && !note) fail("Say what was corrected or clarified for the coding team.");
    await transition(user, e, "READY_FOR_CODING", answering ? `CDS response to coding: ${note}` : `Documentation reviewed by CDS, sent to coding${note ? `: ${note}` : ""}`, {
      codingQueryNote: null,
    });
  });
}

// ---- Coding ----

// The coding team asks CDS to check or correct the documentation before the superbill can be finished.
export async function queryCds(encounterId: string, fd: FormData) {
  return guarded(encounterId, async () => {
    const user = await requireUser(CODING_ROLES);
    const e = await loadEncounter(user, encounterId);
    requireStatus(e, ["READY_FOR_CODING"]);
    const self = await selfReviewBlock(e.id, user.id, "coding");
    if (self) fail(self);
    const note = text(fd, "note");
    if (!note) fail("Tell CDS what needs checking or correcting.");
    await transition(user, e, "CODING_QUERY", `Coding query to CDS: ${note}`, { codingQueryNote: note });
  });
}

export async function sendForSignature(encounterId: string) {
  return guarded(encounterId, async () => {
    const user = await requireUser(CODING_ROLES);
    const e = await loadEncounter(user, encounterId);
    requireStatus(e, ["READY_FOR_CODING"]);
    const self = await selfReviewBlock(e.id, user.id, "coding");
    if (self) fail(self);
    const gaps = gapsFor(checklistFor(e), "cds");
    if (gaps.length) fail(`Finish the superbill first: ${gaps.join(", ")}`);
    if (e.charges.some((c) => parsePointerIds(c.diagnosisPointers).length === 0)) fail("Every charge needs a diagnosis pointer.");

    await transition(user, e, "READY_FOR_SIGNATURE", "Superbill coded, sent to provider for signature", {
      codedBy: { connect: { id: user.id } },
      codedAt: new Date(),
    });
  });
}

// ---- Provider signature ----

export async function returnToCds(encounterId: string, fd: FormData) {
  return guarded(encounterId, async () => {
    const user = await requireUser(rolesFor("chart.edit"));
    const e = await loadEncounter(user, encounterId);
    requireStatus(e, ["READY_FOR_SIGNATURE"]);
    if (!(await isSigner(user, e))) fail("Only the visit's provider or supervising physician can return it.");
    const note = text(fd, "note");
    if (!note) fail("Say what should change on the superbill.");
    // The superbill may change, so earlier signatures no longer apply.
    await prisma.encounterSignature.deleteMany({ where: { encounterId: e.id } });
    await transition(user, e, "READY_FOR_CODING", `Returned to coding: ${note}`);
  });
}

async function isSigner(user: User, e: Loaded) {
  if (e.providerId === user.id) return true;
  return Boolean(e.supervisingProvider && e.supervisingProvider.userId === user.id);
}

export async function signEncounter(encounterId: string, fd: FormData) {
  return guarded(encounterId, async () => {
    const user = await requireUser(rolesFor("chart.sign"));
    const e = await loadEncounter(user, encounterId);
    requireStatus(e, ["READY_FOR_SIGNATURE"]);

    const signed = new Set(e.signatures.map((s) => s.role));
    let role: "PROVIDER" | "SUPERVISOR" | null = null;
    if (e.providerId === user.id && !signed.has("PROVIDER")) role = "PROVIDER";
    else if (e.supervisingProvider?.userId === user.id && !signed.has("SUPERVISOR")) role = "SUPERVISOR";
    if (!role) fail("There's no signature waiting for you on this visit.");

    if (fd.get("attest") !== "on") fail("Tick the attestation to sign.");
    const signedName = text(fd, "signedName");
    if (!signedName) fail("Type your name to sign.");

    // The signature on file is copied onto the record so later changes to it don't alter signed notes.
    const onFile = await prisma.user.findUnique({ where: { id: user.id }, select: { signatureImage: true } });
    await prisma.encounterSignature.create({
      data: {
        encounterId: e.id,
        userId: user.id,
        role,
        signedName,
        signatureImage: onFile?.signatureImage ?? null,
        attestation: role === "PROVIDER" ? PROVIDER_ATTESTATION : SUPERVISOR_ATTESTATION,
      },
    });
    await prisma.encounterEvent.create({
      data: { encounterId: e.id, userId: user.id, fromStatus: e.status, toStatus: e.status, note: `${role === "PROVIDER" ? "Provider" : "Supervising physician"} signed` },
    });
    await logAudit(user.practiceId, user.id, "visit.signed", "Encounter", e.id, role);

    const required = requiredSignatureRoles(e);
    signed.add(role);
    if (required.every((r) => signed.has(r))) {
      await transition(user, e, "READY_FOR_BILLING", "All signatures complete", { finalizedAt: new Date() });
      await refreshVisitBillingStatus(e.id);
    }
  });
}

// ---- Holds (CDS / billing) ----

export async function placeHold(encounterId: string, fd: FormData) {
  return guarded(encounterId, async () => {
    const user = await requireUser(rolesFor("chart.hold"));
    if (!canHold(user)) fail("Your role can't place holds.");
    const e = await loadEncounter(user, encounterId);
    if (HOLD_STATUSES.includes(e.status)) fail("Release the current hold first.");
    if (e.status === "BILLED") fail("This visit has already been billed.");
    const kind = text(fd, "kind");
    if (!kind || !HOLD_STATUSES.includes(kind)) fail("Pick a hold type.");
    const reason = text(fd, "reason");
    if (!reason) fail("A reason is required for a hold.");
    await transition(user, e, kind, reason, { holdReason: reason, holdFromStatus: e.status });
  });
}

export async function releaseHold(encounterId: string) {
  return guarded(encounterId, async () => {
    const user = await requireUser(rolesFor("chart.hold"));
    const e = await loadEncounter(user, encounterId);
    requireStatus(e, HOLD_STATUSES);
    const back = e.holdFromStatus ?? (isCoderRole(user) && user.role !== "ADMIN" ? "READY_FOR_CODING" : isCdsRole(user) && user.role !== "ADMIN" ? "READY_FOR_CDS" : "READY_FOR_BILLING");
    await transition(user, e, back, "Hold released", { holdReason: null, holdFromStatus: null });
  });
}

// ---- Scheduler / front desk: visit status before the chart is started ----

const PRE_VISIT_STATUSES = ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_HOSPITAL", "NO_SHOW", "CANCELLED"];

export async function setAppointmentStatus(appointmentId: string, fd: FormData) {
  const user = await requireUser(rolesFor("schedule.view"));
  const status = text(fd, "status");
  if (!status || !PRE_VISIT_STATUSES.includes(status)) throw new Error("Invalid visit status");
  const appt = await prisma.appointment.findFirst({
    where: { id: appointmentId, practiceId: user.practiceId },
    include: { encounter: { select: { id: true } } },
  });
  if (!appt) throw new Error("Appointment not found");
  if (appt.encounter) throw new Error("The chart has been started; its status now follows the visit workflow");
  await prisma.appointment.update({ where: { id: appt.id }, data: { status } });
  if (appt.status !== status) await recordFlow(appt.id, status, user.id);
  await logAudit(user.practiceId, user.id, "appointment.status", "Appointment", appt.id, status);
  revalidatePath("/encounters");
  revalidatePath("/schedule");
}
