"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { recordFlow } from "@/lib/flow";
import { can, rolesFor } from "@/lib/permissions";
import { stopBlock } from "@/lib/patient-alerts";
import { runEligibilityCheck } from "@/lib/clearinghouse/service";
import { bookingBlockedByCredentialing, bookingBlockedByGateway, workflowRules } from "@/lib/workflow-rules";
import { appointmentStatusFor, telehealthLocationId } from "@/lib/telehealth-server";
import {
  BLOCK_MIN,
  STATE_NAMES,
  TELEHEALTH_SUFFIXES,
  TELEHEALTH_VISIT_TYPE,
  buildBlocks,
  dateInZone,
  dateKeyInZone,
  isKnownZone,
  parseLicenses,
  timeInZone,
  weekdaysBetween,
  windowsClash,
  zonedToUtc,
} from "@/lib/telehealth";

const ADMIN_PATH = "/schedule/telehealth";

function text(formData: FormData, key: string, max = 200) {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

function required(formData: FormData, key: string, max = 200) {
  const value = text(formData, key, max);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

// Problems on the admin page come back as a banner on the tab they belong to.
function adminRedirect(tab: string, params: Record<string, string | undefined>): never {
  const q = new URLSearchParams({ tab });
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  redirect(`${ADMIN_PATH}?${q.toString()}`);
}

function refreshAll() {
  revalidatePath(ADMIN_PATH);
  revalidatePath("/schedule");
  revalidatePath("/");
}

// ---- Function 1: doctors ----

export async function saveTelehealthProvider(formData: FormData) {
  const user = await requireUser(rolesFor("telehealth.setup"));
  const id = text(formData, "id") || null;
  const userId = required(formData, "userId");
  const suffix = text(formData, "suffix") || "Dr.";
  const specialty = text(formData, "specialty", 120) || null;
  const status = text(formData, "status") === "INACTIVE" ? "INACTIVE" : "ACTIVE";
  const licenses = [...new Set(formData.getAll("stateLicenses").map(String).filter((s) => s in STATE_NAMES))];
  const breakAfterRaw = Number(formData.get("breakAfterBlocks") || 0);
  const breakAfterBlocks = Number.isInteger(breakAfterRaw) && breakAfterRaw > 0 ? Math.min(breakAfterRaw, 24) : null;
  const breakMinRaw = Number(formData.get("breakMinWindowMin") || 300);
  const breakMinWindowMin = Number.isFinite(breakMinRaw) && breakMinRaw >= 0 ? Math.min(Math.round(breakMinRaw), 1440) : 300;
  if (!TELEHEALTH_SUFFIXES.includes(suffix)) adminRedirect("doctors", { error: "Pick a professional suffix from the list." });

  const clinician = await prisma.user.findFirst({ where: { id: userId, practiceId: user.practiceId, active: true, role: { in: ["CLINICIAN", "ADMIN"] } } });
  if (!clinician) adminRedirect("doctors", { error: "Pick an active clinician login for the doctor." });
  const taken = await prisma.telehealthProvider.findUnique({ where: { userId } });
  if (taken && taken.id !== id) adminRedirect("doctors", { error: `${clinician.name} is already set up as a telehealth doctor.` });

  const data = { suffix, specialty, status, stateLicenses: JSON.stringify(licenses), breakAfterBlocks, breakMinWindowMin };
  const saved = id
    ? await prisma.telehealthProvider.update({ where: { id, practiceId: user.practiceId }, data: { ...data, userId } })
    : await prisma.telehealthProvider.create({ data: { ...data, userId, practiceId: user.practiceId } });
  await logAudit(user.practiceId, user.id, id ? "TELEHEALTH_PROVIDER_UPDATED" : "TELEHEALTH_PROVIDER_ADDED", "TelehealthProvider", saved.id, `${clinician.name}: ${licenses.join(", ") || "no licences"} · ${status}`);
  refreshAll();
  adminRedirect("doctors", { ok: `${clinician.name} has been ${id ? "updated" : "added"} successfully.` });
}

export async function setTelehealthProviderStatus(id: string, status: "ACTIVE" | "INACTIVE") {
  const user = await requireUser(rolesFor("telehealth.setup"));
  const p = await prisma.telehealthProvider.findFirst({ where: { id, practiceId: user.practiceId }, include: { user: true } });
  if (!p) throw new Error("Not found");
  await prisma.telehealthProvider.update({ where: { id }, data: { status } });
  await logAudit(user.practiceId, user.id, "TELEHEALTH_PROVIDER_STATUS", "TelehealthProvider", id, `${p.user.name}: ${status}`);
  refreshAll();
}

// Doctors with future bookings are retired (status Inactive), never deleted.
export async function deleteTelehealthProvider(id: string) {
  const user = await requireUser(rolesFor("settings.admin"));
  const p = await prisma.telehealthProvider.findFirst({ where: { id, practiceId: user.practiceId }, include: { user: true } });
  if (!p) throw new Error("Not found");
  const future = await prisma.telehealthReservation.count({ where: { providerId: id, status: { notIn: ["CANCELLED"] }, endsAt: { gt: new Date() } } });
  if (future) adminRedirect("doctors", { error: `${p.user.name} still has ${future} upcoming reservation${future === 1 ? "" : "s"}. Cancel or move them first, or set the doctor Inactive.` });
  await prisma.telehealthProvider.delete({ where: { id } });
  await logAudit(user.practiceId, user.id, "TELEHEALTH_PROVIDER_DELETED", "TelehealthProvider", id, p.user.name);
  refreshAll();
  adminRedirect("doctors", { ok: `${p.user.name} removed from telehealth.` });
}

// ---- Function 2: availability windows ----

type Window = { startsAt: Date; endsAt: Date };

// The clashing existing window for a doctor, if any (inclusive: touching windows count).
async function clashFor(db: Prisma.TransactionClient | typeof prisma, providerId: string, w: Window, excludeId?: string | null) {
  const rows = await db.telehealthAvailability.findMany({
    where: { providerId, ...(excludeId ? { id: { not: excludeId } } : {}), startsAt: { lte: w.endsAt }, endsAt: { gte: w.startsAt } },
    orderBy: { startsAt: "asc" },
  });
  return rows.find((r) => windowsClash(r, w)) ?? null;
}

export async function addTelehealthAvailability(formData: FormData) {
  const user = await requireUser(rolesFor("telehealth.setup"));
  const providerId = required(formData, "providerId");
  const timezone = required(formData, "timezone");
  const startTime = required(formData, "startTime");
  const endTime = required(formData, "endTime");
  const date = text(formData, "date");
  const toDate = text(formData, "toDate");
  // A "to" date makes it a batch: one window per weekday from the date through the to date.
  const mode = toDate ? "range" : "single";
  if (!isKnownZone(timezone)) adminRedirect("availability", { error: "Pick a time zone from the list." });

  const provider = await prisma.telehealthProvider.findFirst({ where: { id: providerId, practiceId: user.practiceId }, include: { user: true } });
  if (!provider) adminRedirect("availability", { error: "Pick the doctor." });

  const dates = mode === "range" ? weekdaysBetween(date, toDate) : date ? [date] : [];
  if (dates.length === 0) adminRedirect("availability", { error: mode === "range" ? "The date range needs at least one weekday (Mon–Fri) and the to date must not be before the date." : "Enter the date." });

  const windows: { date: string; startsAt: Date; endsAt: Date }[] = [];
  const problems: string[] = [];
  for (const d of dates) {
    const startsAt = zonedToUtc(d, startTime, timezone);
    const endsAt = zonedToUtc(d, endTime, timezone);
    if (!startsAt || !endsAt || startsAt >= endsAt) {
      problems.push(`${d}: invalid time range`);
      continue;
    }
    windows.push({ date: d, startsAt, endsAt });
  }

  // Each date is checked against the doctor's existing windows and against the other dates in this batch; the batch
  // saves only when every row is clear.
  for (const w of windows) {
    const clash = await clashFor(prisma, providerId, w);
    if (clash) problems.push(`${w.date}: conflicts with ${timeInZone(clash.startsAt, clash.timezone)}–${timeInZone(clash.endsAt, clash.timezone)} ${dateInZone(clash.startsAt, clash.timezone)}`);
    if (windows.some((o) => o !== w && windowsClash(o, w))) problems.push(`${w.date}: overlaps another date in this batch`);
  }
  if (problems.length) adminRedirect("availability", { error: `Nothing saved — fix these and try again:\n${[...new Set(problems)].join("\n")}` });

  await prisma.telehealthAvailability.createMany({
    data: windows.map((w) => ({ practiceId: user.practiceId, providerId, startsAt: w.startsAt, endsAt: w.endsAt, timezone, createdById: user.id })),
    skipDuplicates: true,
  });
  await logAudit(user.practiceId, user.id, "TELEHEALTH_AVAILABILITY_ADDED", "TelehealthProvider", providerId, `${provider.user.name}: ${windows.length} window(s) ${startTime}–${endTime} ${timezone}`);
  refreshAll();
  adminRedirect("availability", { ok: `${windows.length} window${windows.length === 1 ? "" : "s"} added for ${provider.user.name}.`, provider: providerId });
}

export async function updateTelehealthAvailability(id: string, formData: FormData) {
  const user = await requireUser(rolesFor("telehealth.setup"));
  const w = await prisma.telehealthAvailability.findFirst({
    where: { id, practiceId: user.practiceId },
    include: { reservations: { where: { status: { not: "CANCELLED" } } }, provider: { include: { user: true } } },
  });
  if (!w) throw new Error("Not found");
  const timezone = text(formData, "timezone") || w.timezone;
  const date = required(formData, "date");
  const startsAt = zonedToUtc(date, required(formData, "startTime"), timezone);
  const endsAt = zonedToUtc(date, required(formData, "endTime"), timezone);
  if (!isKnownZone(timezone) || !startsAt || !endsAt || startsAt >= endsAt) adminRedirect("availability", { error: "Invalid schedule time range.", provider: w.providerId });

  // The window may not clash with the doctor's other windows, and every live reservation must still fit inside it.
  const clash = await clashFor(prisma, w.providerId, { startsAt, endsAt }, id);
  if (clash) adminRedirect("availability", { error: `Conflicts with the window ${timeInZone(clash.startsAt, clash.timezone)}–${timeInZone(clash.endsAt, clash.timezone)} on ${dateInZone(clash.startsAt, clash.timezone)}.`, provider: w.providerId });
  const outside = w.reservations.filter((r) => r.startsAt < startsAt || r.endsAt > endsAt);
  if (outside.length) adminRedirect("availability", { error: `${outside.length} reservation${outside.length === 1 ? " falls" : "s fall"} outside the new times. Move or cancel them first.`, provider: w.providerId });

  await prisma.telehealthAvailability.update({ where: { id }, data: { startsAt, endsAt, timezone } });
  await logAudit(user.practiceId, user.id, "TELEHEALTH_AVAILABILITY_UPDATED", "TelehealthAvailability", id, `${w.provider.user.name}: ${date} ${timeInZone(startsAt, timezone)}–${timeInZone(endsAt, timezone)} ${timezone}`);
  refreshAll();
  adminRedirect("availability", { ok: "Window updated.", provider: w.providerId });
}

export async function deleteTelehealthAvailability(id: string) {
  const user = await requireUser(rolesFor("telehealth.setup"));
  const w = await prisma.telehealthAvailability.findFirst({
    where: { id, practiceId: user.practiceId },
    include: { reservations: { where: { status: { not: "CANCELLED" }, endsAt: { gt: new Date() } } }, provider: { include: { user: true } } },
  });
  if (!w) throw new Error("Not found");
  if (w.reservations.length) adminRedirect("availability", { error: `This window still has ${w.reservations.length} upcoming reservation${w.reservations.length === 1 ? "" : "s"}. Cancel or move them first.`, provider: w.providerId });
  await prisma.telehealthAvailability.delete({ where: { id } });
  await logAudit(user.practiceId, user.id, "TELEHEALTH_AVAILABILITY_DELETED", "TelehealthAvailability", id, `${w.provider.user.name}: ${dateInZone(w.startsAt, w.timezone)}`);
  refreshAll();
  adminRedirect("availability", { ok: "Window removed.", provider: w.providerId });
}

// ---- Function 4: reservations ----

type BlockCheck = { ok: true } | { ok: false; error: string };

// Server-side rules for a block (the booking panel checks the same things first): exactly 20 minutes, on the
// :00/:20/:40 grid, inside the window, not a break, and not overlapping another live reservation of the doctor.
async function checkBlock(
  db: Prisma.TransactionClient,
  window: { id: string; providerId: string; startsAt: Date; endsAt: Date; timezone: string },
  rule: { breakAfterBlocks: number | null; breakMinWindowMin: number },
  startsAt: Date,
  endsAt: Date,
  excludeReservationId: string | null
): Promise<BlockCheck> {
  if (endsAt.getTime() - startsAt.getTime() !== BLOCK_MIN * 60_000) return { ok: false, error: `A telehealth visit is exactly ${BLOCK_MIN} minutes.` };
  if (startsAt < window.startsAt || endsAt > window.endsAt) return { ok: false, error: "Out of range — the block is outside the doctor's window." };
  if (endsAt <= new Date()) return { ok: false, error: "That block is in the past." };
  const live = await db.telehealthReservation.findMany({
    where: { availabilityId: window.id, status: { not: "CANCELLED" }, ...(excludeReservationId ? { id: { not: excludeReservationId } } : {}) },
    select: { id: true, startsAt: true, endsAt: true, status: true },
  });
  const block = buildBlocks(window, live, rule, { excludeReservationId }).find((b) => b.startsAt === startsAt.toISOString());
  if (!block) return { ok: false, error: "Pick a block that starts at :00, :20 or :40." };
  if (block.isBreak) return { ok: false, error: "That block is the doctor's break." };
  // Double-booking guard across every window of the doctor (half-open overlap).
  const overlap = await db.telehealthReservation.findFirst({
    where: {
      providerId: window.providerId,
      status: { not: "CANCELLED" },
      ...(excludeReservationId ? { id: { not: excludeReservationId } } : {}),
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
    select: { id: true },
  });
  if (overlap) return { ok: false, error: "Already reserved — this time slot is taken for the doctor." };
  return { ok: true };
}

export async function reserveTelehealth(formData: FormData) {
  const user = await requireUser(rolesFor("schedule.view"));
  const patientId = text(formData, "patientId");
  const providerId = text(formData, "providerId");
  const availabilityId = text(formData, "availabilityId");
  const stateCode = text(formData, "stateCode", 2).toUpperCase();
  const blockStart = text(formData, "blockStart", 40);
  const notes = text(formData, "notes", 150);
  const acceptLicense = formData.get("acceptLicense") === "on";
  const returnTo = text(formData, "returnTo");
  const safeReturn = /^\/gateway\/[A-Za-z0-9_-]+$/.test(returnTo) ? returnTo : null;

  // Problems return to the scheduler with the telehealth panel open and the choices kept.
  const fail = (error: string): never => {
    const back = new URLSearchParams({
      bookType: TELEHEALTH_VISIT_TYPE,
      teleError: error,
      ...(patientId ? { patientId } : {}),
      teleProvider: providerId,
      teleWindow: availabilityId,
      teleState: stateCode,
      teleBlock: blockStart,
      teleNotes: notes,
      ...(safeReturn ? { returnTo: safeReturn } : {}),
    });
    redirect(`/schedule?${back.toString()}#book`);
  };

  if (!patientId) fail("Choose the patient from the search results first.");
  if (!providerId || !availabilityId) fail("Pick the doctor and one of their windows.");
  if (!(stateCode in STATE_NAMES)) fail("Pick the state the patient will be in for the visit.");
  if (!blockStart) fail("Pick a time block.");
  if (!notes) fail("Notes are required (up to 150 characters).");
  const startsAt = new Date(blockStart);
  if (Number.isNaN(startsAt.getTime())) fail("Pick a time block.");
  const endsAt = new Date(startsAt.getTime() + BLOCK_MIN * 60_000);

  const [patient, provider, window, locationId] = await Promise.all([
    prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId } }),
    prisma.telehealthProvider.findFirst({ where: { id: providerId, practiceId: user.practiceId }, include: { user: true } }),
    prisma.telehealthAvailability.findFirst({ where: { id: availabilityId, practiceId: user.practiceId } }),
    telehealthLocationId(user.practiceId),
  ]);
  if (!patient) fail("Patient not found.");
  if (!provider || provider.status !== "ACTIVE") fail("That doctor is not active for telehealth.");
  if (!window || window.providerId !== provider!.id) fail("That window does not belong to the doctor.");
  if (!locationId) fail("Set up a site of service before booking.");

  const licensed = parseLicenses(provider!.stateLicenses).includes(stateCode);
  if (!licensed && !acceptLicense) fail(`${provider!.user.name} is not licensed in ${STATE_NAMES[stateCode]}. Tick "Book anyway" to reserve regardless.`);

  // The same workflow gates as any other booking: stop alerts, Gateway clearance and credentialing.
  const rules = await workflowRules(user.practiceId);
  const blocked =
    (await stopBlock(user.practiceId, patient!.id, "schedule", user.id)) ??
    (rules.bookingRequiresGateway ? await bookingBlockedByGateway(user.practiceId, patient!.id) : null) ??
    (rules.bookingChecksCredentialing ? await bookingBlockedByCredentialing(user.practiceId, patient!.id, provider!.userId) : null);
  if (blocked) fail(`Not booked — ${blocked}`);

  const outcome: { error: string | null; reservationId: string | null } = { error: null, reservationId: null };
  await prisma.$transaction(async (tx) => {
    // Lock the window so two staff cannot take the same block at once.
    await tx.$queryRaw`SELECT "id" FROM "TelehealthAvailability" WHERE "id" = ${window!.id} FOR UPDATE`;
    const check = await checkBlock(tx, window!, provider!, startsAt, endsAt, null);
    if (!check.ok) {
      outcome.error = check.error;
      return;
    }
    const appointment = await tx.appointment.create({
      data: {
        practiceId: user.practiceId,
        patientId: patient!.id,
        providerId: provider!.userId,
        locationId: locationId!,
        startsAt,
        endsAt,
        visitType: TELEHEALTH_VISIT_TYPE,
        status: "SCHEDULED",
        reason: notes,
        placeOfService: "02",
        createdById: user.id,
        conflictNote: licensed ? null : `Booked with accepted warning: ${provider!.user.name} is not licensed in ${STATE_NAMES[stateCode]}`,
      },
    });
    const r = await tx.telehealthReservation.create({
      data: {
        practiceId: user.practiceId,
        providerId: provider!.id,
        availabilityId: window!.id,
        patientId: patient!.id,
        appointmentId: appointment.id,
        stateCode,
        startsAt,
        endsAt,
        durationMin: BLOCK_MIN,
        timezone: window!.timezone,
        status: "RESERVED",
        notes,
        reservedById: user.id,
      },
    });
    outcome.reservationId = r.id;
  });
  if (outcome.error) fail(outcome.error);
  const reservationId = outcome.reservationId!;

  await logAudit(user.practiceId, user.id, "TELEHEALTH_RESERVED", "TelehealthReservation", reservationId, `${provider!.user.name} · ${STATE_NAMES[stateCode]} · ${dateInZone(startsAt, window!.timezone)} ${timeInZone(startsAt, window!.timezone)}${licensed ? "" : " · not licensed (accepted)"}`);
  const reservation = await prisma.telehealthReservation.findUnique({ where: { id: reservationId }, select: { appointmentId: true } });
  if (reservation?.appointmentId) await runEligibilityCheck({ practiceId: user.practiceId, patientId: patient!.id, appointmentId: reservation.appointmentId });

  refreshAll();
  revalidatePath("/encounters");
  redirect(safeReturn ?? `/schedule?view=day&date=${dateKeyInZone(startsAt, window!.timezone)}`);
}

async function loadReservation(id: string, practiceId: string) {
  const r = await prisma.telehealthReservation.findFirst({
    where: { id, practiceId },
    include: { provider: { include: { user: true } }, availability: true, appointment: { include: { encounter: { select: { id: true } } } }, patient: true },
  });
  if (!r) throw new Error("Reservation not found");
  return r;
}

async function setAppointmentStatus(appointmentId: string | null, status: string, userId: string, extra: Prisma.AppointmentUpdateManyMutationInput = {}) {
  if (!appointmentId) return;
  const { count } = await prisma.appointment.updateMany({ where: { id: appointmentId }, data: { status, ...extra } });
  if (count) await recordFlow(appointmentId, status, userId);
}

export async function confirmTelehealthReservation(id: string) {
  const user = await requireUser(rolesFor("telehealth.confirm"));
  const r = await loadReservation(id, user.practiceId);
  if (r.status !== "RESERVED") adminRedirect("reservations", { error: `Only reserved visits can be confirmed (this one is ${r.status.toLowerCase()}).` });
  await prisma.telehealthReservation.update({ where: { id }, data: { status: "CONFIRMED", confirmedById: user.id, confirmedAt: new Date() } });
  await setAppointmentStatus(r.appointmentId, "CONFIRMED", user.id, { confirmedAt: new Date(), confirmedVia: "STAFF" });
  await logAudit(user.practiceId, user.id, "TELEHEALTH_CONFIRMED", "TelehealthReservation", id, `${r.patient.lastName}, ${r.patient.firstName} with ${r.provider.user.name}`);
  refreshAll();
}

// A confirmed reservation is changed only by someone who may confirm (the source system's "contact admin / CDS").
function guardConfirmed(user: { role: string; overrides?: Record<string, boolean> | null }, status: string) {
  if (status === "CONFIRMED" && !can(user, "telehealth.confirm")) adminRedirect("reservations", { error: "This reservation is confirmed — ask an admin or CDS to change or cancel it." });
}

export async function cancelTelehealthReservation(id: string, formData: FormData) {
  const user = await requireUser(rolesFor("schedule.view"));
  const r = await loadReservation(id, user.practiceId);
  const reason = text(formData, "reason", 300);
  if (!reason) adminRedirect("reservations", { error: "Give the reason for cancelling." });
  if (["CANCELLED", "COMPLETED"].includes(r.status)) adminRedirect("reservations", { error: `This reservation is already ${r.status.toLowerCase()}.` });
  if (r.appointment?.encounter) adminRedirect("reservations", { error: "This visit has been started — it can't be cancelled from the schedule." });
  guardConfirmed(user, r.status);
  await prisma.telehealthReservation.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason } });
  await setAppointmentStatus(r.appointmentId, "CANCELLED", user.id, { cancelReason: reason, cancelledAt: new Date() });
  await logAudit(user.practiceId, user.id, "TELEHEALTH_CANCELLED", "TelehealthReservation", id, reason);
  refreshAll();
}

export async function setTelehealthOutcome(id: string, formData: FormData) {
  const user = await requireUser(rolesFor("schedule.view"));
  const r = await loadReservation(id, user.practiceId);
  const status = text(formData, "status");
  if (!["COMPLETED", "MISSED"].includes(status)) throw new Error("Pick an outcome");
  if (r.status === "CANCELLED") adminRedirect("reservations", { error: "A cancelled reservation has no outcome." });
  await prisma.telehealthReservation.update({ where: { id }, data: { status, cancelReason: text(formData, "reason", 300) || null } });
  if (!r.appointment?.encounter) await setAppointmentStatus(r.appointmentId, appointmentStatusFor(status), user.id);
  await logAudit(user.practiceId, user.id, "TELEHEALTH_OUTCOME", "TelehealthReservation", id, status);
  refreshAll();
}

// Move a reservation to another block of the same window (or change its state / notes).
export async function moveTelehealthReservation(id: string, formData: FormData) {
  const user = await requireUser(rolesFor("schedule.view"));
  const r = await loadReservation(id, user.practiceId);
  if (["CANCELLED", "COMPLETED", "MISSED"].includes(r.status)) adminRedirect("reservations", { error: `A ${r.status.toLowerCase()} reservation can't be moved.` });
  if (r.appointment?.encounter) adminRedirect("reservations", { error: "This visit has been started — it can't be moved." });
  guardConfirmed(user, r.status);
  const stateCode = (text(formData, "stateCode", 2) || r.stateCode).toUpperCase();
  const notes = text(formData, "notes", 150) || r.notes;
  const time = text(formData, "time", 8);
  if (!(stateCode in STATE_NAMES)) adminRedirect("reservations", { error: "Pick a state." });
  const startsAt = time ? zonedToUtc(dateKeyInZone(r.availability.startsAt, r.availability.timezone), time, r.availability.timezone) : r.startsAt;
  if (!startsAt) adminRedirect("reservations", { error: "Enter the new start time as HH:MM." });
  const endsAt = new Date(startsAt.getTime() + BLOCK_MIN * 60_000);

  const outcome: { error: string | null } = { error: null };
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "TelehealthAvailability" WHERE "id" = ${r.availability.id} FOR UPDATE`;
    if (startsAt.getTime() !== r.startsAt.getTime()) {
      const check = await checkBlock(tx, r.availability, r.provider, startsAt, endsAt, r.id);
      if (!check.ok) {
        outcome.error = check.error;
        return;
      }
    }
    await tx.telehealthReservation.update({ where: { id }, data: { startsAt, endsAt, stateCode, notes } });
    if (r.appointmentId) await tx.appointment.updateMany({ where: { id: r.appointmentId }, data: { startsAt, endsAt, reason: notes } });
  });
  if (outcome.error) adminRedirect("reservations", { error: outcome.error });
  await logAudit(user.practiceId, user.id, "TELEHEALTH_MOVED", "TelehealthReservation", id, `${dateInZone(startsAt, r.timezone)} ${timeInZone(startsAt, r.timezone)} · ${stateCode}`);
  refreshAll();
  adminRedirect("reservations", { ok: "Reservation updated." });
}
