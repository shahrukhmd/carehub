"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { IntakeCase, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { networkStatusForPayer } from "@/lib/credentialing";
import { openIntakeCase } from "@/lib/intake";
import {
  CONSENTS,
  GATEWAY_ROLES,
  OPEN_INTAKE_STAGES,
  authStatusLabel,
  canWorkTeam,
  careStatusLabel,
  dataEntryGaps,
  eligibilityStatusLabel,
  intakeStageLabel,
  referralAppStatusLabel,
  referralSourceTypeLabel,
  referralStatusLabel,
  schedulingGaps,
  teamForStage,
  verificationGaps,
  yesNoUnknownLabel,
  type GatewayTeam,
} from "@/lib/gateway";
import { planSegmentLabel } from "@/lib/format";

type User = Awaited<ReturnType<typeof requireUser>>;

// Validation problems the user can fix; shown as a banner on the case page instead of an error screen.
class GatewayError extends Error {}

function fail(message: string): never {
  throw new GatewayError(message);
}

// Case-page actions land back on the case, clearing any earlier error; queue actions (take) stay put on success.
async function guarded(caseId: string, work: () => Promise<void>, { returnToCase = true } = {}) {
  let message: string | null = null;
  try {
    await work();
  } catch (err) {
    if (!(err instanceof GatewayError)) throw err;
    message = err.message;
  }
  if (message) redirect(`/gateway/${caseId}?error=${encodeURIComponent(message.slice(0, 300))}`);
  if (returnToCase) redirect(`/gateway/${caseId}`);
}

function text(fd: FormData, key: string) {
  const value = String(fd.get(key) ?? "").trim();
  return value || null;
}

function date(fd: FormData, key: string) {
  const value = text(fd, key);
  if (!value) return null;
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) fail(`${key} is not a valid date`);
  return d;
}

function cents(fd: FormData, key: string) {
  const value = text(fd, key);
  if (!value) return null;
  const n = Number(value.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) fail(`${key} must be a dollar amount`);
  return Math.round(n * 100);
}

function int(fd: FormData, key: string, max = 100000) {
  const value = text(fd, key);
  if (!value) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) fail(`${key} must be a whole number`);
  return n;
}

function oneOf(fd: FormData, key: string, labels: Record<string, string>, fallback: string) {
  const value = text(fd, key);
  if (!value) return fallback;
  if (!(value in labels)) fail(`Invalid ${key}`);
  return value;
}

async function loadCase(user: User, caseId: string) {
  const c = await prisma.intakeCase.findFirst({
    where: { id: caseId, practiceId: user.practiceId },
    include: { patient: true },
  });
  if (!c) fail("Case not found");
  return c;
}

function requireTeam(user: User, team: GatewayTeam) {
  if (!canWorkTeam(user.role, team)) fail("Your role cannot work this team's queue");
}

async function log(user: User, c: { id: string; stage: string }, action: string, note?: string | null) {
  await prisma.intakeActivity.create({
    data: { caseId: c.id, userId: user.id, stage: c.stage, action, note: note ?? null },
  });
  await logAudit(user.practiceId, user.id, `intake.${action.toLowerCase()}`, "IntakeCase", c.id, note ?? undefined);
}

function refresh(caseId: string, patientId: string) {
  revalidatePath("/");
  revalidatePath(`/gateway/${caseId}`);
  revalidatePath(`/patients/${patientId}`);
}

// ---- Case lifecycle ----

export async function startIntake(patientId: string) {
  const user = await requireUser(GATEWAY_ROLES);
  requireTeam(user, "DATA_ENTRY");
  const c = await openIntakeCase(user, patientId);
  revalidatePath("/");
  redirect(`/gateway/${c.id}`);
}

export async function takeCase(caseId: string) {
  return guarded(caseId, async () => {
    const user = await requireUser(GATEWAY_ROLES);
    const c = await loadCase(user, caseId);
    const team = teamForStage(c.stage);
    if (team) requireTeam(user, team);
    await prisma.intakeCase.update({ where: { id: c.id }, data: { ownerId: user.id } });
    await log(user, c, "ASSIGNED", `Taken by ${user.name}`);
    refresh(c.id, c.patientId);
  }, { returnToCase: false });
}

export async function addIntakeNote(caseId: string, fd: FormData) {
  return guarded(caseId, async () => {
    const user = await requireUser(GATEWAY_ROLES);
    const c = await loadCase(user, caseId);
    const note = text(fd, "note");
    if (!note) fail("Note is required");
    await log(user, c, "NOTE", note);
    refresh(c.id, c.patientId);
  });
}

// ---- Team 1: referral source & registration ----

export async function saveReferral(caseId: string, fd: FormData) {
  return guarded(caseId, async () => {
    const user = await requireUser(GATEWAY_ROLES);
    requireTeam(user, "DATA_ENTRY");
    const c = await loadCase(user, caseId);

    const referringPhysicianId = text(fd, "referringPhysicianId");
    if (referringPhysicianId) {
      await prisma.renderingProvider.findFirstOrThrow({
        where: { id: referringPhysicianId, practiceId: user.practiceId, isReferring: true },
      });
    }

    await prisma.$transaction([
      prisma.intakeCase.update({
        where: { id: c.id },
        data: {
          referralDate: date(fd, "referralDate"),
          referralSourceType: text(fd, "referralSourceType")
            ? oneOf(fd, "referralSourceType", referralSourceTypeLabel, "OTHER")
            : null,
          referralSourceName: text(fd, "referralSourceName"),
          referralContactName: text(fd, "referralContactName"),
          referralContactPhone: text(fd, "referralContactPhone"),
          referralContactFax: text(fd, "referralContactFax"),
          servicesRequested: text(fd, "servicesRequested"),
          referralNotes: text(fd, "referralNotes"),
          priority: fd.get("priority") === "URGENT" ? "URGENT" : "NORMAL",
        },
      }),
      prisma.patient.update({ where: { id: c.patientId }, data: { referringPhysicianId } }),
    ]);
    await log(user, c, "REFERRAL_SAVED");
    refresh(c.id, c.patientId);
  });
}

// ---- Team 2: eligibility & benefits, authorization, PCC referral ----

export async function saveVerification(caseId: string, fd: FormData) {
  return guarded(caseId, async () => {
    const user = await requireUser(GATEWAY_ROLES);
    requireTeam(user, "VERIFICATION");
    const c = await loadCase(user, caseId);

    const payerId = text(fd, "payerId");
    if (payerId) await prisma.payer.findFirstOrThrow({ where: { id: payerId, practiceId: user.practiceId } });
    const assignedProviderId = text(fd, "assignedProviderId");
    if (assignedProviderId) {
      await prisma.renderingProvider.findFirstOrThrow({
        where: { id: assignedProviderId, practiceId: user.practiceId, isRendering: true },
      });
    }
    const planSegment = text(fd, "planSegment");
    if (planSegment && !(planSegment in planSegmentLabel)) fail("Invalid plan segment");

    const authRequired = oneOf(fd, "authRequired", yesNoUnknownLabel, "UNKNOWN");
    const referralRequired = oneOf(fd, "referralRequired", yesNoUnknownLabel, "UNKNOWN");
    const coinsurancePercent = int(fd, "coinsurancePercent", 100);

    const data: Prisma.IntakeCaseUpdateInput = {
      payer: payerId ? { connect: { id: payerId } } : { disconnect: true },
      planSegment,
      memberId: text(fd, "memberId"),
      eligibilityStatus: oneOf(fd, "eligibilityStatus", eligibilityStatusLabel, "PENDING"),
      coverageEffectiveDate: date(fd, "coverageEffectiveDate"),
      coverageTermDate: date(fd, "coverageTermDate"),
      copayCents: cents(fd, "copay"),
      deductibleCents: cents(fd, "deductible"),
      deductibleMetCents: cents(fd, "deductibleMet"),
      coinsurancePercent,
      outOfPocketRemainingCents: cents(fd, "outOfPocketRemaining"),
      verifiedAt: date(fd, "verifiedAt") ?? (c.verifiedAt ? undefined : new Date()),
      verifiedWith: text(fd, "verifiedWith"),
      verificationReference: text(fd, "verificationReference"),
      benefitsNotes: text(fd, "benefitsNotes"),
      authRequired,
      referralRequired,
      assignedProvider: assignedProviderId ? { connect: { id: assignedProviderId } } : { disconnect: true },
    };
    // Keep the tracking status consistent with the requirement answer.
    if (authRequired !== "YES") data.authStatus = "NOT_REQUIRED";
    else if (c.authStatus === "NOT_REQUIRED") data.authStatus = "TO_SUBMIT";
    if (referralRequired !== "YES") data.referralStatus = "NOT_REQUIRED";
    else if (c.referralStatus === "NOT_REQUIRED") data.referralStatus = "TO_SEND";

    await prisma.intakeCase.update({ where: { id: c.id }, data });
    await log(user, c, "VERIFICATION_SAVED", `Eligibility: ${eligibilityStatusLabel[String(data.eligibilityStatus)]}`);
    refresh(c.id, c.patientId);
  });
}

export async function saveAuthorization(caseId: string, fd: FormData) {
  return guarded(caseId, async () => {
    const user = await requireUser(GATEWAY_ROLES);
    requireTeam(user, "VERIFICATION");
    const c = await loadCase(user, caseId);
    const authStatus = oneOf(fd, "authStatus", authStatusLabel, c.authStatus);
    const authNumber = text(fd, "authNumber");
    if (authStatus === "APPROVED" && !authNumber) fail("Enter the authorization number to mark it approved");

    const decided = ["APPROVED", "DENIED"].includes(authStatus);
    const data: Prisma.IntakeCaseUpdateInput = {
      authStatus,
      authRequired: authStatus === "NOT_REQUIRED" ? c.authRequired : "YES",
      authNumber,
      authSubmittedAt: date(fd, "authSubmittedAt") ?? (authStatus === "SUBMITTED" && !c.authSubmittedAt ? new Date() : undefined),
      authDecisionAt: decided ? (c.authDecisionAt ?? new Date()) : null,
      authStartDate: date(fd, "authStartDate"),
      authEndDate: date(fd, "authEndDate"),
      authVisitsApproved: int(fd, "authVisitsApproved"),
      authNotes: text(fd, "authNotes"),
    };
    // Submitted/pended auths sit in the auth queue; a decision brings the case back to verification.
    if (["SUBMITTED", "PENDED"].includes(authStatus) && ["VERIFICATION", "AUTH_PENDING"].includes(c.stage)) {
      data.stage = "AUTH_PENDING";
    } else if (c.stage === "AUTH_PENDING" && !["SUBMITTED", "PENDED"].includes(authStatus)) {
      data.stage = "VERIFICATION";
    }
    if (data.stage && data.stage !== c.stage) data.stageChangedAt = new Date();

    await prisma.intakeCase.update({ where: { id: c.id }, data });
    await log(
      user,
      c,
      authStatus === "APPROVED" ? "AUTH_APPROVED" : "AUTH_UPDATED",
      `${authStatusLabel[authStatus]}${authNumber ? ` · #${authNumber}` : ""}`
    );
    refresh(c.id, c.patientId);
  });
}

export async function savePccReferral(caseId: string, fd: FormData) {
  return guarded(caseId, async () => {
    const user = await requireUser(GATEWAY_ROLES);
    requireTeam(user, "VERIFICATION");
    const c = await loadCase(user, caseId);
    const referralStatus = oneOf(fd, "referralStatus", referralStatusLabel, c.referralStatus);

    const data: Prisma.IntakeCaseUpdateInput = {
      referralStatus,
      referralRequired: referralStatus === "NOT_REQUIRED" ? c.referralRequired : "YES",
      referralNumber: text(fd, "referralNumber"),
      pccNotes: text(fd, "pccNotes"),
      pccSentAt: referralStatus === "SENT_TO_PCC" && !c.pccSentAt ? new Date() : undefined,
    };
    if (referralStatus === "SENT_TO_PCC" && ["VERIFICATION", "PCC_REFERRAL"].includes(c.stage)) {
      data.stage = "PCC_REFERRAL";
    } else if (c.stage === "PCC_REFERRAL" && referralStatus !== "SENT_TO_PCC") {
      data.stage = "VERIFICATION";
    }
    if (data.stage && data.stage !== c.stage) data.stageChangedAt = new Date();

    await prisma.intakeCase.update({ where: { id: c.id }, data });
    await log(user, c, referralStatus === "SENT_TO_PCC" ? "SENT_TO_PCC" : "REFERRAL_UPDATED", referralStatusLabel[referralStatus]);
    refresh(c.id, c.patientId);
  });
}

// ---- Team 3: consents, PCP referral application, ongoing status ----

export async function saveScheduling(caseId: string, fd: FormData) {
  return guarded(caseId, async () => {
    const user = await requireUser(GATEWAY_ROLES);
    requireTeam(user, "SCHEDULING");
    const c = await loadCase(user, caseId);
    if (!["SCHEDULING", "SCHEDULED"].includes(c.stage)) fail("Case has not been approved for service yet");

    const consents = Object.fromEntries(CONSENTS.map((x) => [x.key, fd.get(x.key) === "on"])) as Record<
      (typeof CONSENTS)[number]["key"],
      boolean
    >;
    const allSigned = Object.values(consents).every(Boolean);
    const careStatus = text(fd, "careStatus") ? oneOf(fd, "careStatus", careStatusLabel, "ACTIVE") : null;

    await prisma.intakeCase.update({
      where: { id: c.id },
      data: {
        ...consents,
        consentsCompletedAt: allSigned ? (c.consentsCompletedAt ?? new Date()) : null,
        pcpName: text(fd, "pcpName"),
        pcpPhone: text(fd, "pcpPhone"),
        pcpFax: text(fd, "pcpFax"),
        referralAppStatus: oneOf(fd, "referralAppStatus", referralAppStatusLabel, "NOT_STARTED"),
        careStatus,
        providerBrief: text(fd, "providerBrief"),
      },
    });
    // The ongoing care status drives whether the patient shows as active in the registry.
    if (careStatus && careStatus !== c.careStatus) {
      const patientStatus = careStatus === "INACTIVE" ? "INACTIVE" : "ACTIVE";
      if (c.patient.status !== patientStatus && ["ACTIVE", "INACTIVE"].includes(c.patient.status)) {
        await prisma.patient.update({ where: { id: c.patientId }, data: { status: patientStatus } });
      }
      await log(user, c, "CARE_STATUS", careStatusLabel[careStatus]);
    } else {
      await log(user, c, "SCHEDULING_SAVED");
    }
    refresh(c.id, c.patientId);
  });
}

// ---- Hand-offs between teams ----

const MOVES: Record<string, { team: GatewayTeam | "ANY"; from: string[]; label: string }> = {
  SEND_TO_VERIFICATION: { team: "DATA_ENTRY", from: ["DATA_ENTRY"], label: "Sent to verification" },
  RETURN_TO_DATA_ENTRY: { team: "VERIFICATION", from: ["VERIFICATION", "AUTH_PENDING", "PCC_REFERRAL"], label: "Returned to data entry" },
  APPROVE_FOR_SERVICE: { team: "VERIFICATION", from: ["VERIFICATION"], label: "Approved for service" },
  RETURN_TO_VERIFICATION: { team: "SCHEDULING", from: ["SCHEDULING"], label: "Returned to verification" },
  MARK_SCHEDULED: { team: "SCHEDULING", from: ["SCHEDULING"], label: "Scheduled" },
  CLOSE: { team: "ANY", from: OPEN_INTAKE_STAGES.concat("SCHEDULED"), label: "Closed" },
  REOPEN: { team: "DATA_ENTRY", from: ["CLOSED"], label: "Reopened" },
};

export async function moveCase(caseId: string, move: string, fd: FormData) {
  return guarded(caseId, async () => {
    const user = await requireUser(GATEWAY_ROLES);
    const spec = MOVES[move];
    if (!spec) fail("Unknown action");
    const c = await loadCase(user, caseId);
    if (!spec.from.includes(c.stage)) fail(`Cannot do that from ${intakeStageLabel[c.stage]}`);
    const team = spec.team === "ANY" ? teamForStage(c.stage) : spec.team;
    if (team) requireTeam(user, team);
    const note = text(fd, "note");

    const data: Partial<IntakeCase> = {};
    let nextStage = c.stage;

    switch (move) {
      case "SEND_TO_VERIFICATION": {
        const gaps = dataEntryGaps(c.patient, c);
        if (gaps.length) fail(`Complete before hand-off: ${gaps.join(", ")}`);
        nextStage = "VERIFICATION";
        data.dataEntryCompletedAt = new Date();
        break;
      }
      case "RETURN_TO_DATA_ENTRY":
      case "RETURN_TO_VERIFICATION":
        if (!note) fail("Say what needs fixing");
        nextStage = move === "RETURN_TO_DATA_ENTRY" ? "DATA_ENTRY" : "VERIFICATION";
        break;
      case "APPROVE_FOR_SERVICE": {
        const gaps = verificationGaps(c);
        if (gaps.length) fail(`Not ready: ${gaps.join(", ")}`);
        // Credentialing link: the rendering provider must be in network with this payer, or the override documented.
        if (c.payerId && c.assignedProviderId && c.eligibilityStatus !== "SELF_PAY") {
          const network = await networkStatusForPayer(user.practiceId, c.payerId, c.planSegment);
          const row = network.find((n) => n.providerId === c.assignedProviderId);
          if (row?.network !== "IN_NETWORK") {
            const override = text(fd, "override");
            if (!override) {
              fail("The assigned provider is not credentialed with this payer. Pick an in-network provider or document an override.");
            }
            data.networkOverrideNote = override;
          }
        }
        nextStage = "SCHEDULING";
        data.approvedForServiceAt = new Date();
        break;
      }
      case "MARK_SCHEDULED": {
        const gaps = schedulingGaps(c);
        if (gaps.length) fail(`Not ready: ${gaps.join(", ")}`);
        const upcoming = await prisma.appointment.count({
          where: { patientId: c.patientId, practiceId: user.practiceId, startsAt: { gte: startOfToday() }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
        });
        if (!upcoming) fail("Book the appointment on the schedule first");
        nextStage = "SCHEDULED";
        data.scheduledAt = new Date();
        data.careStatus = c.careStatus ?? "ACTIVE";
        break;
      }
      case "CLOSE":
        if (!note) fail("A reason is required to close the case");
        nextStage = "CLOSED";
        data.closedReason = note;
        break;
      case "REOPEN":
        nextStage = "DATA_ENTRY";
        data.closedReason = null;
        break;
    }

    await prisma.intakeCase.update({
      where: { id: c.id },
      // The next team picks the case up from their queue.
      data: { ...data, stage: nextStage, stageChangedAt: new Date(), ownerId: nextStage === c.stage ? c.ownerId : null },
    });
    await log(user, c, move, note ? `${spec.label}: ${note}` : spec.label);
    refresh(c.id, c.patientId);
  });
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
