"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { IntakeCase, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { networkStatusForPayer } from "@/lib/credentialing";
import { openIntakeCase } from "@/lib/intake";
import { runEligibilityCheck } from "@/lib/clearinghouse/service";
import { applyBenefits, compareBenefits, loadBenefitContext } from "@/lib/eligibility-apply";
import { sendCaseConsents } from "@/lib/intake-consents";
import { suggestionForCase } from "@/lib/vob";
import {
  CONSENTS,
  GATEWAY_ROLES,
  OPEN_INTAKE_STAGES,
  authStatusLabel,
  canSeeGatewayCase,
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
  verificationStage,
  vobDecisionLabel,
  vobDenyReasonLabel,
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
// Work that returns a sentence has it shown as a confirmation on the case.
async function guarded(caseId: string, work: () => Promise<void | string>, { returnToCase = true } = {}) {
  let message: string | null = null;
  let ok: string | void = undefined;
  try {
    ok = await work();
  } catch (err) {
    if (!(err instanceof GatewayError)) throw err;
    message = err.message;
  }
  if (message) redirect(`/gateway/${caseId}?error=${encodeURIComponent(message.slice(0, 300))}`);
  if (returnToCase) redirect(`/gateway/${caseId}${ok ? `?ok=${encodeURIComponent(ok.slice(0, 400))}` : ""}`);
}

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return host ? `${h.get("x-forwarded-proto") ?? "http"}://${host}` : null;
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
  // Team roles act only on cases in their own team's stages (notes and consents included).
  if (!canSeeGatewayCase(user.role, c.stage)) fail("This case is not in your team's queue");
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

    // "Referring physician / source" is one list: the chosen referring physician or company is both the patient's
    // referring physician and the case's source name. A name typed before the list existed is kept as it was.
    const referringPhysicianId = text(fd, "referringPhysicianId");
    const referrer = referringPhysicianId
      ? await prisma.renderingProvider.findFirstOrThrow({
          where: { id: referringPhysicianId, practiceId: user.practiceId, isReferring: true },
          select: { name: true },
        })
      : null;

    await prisma.$transaction([
      prisma.intakeCase.update({
        where: { id: c.id },
        data: {
          referralDate: date(fd, "referralDate"),
          referralSourceType: text(fd, "referralSourceType")
            ? oneOf(fd, "referralSourceType", referralSourceTypeLabel, "OTHER")
            : null,
          referralSourceName: referrer?.name ?? text(fd, "referralSourceName"),
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

// Details data entry is waiting on from the BD / referral source (updated insurance, previous records...).
export async function requestMissingInfo(caseId: string, fd: FormData) {
  return guarded(caseId, async () => {
    const user = await requireUser(GATEWAY_ROLES);
    requireTeam(user, "DATA_ENTRY");
    const c = await loadCase(user, caseId);
    if (fd.get("received") === "1") {
      await prisma.intakeCase.update({ where: { id: c.id }, data: { infoRequestedAt: null, infoRequestedFrom: null, infoRequestNote: null } });
      await log(user, c, "INFO_RECEIVED", `Received from ${c.infoRequestedFrom ?? "referral source"}: ${c.infoRequestNote ?? ""}`);
    } else {
      const note = text(fd, "note");
      if (!note) fail("Say what is missing");
      const from = text(fd, "from") ?? c.referralSourceName ?? "BD / referral source";
      await prisma.intakeCase.update({ where: { id: c.id }, data: { infoRequestedAt: new Date(), infoRequestedFrom: from, infoRequestNote: note } });
      await log(user, c, "INFO_REQUESTED", `Requested from ${from}: ${note}`);
    }
    refresh(c.id, c.patientId);
  });
}

// Real-time eligibility through the clearinghouse. The payer's answer is kept in full (view / print), fills every
// field that was still empty, and anything that differs from what was entered is listed for correction.
export async function checkCaseEligibility(caseId: string) {
  return guarded(caseId, async () => {
    const user = await requireUser(GATEWAY_ROLES);
    if (!canWorkTeam(user.role, "DATA_ENTRY") && !canWorkTeam(user.role, "VERIFICATION")) fail("Your role cannot check eligibility on a gateway case");
    const c = await loadCase(user, caseId);
    if (c.stage === "CLOSED") fail("The case is closed");
    const insurance = await prisma.insurance.findFirst({
      where: { patientId: c.patientId, active: true },
      orderBy: [{ isPrimary: "desc" }, { rank: "asc" }],
      include: { payer: true },
    });
    if (!insurance) fail("Add the patient's insurance first (Edit demographics & insurance), then check eligibility");
    if (!insurance.memberId || insurance.memberId === "PENDING") fail("Enter the member ID on the patient's insurance before checking eligibility");

    const check = await runEligibilityCheck({ practiceId: user.practiceId, patientId: c.patientId, insuranceId: insurance.id, checkedById: user.id, intakeCaseId: c.id });
    if (!check) fail("The eligibility check could not be run");
    const answered = check.status === "ACTIVE" || check.status === "INACTIVE";
    await prisma.intakeCase.update({
      where: { id: c.id },
      data: {
        // The case follows the patient's primary coverage.
        payerId: insurance.payerId,
        memberId: insurance.memberId,
        eligibilityCheckId: check.id,
        eligibilityCheckedAt: check.checkedAt,
        ...(answered ? { eligibilityStatus: check.status, verifiedAt: check.checkedAt, verifiedWith: "Clearinghouse eligibility (271)" } : {}),
      },
    });
    const filled = await applyBenefits(check.id, user.practiceId, "AUTO");
    const loaded = await loadBenefitContext(check.id, user.practiceId);
    const differ = loaded ? compareBenefits(loaded.ctx, loaded.check).filter((f) => f.state === "MISMATCH").length : 0;
    const summary =
      check.status === "ACTIVE"
        ? `Active coverage${check.planName ? ` · ${check.planName}` : ""} — ${filled.length} field${filled.length === 1 ? "" : "s"} filled from the payer's response${differ ? `, ${differ} ${differ === 1 ? "differs" : "differ"} from what was entered` : ""}`
        : `${insurance.payer.name}: ${check.payerMessage ?? check.status}`;
    await log(user, c, "ELIGIBILITY_CHECKED", summary);
    refresh(c.id, c.patientId);
    if (!answered) fail(`${summary} Run the check again, or send the case to VOB to verify by phone or portal.`);
    return `Eligibility checked: ${summary}.`;
  });
}

// Corrects the fields the user ticked with the payer's values.
export async function applyCaseBenefits(caseId: string, fd: FormData) {
  return guarded(caseId, async () => {
    const user = await requireUser(GATEWAY_ROLES);
    if (!canWorkTeam(user.role, "DATA_ENTRY") && !canWorkTeam(user.role, "VERIFICATION")) fail("Your role cannot update this case");
    const c = await loadCase(user, caseId);
    const keys = fd.getAll("keys").map(String);
    if (!c.eligibilityCheckId) fail("Run the eligibility check first");
    if (keys.length === 0) fail("Tick the fields to update with the payer's values");
    const applied = await applyBenefits(c.eligibilityCheckId, user.practiceId, keys);
    await log(user, c, "BENEFITS_APPLIED", `Updated from the payer's response: ${applied.map((f) => `${f.label} (${f.current || "blank"} → ${f.payer})`).join("; ")}`);
    refresh(c.id, c.patientId);
    return `${applied.length} field${applied.length === 1 ? "" : "s"} updated with the payer's values.`;
  });
}

export async function markSelfPay(caseId: string) {
  return guarded(caseId, async () => {
    const user = await requireUser(GATEWAY_ROLES);
    requireTeam(user, "DATA_ENTRY");
    const c = await loadCase(user, caseId);
    if (c.stage !== "DATA_ENTRY") fail("Only while the case is in data entry");
    await prisma.intakeCase.update({ where: { id: c.id }, data: { eligibilityStatus: "SELF_PAY", payerId: null, memberId: null } });
    await log(user, c, "SELF_PAY", "Patient marked self-pay");
    refresh(c.id, c.patientId);
  });
}

// Data entry's sign-off that the demographics, insurance and benefits were checked against the documents.
export async function markDataVerified(caseId: string, fd: FormData) {
  return guarded(caseId, async () => {
    const user = await requireUser(GATEWAY_ROLES);
    requireTeam(user, "DATA_ENTRY");
    const c = await loadCase(user, caseId);
    if (c.stage !== "DATA_ENTRY") fail("Only while the case is in data entry");
    if (fd.get("undo") === "1") {
      await prisma.intakeCase.update({ where: { id: c.id }, data: { dataVerifiedAt: null, dataVerifiedById: null } });
      await log(user, c, "DATA_UNVERIFIED", "Manual verification reopened");
    } else {
      const gaps = dataEntryGaps(c.patient, c);
      if (gaps.length) fail(`Complete before verifying: ${gaps.join(", ")}`);
      if (fd.get("confirm") !== "on") fail("Tick the box to confirm you checked the details");
      await prisma.intakeCase.update({ where: { id: c.id }, data: { dataVerifiedAt: new Date(), dataVerifiedById: user.id } });
      await log(user, c, "DATA_VERIFIED", `Demographics, insurance and benefits verified by ${user.name}`);
    }
    refresh(c.id, c.patientId);
  });
}

async function consentNote(user: User, c: { id: string }) {
  const sent = await sendCaseConsents({ caseId: c.id, practiceId: user.practiceId, userId: user.id, origin: await origin() });
  if (!sent) return "No consent packet is set up in Patient Connect — consent forms were not sent";
  if (sent.sentTo.length) return `Consent forms ${sent.reused ? "re-sent" : "sent"} for e-signature to ${sent.sentTo.join(", ")}`;
  return sent.channel === "LINK"
    ? "The patient has no mobile number or email — copy the consent link from Patient forms and pass it on"
    : "Consent forms could not be delivered — check the patient's mobile number and email, or copy the link from Patient forms";
}

// (Re)sends the consent forms without moving the case.
export async function sendConsents(caseId: string) {
  return guarded(caseId, async () => {
    const user = await requireUser(GATEWAY_ROLES);
    const c = await loadCase(user, caseId);
    if (c.stage === "CLOSED") fail("The case is closed");
    if (CONSENTS.every((x) => c[x.key])) fail("All consents are already signed");
    const note = await consentNote(user, c);
    await log(user, c, "CONSENTS_SENT", note);
    refresh(c.id, c.patientId);
    return `${note}.`;
  });
}

// Data entry's hand-off. Consent forms go to the patient at the same moment; the signed copy files itself under Scans.
// VOB: the case joins the VOB queue. DIRECT: allowed only when the learned record says this plan is approved without
// an authorization or referral — the patient goes straight to scheduling and the VOB team never sees the case.
export async function handOffCase(caseId: string, route: "VOB" | "DIRECT", fd: FormData) {
  return guarded(caseId, async () => {
    const user = await requireUser(GATEWAY_ROLES);
    requireTeam(user, "DATA_ENTRY");
    const c = await loadCase(user, caseId);
    if (c.stage !== "DATA_ENTRY") fail(`Cannot do that from ${intakeStageLabel[c.stage]}`);
    const gaps = dataEntryGaps(c.patient, c);
    if (gaps.length) fail(`Complete before hand-off: ${gaps.join(", ")}`);
    if (!c.dataVerifiedAt) fail("Mark the data as verified before handing the case off");

    const data: Prisma.IntakeCaseUncheckedUpdateInput = {
      dataEntryCompletedAt: new Date(),
      stageChangedAt: new Date(),
      ownerId: null,
      infoRequestedAt: null,
      infoRequestedFrom: null,
      infoRequestNote: null,
    };
    let label = "Sent to the VOB team";
    if (route === "DIRECT") {
      const payer = c.payerId ? await prisma.payer.findFirst({ where: { id: c.payerId }, select: { name: true } }) : null;
      const network = c.payerId ? await networkStatusForPayer(user.practiceId, c.payerId, c.planSegment) : [];
      const suggestion = await suggestionForCase(user.practiceId, { ...c, payerName: payer?.name }, network);
      const scope = suggestion.kind === "TAKE_DIRECT" ? suggestion.scope : null;
      if (!scope) fail("This patient can't be taken directly — send the case to the VOB team");
      const providerId = text(fd, "assignedProviderId") ?? c.assignedProviderId;
      if (!providerId) fail("Choose the rendering provider who will see the patient");
      const provider = await prisma.renderingProvider.findFirst({ where: { id: providerId, practiceId: user.practiceId, isRendering: true, status: "ACTIVE" } });
      if (!provider) fail("Choose an active rendering provider");
      const row = network.find((n) => n.providerId === provider.id);
      if (c.payerId && row?.network !== "IN_NETWORK") fail(`${provider.name} is not credentialed with this payer — pick an in-network provider or send the case to VOB`);

      Object.assign(data, {
        stage: "SCHEDULING",
        assignedProviderId: provider.id,
        authRequired: "NO",
        authStatus: "NOT_REQUIRED",
        referralRequired: "NO",
        referralStatus: "NOT_REQUIRED",
        vobDecision: scope,
        vobDecisionAt: new Date(),
        vobDecisionById: user.id,
        vobDecisionSource: "DIRECT",
        vobDecisionNote: suggestion.reasons[0] ?? suggestion.headline,
        approvedForServiceAt: new Date(),
        ...(scope === "APPROVED_LIMITED" ? { careStatus: "LIMITED" } : {}),
      });
      await prisma.vobDecision.create({
        data: {
          practiceId: user.practiceId,
          caseId: c.id,
          payerId: c.payerId,
          planSegment: c.planSegment,
          providerId: provider.id,
          network: row?.network ?? null,
          decision: scope,
          note: suggestion.headline,
          source: "DIRECT",
          decidedById: user.id,
        },
      });
      label = `Taken directly to scheduling (${vobDecisionLabel[scope]}) — VOB review skipped: ${suggestion.reasons[0] ?? suggestion.headline}`;
    } else {
      data.stage = "VERIFICATION";
    }

    const consents = fd.get("sendConsents") === "on" && !CONSENTS.every((x) => c[x.key]) ? await consentNote(user, c) : null;
    await prisma.intakeCase.update({ where: { id: c.id }, data });
    const note = text(fd, "note");
    await log(user, c, route === "DIRECT" ? "TAKEN_DIRECT" : "SEND_TO_VERIFICATION", [label, consents, note].filter(Boolean).join(" · "));
    refresh(c.id, c.patientId);
    return [route === "DIRECT" ? "Patient taken directly — the case is now with scheduling" : "Case shared with the VOB team", consents].filter(Boolean).join(". ") + ".";
  });
}

// ---- Team 2 (VOB): eligibility & benefits, authorization, PCC referral ----

const VOB_STAGES = ["VERIFICATION", "AUTH_PENDING", "PCC_REFERRAL"];

// Moves a case between the VOB queue and the auth / referral waiting queues to match what was just saved.
function restage(c: IntakeCase, data: Prisma.IntakeCaseUpdateInput) {
  if (!VOB_STAGES.includes(c.stage)) return;
  const pick = (key: "authRequired" | "authStatus" | "referralRequired" | "referralStatus") => (typeof data[key] === "string" ? (data[key] as string) : c[key]);
  const next = verificationStage({
    authRequired: pick("authRequired"),
    authStatus: pick("authStatus"),
    referralRequired: pick("referralRequired"),
    referralStatus: pick("referralStatus"),
    vobDecision: c.vobDecision,
  });
  if (next !== c.stage) {
    data.stage = next;
    data.stageChangedAt = new Date();
  }
}

export async function saveVerification(caseId: string, fd: FormData) {
  return guarded(caseId, async () => {
    const user = await requireUser(GATEWAY_ROLES);
    requireTeam(user, "VERIFICATION");
    const c = await loadCase(user, caseId);

    const payerId = text(fd, "payerId");
    const payer = payerId ? await prisma.payer.findFirstOrThrow({ where: { id: payerId, practiceId: user.practiceId } }) : null;
    const assignedProviderId = text(fd, "assignedProviderId");
    if (assignedProviderId) {
      await prisma.renderingProvider.findFirstOrThrow({
        where: { id: assignedProviderId, practiceId: user.practiceId, isRendering: true },
      });
    }
    // A payer name stands for one line of business; when the segment is left open it follows the payer.
    const planSegment = text(fd, "planSegment") ?? payer?.planSegment ?? null;
    if (planSegment && !(planSegment in planSegmentLabel)) fail("Invalid plan segment");
    // The plan name VOB confirmed is kept on the patient's coverage with this payer, and reaches credentialing's
    // plan list from there.
    const planName = text(fd, "planName")?.slice(0, 160) ?? null;
    if (payerId && fd.has("planName")) {
      await prisma.insurance.updateMany({ where: { patientId: c.patientId, payerId, active: true }, data: { planName } });
    }

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
    restage(c, data);

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
    // Auths being worked sit in the auth queue; the payer's decision brings the case back to VOB.
    restage(c, data);

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
    restage(c, data);

    await prisma.intakeCase.update({ where: { id: c.id }, data });
    await log(user, c, referralStatus === "SENT_TO_PCC" ? "SENT_TO_PCC" : "REFERRAL_UPDATED", referralStatusLabel[referralStatus]);
    refresh(c.id, c.patientId);
  });
}

// The VOB decision: approved for all services, approved for E&M and debridements only, denied, or on hold until an
// authorization / referral comes back. Each decision is kept so the gateway learns what this payer usually ends in.
export async function decideVob(caseId: string, fd: FormData) {
  return guarded(caseId, async () => {
    const user = await requireUser(GATEWAY_ROLES);
    requireTeam(user, "VERIFICATION");
    const c = await loadCase(user, caseId);
    if (!VOB_STAGES.includes(c.stage)) fail(`Cannot do that from ${intakeStageLabel[c.stage]}`);
    const decision = text(fd, "decision") ?? "";
    if (!(decision in vobDecisionLabel)) fail("Choose the VOB decision");
    const note = text(fd, "note");
    const selfPay = c.eligibilityStatus === "SELF_PAY";

    const network = c.payerId ? await networkStatusForPayer(user.practiceId, c.payerId, c.planSegment) : [];
    const row = network.find((n) => n.providerId === c.assignedProviderId);
    const data: Prisma.IntakeCaseUncheckedUpdateInput = {
      vobDecision: decision,
      vobDecisionAt: new Date(),
      vobDecisionById: user.id,
      vobDecisionNote: note,
      vobDecisionSource: "VOB",
      vobDenyReason: null,
    };
    let authRequired = c.authRequired === "YES";
    let referralRequired = c.referralRequired === "YES";
    let denyReason: string | null = null;
    let nextStage = c.stage;

    if (decision === "APPROVED_ALL" || decision === "APPROVED_LIMITED") {
      if (!["ACTIVE", "SELF_PAY"].includes(c.eligibilityStatus)) fail("Eligibility is not active — save the verified eligibility first, or deny the patient");
      if (!c.assignedProviderId) fail("Choose the rendering provider in the VOB section and save before approving");
      if (referralRequired && c.referralStatus !== "RECEIVED") fail("The referral has not been received — put the case on hold until it is");
      // E&M and debridements can start while an authorization for other services is still out.
      if (decision === "APPROVED_ALL" && authRequired && c.authStatus !== "APPROVED") {
        fail("The authorization is not approved — put the case on hold, or approve for E&M and debridements only");
      }
      // Credentialing link: the rendering provider must be in network with this payer, or the override documented.
      if (c.payerId && !selfPay && row?.network !== "IN_NETWORK") {
        const override = text(fd, "override");
        if (!override) fail("The assigned provider is not credentialed with this payer. Pick an in-network provider, document an override, or deny the patient.");
        data.networkOverrideNote = override;
      }
      if (c.authRequired === "UNKNOWN") Object.assign(data, { authRequired: "NO", authStatus: "NOT_REQUIRED" });
      if (c.referralRequired === "UNKNOWN") Object.assign(data, { referralRequired: "NO", referralStatus: "NOT_REQUIRED" });
      data.approvedForServiceAt = new Date();
      if (decision === "APPROVED_LIMITED") data.careStatus = "LIMITED";
      else if (c.careStatus === "LIMITED") data.careStatus = null;
      nextStage = "SCHEDULING";
    } else if (decision === "DENIED") {
      denyReason = text(fd, "denyReason");
      if (!denyReason || !(denyReason in vobDenyReasonLabel)) fail("Choose why the patient is denied");
      if (denyReason === "OTHER" && !note) fail("Add a note explaining the denial");
      data.vobDenyReason = denyReason;
      data.closedReason = `VOB denied: ${vobDenyReasonLabel[denyReason]}${note ? ` — ${note}` : ""}`;
      nextStage = "CLOSED";
    } else {
      const holdAuth = fd.get("holdAuth") === "on";
      const holdReferral = fd.get("holdReferral") === "on";
      if (!holdAuth && !holdReferral) fail("Tick what the case is waiting for: authorization, referral or both");
      if (holdAuth) {
        authRequired = true;
        Object.assign(data, { authRequired: "YES", authStatus: ["NOT_REQUIRED", "DENIED"].includes(c.authStatus) ? "TO_SUBMIT" : c.authStatus });
      }
      if (holdReferral) {
        referralRequired = true;
        Object.assign(data, { referralRequired: "YES", referralStatus: c.referralStatus === "NOT_REQUIRED" ? "TO_SEND" : c.referralStatus });
      }
      nextStage = verificationStage({
        authRequired: String(data.authRequired ?? c.authRequired),
        authStatus: String(data.authStatus ?? c.authStatus),
        referralRequired: String(data.referralRequired ?? c.referralRequired),
        referralStatus: String(data.referralStatus ?? c.referralStatus),
        vobDecision: "HOLD",
      });
      if (nextStage === "VERIFICATION") fail("The authorization and referral are already complete — approve or deny the patient instead");
    }

    if (nextStage !== c.stage) Object.assign(data, { stage: nextStage, stageChangedAt: new Date(), ownerId: decision === "HOLD" ? c.ownerId : null });
    const check = c.eligibilityCheckId ? await prisma.eligibilityCheck.findUnique({ where: { id: c.eligibilityCheckId }, select: { planName: true } }) : null;
    await prisma.$transaction([
      prisma.intakeCase.update({ where: { id: c.id }, data }),
      prisma.vobDecision.create({
        data: {
          practiceId: user.practiceId,
          caseId: c.id,
          payerId: c.payerId,
          planSegment: c.planSegment,
          planName: check?.planName ?? null,
          providerId: c.assignedProviderId,
          network: row?.network ?? null,
          decision,
          authRequired,
          referralRequired,
          denyReason,
          note,
          source: "VOB",
          decidedById: user.id,
        },
      }),
    ]);
    const detail =
      decision === "DENIED"
        ? vobDenyReasonLabel[denyReason!]
        : decision === "HOLD"
          ? [authRequired ? "authorization" : "", referralRequired ? "referral" : ""].filter(Boolean).join(" and ")
          : null;
    await log(user, c, `VOB_${decision}`, [`VOB decision: ${vobDecisionLabel[decision]}`, detail, note].filter(Boolean).join(" · "));
    refresh(c.id, c.patientId);
    return decision === "HOLD"
      ? `On hold — waiting for the ${detail}. The case comes back to VOB when it is decided.`
      : decision === "DENIED"
        ? "Patient denied and the case closed."
        : `${vobDecisionLabel[decision]} — the case is now with scheduling.`;
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
  RETURN_TO_DATA_ENTRY: { team: "VERIFICATION", from: ["VERIFICATION", "AUTH_PENDING", "PCC_REFERRAL"], label: "Returned to data entry" },
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
      case "RETURN_TO_DATA_ENTRY":
      case "RETURN_TO_VERIFICATION":
        if (!note) fail("Say what needs fixing");
        nextStage = move === "RETURN_TO_DATA_ENTRY" ? "DATA_ENTRY" : "VERIFICATION";
        // The receiving team signs off again once it is fixed.
        if (move === "RETURN_TO_DATA_ENTRY") Object.assign(data, { dataVerifiedAt: null, dataVerifiedById: null });
        Object.assign(data, { vobDecision: null, vobDecisionAt: null, vobDecisionById: null, vobDecisionNote: null, vobDecisionSource: null, approvedForServiceAt: null });
        break;
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
        Object.assign(data, { dataVerifiedAt: null, dataVerifiedById: null, vobDecision: null, vobDecisionAt: null, vobDecisionById: null, vobDecisionNote: null, vobDecisionSource: null, vobDenyReason: null, approvedForServiceAt: null });
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
