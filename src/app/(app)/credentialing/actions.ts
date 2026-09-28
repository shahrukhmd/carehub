"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  ACTIVE_ENROLLMENT_STATUSES,
  OPEN_ENROLLMENT_STATUSES,
  activityChannelLabel,
  connectionStatusLabel,
  credentialingPriorityLabel,
  credentialingStatusLabel,
  enrollmentStatusLabel,
  planSegmentLabel,
  providerDocumentTypeLabel,
  verificationResultLabel,
  verificationSourceLabel,
} from "@/lib/format";
import {
  ensureEnrollmentsForGroupPayer,
  ensureEnrollmentsForProvider,
  ensureRenderingProviderForUser,
  lookupNppes,
} from "@/lib/credentialing";
import { getUploadedFile, saveUpload } from "@/lib/storage";
import { CREDENTIALING_ROLES, credentialingPracticeIds } from "@/lib/scope";

function required(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function optional(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

function optionalDate(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value ? new Date(`${value}T12:00:00`) : null;
}

function oneOf(formData: FormData, key: string, allowed: Record<string, string>, fallback: string) {
  const value = String(formData.get(key) ?? "");
  return value in allowed ? value : fallback;
}

function refresh(...paths: string[]) {
  revalidatePath("/credentialing", "layout");
  for (const p of paths) revalidatePath(p);
}

async function loadEnrollment(enrollmentId: string, practiceIds: string[]) {
  return prisma.providerEnrollment.findFirstOrThrow({
    where: { id: enrollmentId, renderingProvider: { practiceId: { in: practiceIds } } },
    include: { renderingProvider: { select: { practiceId: true } } },
  });
}

async function loadProvider(providerId: string, practiceIds: string[]) {
  return prisma.renderingProvider.findFirstOrThrow({ where: { id: providerId, practiceId: { in: practiceIds } } });
}

async function loadLine(lineId: string, practiceIds: string[]) {
  return prisma.groupPayerEnrollment.findFirstOrThrow({
    where: { id: lineId, billingProvider: { practiceId: { in: practiceIds } } },
    include: { payer: true },
  });
}

// Assignees must work in the practice that owns the record.
async function checkAssignee(assignedToId: string | null, practiceId: string) {
  if (!assignedToId) return;
  await prisma.membership.findFirstOrThrow({ where: { userId: assignedToId, practiceId } });
}

// ---------- Group (billing entity) x payer lines ----------

export async function createGroupPayerEnrollment(billingProviderId: string, formData: FormData) {
  const user = await requireUser(CREDENTIALING_ROLES);
  const billingProvider = await prisma.billingProvider.findFirstOrThrow({
    where: { id: billingProviderId, practiceId: { in: credentialingPracticeIds(user) } },
  });
  const payerId = required(formData, "payerId");
  // Payers are per practice; a line may only use a payer from the group's own practice.
  await prisma.payer.findFirstOrThrow({ where: { id: payerId, practiceId: billingProvider.practiceId } });
  const planSegment = oneOf(formData, "planSegment", planSegmentLabel, "COMMERCIAL");

  const existing = await prisma.groupPayerEnrollment.findUnique({
    where: { billingProviderId_payerId_planSegment: { billingProviderId: billingProvider.id, payerId, planSegment } },
  });
  if (existing) {
    await ensureEnrollmentsForGroupPayer(existing.id);
    refresh();
    return;
  }

  const line = await prisma.groupPayerEnrollment.create({
    data: {
      billingProviderId: billingProvider.id,
      payerId,
      planSegment,
      planType: optional(formData, "planType"),
      groupStatus: oneOf(formData, "groupStatus", credentialingStatusLabel, "NOT_STARTED"),
      payerGroupId: optional(formData, "payerGroupId"),
    },
  });
  const added = await ensureEnrollmentsForGroupPayer(line.id);

  await logAudit(user.practiceId, user.id, "CREATE_GROUP_PAYER_ENROLLMENT", "GroupPayerEnrollment", line.id, `${billingProvider.name}; ${added} provider row(s) opened`);
  refresh();
}

export async function updateGroupPayerEnrollment(lineId: string, formData: FormData) {
  const user = await requireUser(CREDENTIALING_ROLES);
  await loadLine(lineId, credentialingPracticeIds(user));

  await prisma.groupPayerEnrollment.update({
    where: { id: lineId },
    data: {
      planType: optional(formData, "planType"),
      groupStatus: oneOf(formData, "groupStatus", credentialingStatusLabel, "NOT_STARTED"),
      ediStatus: oneOf(formData, "ediStatus", connectionStatusLabel, "NOT_STARTED"),
      eftStatus: oneOf(formData, "eftStatus", connectionStatusLabel, "NOT_STARTED"),
      effectiveDate: optionalDate(formData, "effectiveDate"),
      payerGroupId: optional(formData, "payerGroupId"),
      notes: optional(formData, "notes"),
    },
  });

  await logAudit(user.practiceId, user.id, "UPDATE_GROUP_PAYER_ENROLLMENT", "GroupPayerEnrollment", lineId);
  refresh();
}

// Payer-wide events (e.g. a group link approving every provider at once).
export async function bulkSetLineStatus(lineId: string, formData: FormData) {
  const user = await requireUser(CREDENTIALING_ROLES);
  const line = await loadLine(lineId, credentialingPracticeIds(user));
  const status = oneOf(formData, "status", enrollmentStatusLabel, "");
  if (!status) throw new Error("Choose a status");
  const effectiveDate = optionalDate(formData, "effectiveDate");

  const rows = await prisma.providerEnrollment.findMany({
    where: { groupPayerEnrollmentId: lineId, status: { notIn: ["TERMED", "NOT_APPLICABLE", status] } },
  });
  const now = new Date();
  for (const row of rows) {
    await prisma.providerEnrollment.update({
      where: { id: row.id },
      data: {
        status,
        statusChangedAt: now,
        lastActivityAt: now,
        effectiveDate: status === "APPROVED" && effectiveDate ? effectiveDate : row.effectiveDate,
        activities: {
          create: {
            channel: "INTERNAL",
            note: `Bulk update for ${line.payer.name}: ${enrollmentStatusLabel[row.status]} → ${enrollmentStatusLabel[status]}`,
            loggedById: user.id,
          },
        },
      },
    });
  }

  await logAudit(user.practiceId, user.id, "BULK_SET_ENROLLMENT_STATUS", "GroupPayerEnrollment", lineId, `${rows.length} row(s) → ${status}`);
  refresh();
}

// ---------- Provider x payer enrollments ----------

export async function updateProviderEnrollment(enrollmentId: string, formData: FormData) {
  const user = await requireUser(CREDENTIALING_ROLES);
  const current = await loadEnrollment(enrollmentId, credentialingPracticeIds(user));
  const practiceId = current.renderingProvider.practiceId;

  const status = oneOf(formData, "status", enrollmentStatusLabel, current.status);
  const assignedToId = optional(formData, "assignedToId");
  await checkAssignee(assignedToId, practiceId);

  const letter = getUploadedFile(formData, "approvalLetter");
  const stored = letter ? await saveUpload(letter, practiceId) : null;
  const statusChanged = status !== current.status;
  const now = new Date();

  await prisma.providerEnrollment.update({
    where: { id: current.id },
    data: {
      status,
      priority: oneOf(formData, "priority", credentialingPriorityLabel, current.priority),
      assignedToId,
      state: optional(formData, "state"),
      planTypes: optional(formData, "planTypes"),
      submittedDate: optionalDate(formData, "submittedDate"),
      effectiveDate: optionalDate(formData, "effectiveDate"),
      termDate: optionalDate(formData, "termDate"),
      revalidationDate: optionalDate(formData, "revalidationDate"),
      followUpDate: optionalDate(formData, "followUpDate"),
      payerProviderId: optional(formData, "payerProviderId"),
      blockingReason: optional(formData, "blockingReason"),
      nextAction: optional(formData, "nextAction"),
      notes: optional(formData, "notes"),
      ...(stored ? { approvalLetterPath: stored.filePath, approvalLetterName: stored.fileName } : {}),
      ...(statusChanged ? { statusChangedAt: now, lastActivityAt: now } : {}),
      ...(statusChanged || stored
        ? {
            activities: {
              create: {
                channel: "INTERNAL",
                note: [
                  statusChanged ? `Status changed: ${enrollmentStatusLabel[current.status]} → ${enrollmentStatusLabel[status]}` : null,
                  stored ? `Approval letter uploaded (${stored.fileName})` : null,
                ]
                  .filter(Boolean)
                  .join(". "),
                loggedById: user.id,
              },
            },
          }
        : {}),
    },
  });

  await logAudit(user.practiceId, user.id, "UPDATE_PROVIDER_ENROLLMENT", "ProviderEnrollment", current.id, statusChanged ? status : undefined);
  refresh(`/credentialing/enrollments/${current.id}`);
}

// Quick move from a workboard card; only touches status so other fields stay intact.
export async function moveEnrollment(enrollmentId: string, formData: FormData) {
  const user = await requireUser(CREDENTIALING_ROLES);
  const current = await loadEnrollment(enrollmentId, credentialingPracticeIds(user));
  const status = oneOf(formData, "status", enrollmentStatusLabel, current.status);
  if (status === current.status) return;

  const now = new Date();
  await prisma.providerEnrollment.update({
    where: { id: current.id },
    data: {
      status,
      statusChangedAt: now,
      lastActivityAt: now,
      activities: {
        create: {
          channel: "INTERNAL",
          note: `Status changed: ${enrollmentStatusLabel[current.status]} → ${enrollmentStatusLabel[status]}`,
          loggedById: user.id,
        },
      },
    },
  });
  await logAudit(user.practiceId, user.id, "UPDATE_PROVIDER_ENROLLMENT", "ProviderEnrollment", current.id, status);
  refresh();
}

export async function logEnrollmentActivity(enrollmentId: string, formData: FormData) {
  const user = await requireUser(CREDENTIALING_ROLES);
  const enrollment = await loadEnrollment(enrollmentId, credentialingPracticeIds(user));
  const note = required(formData, "note");
  const nextFollowUp = optionalDate(formData, "nextFollowUpDate");
  const occurredAt = optionalDate(formData, "occurredAt") ?? new Date();

  await prisma.providerEnrollment.update({
    where: { id: enrollment.id },
    data: {
      lastActivityAt: new Date(),
      ...(nextFollowUp ? { followUpDate: nextFollowUp } : {}),
      activities: {
        create: {
          occurredAt,
          channel: oneOf(formData, "channel", activityChannelLabel, "PHONE"),
          referenceNumber: optional(formData, "referenceNumber"),
          repName: optional(formData, "repName"),
          note,
          loggedById: user.id,
        },
      },
    },
  });

  refresh(`/credentialing/enrollments/${enrollment.id}`);
}

// ---------- Provider profile: documents, verification, termination ----------

export async function uploadProviderDocument(providerId: string, formData: FormData) {
  const user = await requireUser(CREDENTIALING_ROLES);
  const provider = await loadProvider(providerId, credentialingPracticeIds(user));
  const type = oneOf(formData, "type", providerDocumentTypeLabel, "");
  if (!type) throw new Error("Choose a document type");
  const file = getUploadedFile(formData, "file");
  if (!file) throw new Error("Choose a file to upload");

  const stored = await saveUpload(file, provider.practiceId);

  // A renewed document replaces the current one but the prior version stays on file.
  if (type !== "OTHER") {
    await prisma.providerDocument.updateMany({
      where: { renderingProviderId: provider.id, type, supersededAt: null },
      data: { supersededAt: new Date() },
    });
  }

  const doc = await prisma.providerDocument.create({
    data: {
      renderingProviderId: provider.id,
      type,
      ...stored,
      issueDate: optionalDate(formData, "issueDate"),
      expiryDate: optionalDate(formData, "expiryDate"),
      uploadedById: user.id,
    },
  });

  await logAudit(user.practiceId, user.id, "UPLOAD_PROVIDER_DOCUMENT", "ProviderDocument", doc.id, `${provider.name}: ${type}`);
  refresh(`/credentialing/providers/${provider.id}`);
}

export async function recordVerificationCheck(providerId: string, formData: FormData) {
  const user = await requireUser(CREDENTIALING_ROLES);
  const provider = await loadProvider(providerId, credentialingPracticeIds(user));
  const source = oneOf(formData, "source", verificationSourceLabel, "");
  if (!source) throw new Error("Choose a verification source");

  const check = await prisma.primarySourceCheck.create({
    data: {
      renderingProviderId: provider.id,
      source,
      result: oneOf(formData, "result", verificationResultLabel, "CLEAR"),
      notes: optional(formData, "notes"),
      checkedById: user.id,
    },
  });

  await logAudit(user.practiceId, user.id, "RECORD_VERIFICATION", "PrimarySourceCheck", check.id, `${provider.name}: ${source} ${check.result}`);
  refresh(`/credentialing/providers/${provider.id}`);
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 1);
}

export async function runNppesCheck(providerId: string) {
  const user = await requireUser(CREDENTIALING_ROLES);
  const provider = await loadProvider(providerId, credentialingPracticeIds(user));
  if (!provider.npi) throw new Error("Add an NPI before running an NPPES check");

  let result = "MISMATCH";
  let notes: string;
  try {
    const [match] = await lookupNppes({ npi: provider.npi });
    if (!match) {
      notes = `NPI ${provider.npi} not found in NPPES`;
    } else {
      const ours = normalizeName(provider.name);
      const theirs = normalizeName(match.name);
      const nameMatches = theirs.length > 0 && theirs.every((w) => ours.includes(w));
      result = nameMatches ? "CLEAR" : "MISMATCH";
      notes = `NPPES: ${match.name}${match.credential ? `, ${match.credential}` : ""}; taxonomy: ${match.taxonomy ?? "—"}; location: ${match.address ?? "—"}${nameMatches ? "" : " — name does not match the directory record"}`;
    }
  } catch (err) {
    notes = `NPPES lookup failed: ${err instanceof Error ? err.message : "unknown error"}`;
    result = "FLAGGED";
  }

  await prisma.primarySourceCheck.create({
    data: { renderingProviderId: provider.id, source: "NPPES", result, notes, checkedById: user.id },
  });
  refresh(`/credentialing/providers/${provider.id}`);
}

export async function termProvider(providerId: string, formData: FormData) {
  const user = await requireUser(CREDENTIALING_ROLES);
  const provider = await loadProvider(providerId, credentialingPracticeIds(user));
  const termDate = optionalDate(formData, "termDate") ?? new Date();
  const reason = optional(formData, "reason");

  await prisma.renderingProvider.update({ where: { id: provider.id }, data: { status: "TERMED", termDate } });

  const open = await prisma.providerEnrollment.findMany({
    where: {
      renderingProviderId: provider.id,
      status: { in: [...OPEN_ENROLLMENT_STATUSES, ...ACTIVE_ENROLLMENT_STATUSES] },
    },
  });
  const now = new Date();
  for (const row of open) {
    await prisma.providerEnrollment.update({
      where: { id: row.id },
      data: {
        status: "TERMED",
        termDate,
        statusChangedAt: now,
        lastActivityAt: now,
        nextAction: ACTIVE_ENROLLMENT_STATUSES.includes(row.status) ? "Notify payer of provider termination" : null,
        activities: {
          create: {
            channel: "INTERNAL",
            note: `Provider termed${reason ? ` (${reason})` : ""}: enrollment closed from ${enrollmentStatusLabel[row.status]}`,
            loggedById: user.id,
          },
        },
      },
    });
  }

  await logAudit(user.practiceId, user.id, "TERM_PROVIDER", "RenderingProvider", provider.id, `${open.length} enrollment(s) closed`);
  refresh(`/credentialing/providers/${provider.id}`, "/directories");
}

export async function reactivateProvider(providerId: string) {
  const user = await requireUser(CREDENTIALING_ROLES);
  const provider = await loadProvider(providerId, credentialingPracticeIds(user));
  await prisma.renderingProvider.update({ where: { id: provider.id }, data: { status: "ACTIVE", termDate: null } });
  await ensureEnrollmentsForProvider(provider.id);
  await logAudit(user.practiceId, user.id, "REACTIVATE_PROVIDER", "RenderingProvider", provider.id);
  refresh(`/credentialing/providers/${provider.id}`, "/directories");
}

export async function syncCredentialing() {
  const user = await requireUser(CREDENTIALING_ROLES);

  const practiceIds = credentialingPracticeIds(user);
  const clinicians = await prisma.user.findMany({
    where: { practiceId: { in: practiceIds }, role: "CLINICIAN", active: true },
  });
  for (const c of clinicians) await ensureRenderingProviderForUser(c.id, c.practiceId);

  const providers = await prisma.renderingProvider.findMany({
    where: { practiceId: { in: practiceIds }, status: "ACTIVE", isRendering: true },
  });
  let added = 0;
  for (const p of providers) added += await ensureEnrollmentsForProvider(p.id);

  await logAudit(user.practiceId, user.id, "SYNC_CREDENTIALING", "ProviderEnrollment", undefined, `${added} row(s) added`);
  refresh();
}

// ---------- Inline edits from the status grid ----------

// Status / date / remarks on one provider x payer cell, without touching other fields.
export async function updateGridCell(enrollmentId: string, formData: FormData) {
  const user = await requireUser(CREDENTIALING_ROLES);
  const current = await loadEnrollment(enrollmentId, credentialingPracticeIds(user));
  const status = oneOf(formData, "status", enrollmentStatusLabel, current.status);
  const effectiveDate = optionalDate(formData, "effectiveDate");
  const remarks = optional(formData, "remarks");

  const statusChanged = status !== current.status;
  const remarksChanged = remarks !== current.notes;
  const dateChanged = (effectiveDate?.getTime() ?? null) !== (current.effectiveDate?.getTime() ?? null);
  if (!statusChanged && !remarksChanged && !dateChanged) return;

  const now = new Date();
  const note = [
    statusChanged ? `Status: ${enrollmentStatusLabel[current.status]} → ${enrollmentStatusLabel[status]}` : null,
    dateChanged ? `Effective date: ${effectiveDate ? effectiveDate.toLocaleDateString("en-US") : "cleared"}` : null,
    remarksChanged && remarks ? `Remarks: ${remarks}` : null,
  ]
    .filter(Boolean)
    .join(". ");

  await prisma.providerEnrollment.update({
    where: { id: current.id },
    data: {
      status,
      effectiveDate,
      notes: remarks,
      lastActivityAt: now,
      ...(statusChanged ? { statusChangedAt: now } : {}),
      activities: { create: { channel: "INTERNAL", note: note || "Remarks cleared", loggedById: user.id } },
    },
  });

  await logAudit(current.renderingProvider.practiceId, user.id, "GRID_EDIT_ENROLLMENT", "ProviderEnrollment", current.id, status);
  refresh();
}

const GROUP_FIELDS = {
  groupStatus: credentialingStatusLabel,
  ediStatus: connectionStatusLabel,
  eftStatus: connectionStatusLabel,
} as const;

// Group-level status, EDI/ERA or EFT for one payer line.
export async function updateGroupCell(lineId: string, field: string, formData: FormData) {
  const user = await requireUser(CREDENTIALING_ROLES);
  if (!(field in GROUP_FIELDS)) throw new Error("Unknown field");
  const key = field as keyof typeof GROUP_FIELDS;
  const line = await loadLine(lineId, credentialingPracticeIds(user));
  const status = oneOf(formData, "status", GROUP_FIELDS[key], line[key]);

  await prisma.groupPayerEnrollment.update({
    where: { id: line.id },
    data: {
      [key]: status,
      ...(key === "groupStatus"
        ? { effectiveDate: optionalDate(formData, "effectiveDate"), notes: optional(formData, "remarks") }
        : {}),
    },
  });

  await logAudit(user.practiceId, user.id, "GRID_EDIT_GROUP_LINE", "GroupPayerEnrollment", line.id, `${key}=${status}`);
  refresh();
}
