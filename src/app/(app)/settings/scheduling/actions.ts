"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { ensureSchedulerSetup } from "@/lib/scheduler-setup";
import { CALENDAR_STATUSES, COLOR_MODES, PREVIEW_FIELDS, type DayHours } from "@/lib/scheduler";

class SchedError extends Error {}
function fail(message: string): never {
  throw new SchedError(message);
}

async function guarded(back: string, work: (user: Awaited<ReturnType<typeof requireUser>>) => Promise<string | void>) {
  const user = await requireUser(["ADMIN"]);
  await ensureSchedulerSetup(user.practiceId);
  let target = back;
  try {
    target = (await work(user)) ?? `${back}${back.includes("?") ? "&" : "?"}saved=1`;
  } catch (err) {
    if (!(err instanceof SchedError)) throw err;
    target = `${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(err.message.slice(0, 300))}`;
  }
  revalidatePath("/settings/scheduling", "layout");
  revalidatePath("/schedule", "layout");
  revalidatePath("/", "layout");
  redirect(target);
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const on = (fd: FormData, k: string) => fd.get(k) === "on";
const color = (v: string, fallback: string) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback);
const hhmm = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

// ---- Visit types & durations ----

export async function saveVisitTypes(fd: FormData) {
  return guarded("/settings/scheduling?tab=types", async (user) => {
    const types = await prisma.visitType.findMany({ where: { practiceId: user.practiceId } });
    for (const t of types) {
      if (!fd.has(`name_${t.id}`)) continue;
      const name = str(fd, `name_${t.id}`);
      if (!name) fail("Every visit type needs a name.");
      const dur = str(fd, `dur_${t.id}`);
      const duration = dur ? Number(dur) : null;
      if (duration !== null && !(Number.isInteger(duration) && duration >= 5 && duration <= 480)) fail(`${name}: duration must be 5–480 minutes.`);
      const order = Number(str(fd, `order_${t.id}`));
      await prisma.visitType.update({
        where: { id: t.id },
        data: {
          name: name.slice(0, 80),
          durationMin: duration,
          billable: on(fd, `bill_${t.id}`),
          active: on(fd, `active_${t.id}`),
          textColor: color(str(fd, `text_${t.id}`), t.textColor),
          bgColor: color(str(fd, `bg_${t.id}`), t.bgColor),
          sortOrder: Number.isFinite(order) ? Math.round(order) : t.sortOrder,
        },
      });
    }
    await logAudit(user.practiceId, user.id, "UPDATE_VISIT_TYPES", "VisitType", user.practiceId, `${types.length} types`);
  });
}

export async function addVisitType(fd: FormData) {
  return guarded("/settings/scheduling?tab=types", async (user) => {
    const name = str(fd, "name");
    if (!name) fail("Name the visit type.");
    const code = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "TYPE";
    if (await prisma.visitType.findFirst({ where: { practiceId: user.practiceId, code } })) fail(`A visit type like "${name}" already exists.`);
    const dur = Number(str(fd, "durationMin"));
    await prisma.visitType.create({
      data: {
        practiceId: user.practiceId,
        code,
        name: name.slice(0, 80),
        durationMin: Number.isInteger(dur) && dur >= 5 && dur <= 480 ? dur : null,
        billable: !on(fd, "nonBillable"),
        sortOrder: 900,
      },
    });
  });
}

// ---- Color coding ----

export async function saveColorCoding(fd: FormData) {
  return guarded("/settings/scheduling?tab=colors", async (user) => {
    const mode = str(fd, "colorMode");
    if (!(mode in COLOR_MODES)) fail("Pick how the schedule is colour coded.");
    const statusColors = Object.fromEntries(
      CALENDAR_STATUSES.map(([key, , def]) => [key, { text: color(str(fd, `st_text_${key}`), def.text), bg: color(str(fd, `st_bg_${key}`), def.bg) }])
    );
    const physicians = await prisma.user.findMany({ where: { practiceId: user.practiceId, role: { in: ["CLINICIAN", "ADMIN"] } }, select: { id: true } });
    const physicianColors = Object.fromEntries(
      physicians
        .filter((p) => fd.has(`ph_bg_${p.id}`))
        .map((p) => [p.id, { text: color(str(fd, `ph_text_${p.id}`), "#ffffff"), bg: color(str(fd, `ph_bg_${p.id}`), "#2f5fa8") }])
    );
    await prisma.schedulerSettings.update({
      where: { practiceId: user.practiceId },
      data: { colorMode: mode, statusColors: JSON.stringify(statusColors), physicianColors: JSON.stringify(physicianColors) },
    });
    for (const t of await prisma.visitType.findMany({ where: { practiceId: user.practiceId } })) {
      if (!fd.has(`ty_bg_${t.id}`)) continue;
      await prisma.visitType.update({
        where: { id: t.id },
        data: { textColor: color(str(fd, `ty_text_${t.id}`), t.textColor), bgColor: color(str(fd, `ty_bg_${t.id}`), t.bgColor) },
      });
    }
  });
}

// ---- Visit info (preview) ----

export async function savePreviewFields(fd: FormData) {
  return guarded("/settings/scheduling?tab=preview", async (user) => {
    const fields = fd.getAll("fields").map(String).filter((f) => f in PREVIEW_FIELDS);
    await prisma.schedulerSettings.update({ where: { practiceId: user.practiceId }, data: { previewFields: JSON.stringify(fields) } });
  });
}

// ---- Office hours ----

function readHours(fd: FormData): DayHours[] {
  return [0, 1, 2, 3, 4, 5, 6].map((day) => {
    const closed = str(fd, `start_${day}`) === "CLOSED";
    const start = str(fd, `start_${day}`);
    const end = str(fd, `end_${day}`);
    if (!closed) {
      if (!hhmm(start) || !hhmm(end)) fail("Pick a start and end time for each open day.");
      if (end <= start) fail("Closing time must be after opening time.");
    }
    return { day, closed, start: closed ? "08:00" : start, end: closed ? "17:00" : end };
  });
}

export async function saveOfficeHours(locationId: string, fd: FormData) {
  return guarded(`/settings/scheduling?tab=hours&location=${locationId}`, async (user) => {
    const loc = await prisma.location.findFirst({ where: { id: locationId, practiceId: user.practiceId } });
    if (!loc) fail("Site of service not found.");
    const hours = readHours(fd);
    const slot = Number(str(fd, "slotMinutes"));
    const data = {
      officeHours: JSON.stringify(hours),
      slotMinutes: [5, 10, 15, 20, 30, 60].includes(slot) ? slot : 15,
      showNonOfficeHours: on(fd, "showNonOfficeHours"),
      promptOutsideHours: on(fd, "promptOutsideHours"),
    };
    await prisma.location.update({ where: { id: loc.id }, data });
    // "Copy to site of service"
    const copyTo = fd.getAll("copyTo").map(String).filter((id) => id !== loc.id);
    if (copyTo.length) await prisma.location.updateMany({ where: { practiceId: user.practiceId, id: { in: copyTo } }, data });
    await logAudit(user.practiceId, user.id, "UPDATE_OFFICE_HOURS", "Location", loc.id, `${loc.name}${copyTo.length ? ` (+${copyTo.length} copied)` : ""}`);
  });
}

// ---- Cancellation reasons ----

export async function addCancellationReason(fd: FormData) {
  return guarded("/settings/scheduling?tab=cancel", async (user) => {
    const name = str(fd, "name");
    if (!name) fail("Type the reason.");
    const existing = await prisma.cancellationReason.findFirst({ where: { practiceId: user.practiceId, name } });
    if (existing) await prisma.cancellationReason.update({ where: { id: existing.id }, data: { active: true } });
    else await prisma.cancellationReason.create({ data: { practiceId: user.practiceId, name: name.slice(0, 80), sortOrder: 900 } });
  });
}

export async function removeCancellationReason(id: string) {
  return guarded("/settings/scheduling?tab=cancel", async (user) => {
    // Kept (inactive) so cancelled visits still show the reason they were given.
    await prisma.cancellationReason.updateMany({ where: { id, practiceId: user.practiceId }, data: { active: false } });
  });
}

// ---- Calendar filter sets ----

export async function saveFilterSet(fd: FormData) {
  return guarded("/settings/scheduling?tab=filters", async (user) => {
    const name = str(fd, "name");
    if (!name) fail("Name the filter set.");
    const view = ["day", "week", "list"].includes(str(fd, "view")) ? str(fd, "view") : "day";
    await prisma.calendarFilterSet.create({
      data: {
        practiceId: user.practiceId,
        name: name.slice(0, 80),
        description: str(fd, "description") || null,
        locationId: str(fd, "locationId") || null,
        providerIds: fd.getAll("providerIds").map(String).join(",") || null,
        visitTypes: fd.getAll("visitTypes").map(String).join(",") || null,
        view,
      },
    });
    return fd.get("another") ? "/settings/scheduling?tab=filters&saved=1#new-filter" : undefined;
  });
}

export async function deleteFilterSet(id: string) {
  return guarded("/settings/scheduling?tab=filters", async (user) => {
    await prisma.calendarFilterSet.deleteMany({ where: { id, practiceId: user.practiceId } });
  });
}

// ---- General ----

export async function saveGeneralScheduling(fd: FormData) {
  return guarded("/settings/scheduling?tab=general", async (user) => {
    const defaultLocationId = str(fd, "defaultLocationId") || null;
    if (defaultLocationId && !(await prisma.location.findFirst({ where: { id: defaultLocationId, practiceId: user.practiceId } }))) fail("Pick a site of service.");
    const minutes = Number(str(fd, "autoCheckInMinutes"));
    const fixed = str(fd, "startTimeFixed");
    if (!hhmm(fixed)) fail("Pick a default start time.");
    await prisma.schedulerSettings.update({
      where: { practiceId: user.practiceId },
      data: {
        defaultLocationId,
        showWeekends: on(fd, "showWeekends"),
        showPosDropdown: on(fd, "showPosDropdown"),
        autoCheckIn: on(fd, "autoCheckIn"),
        autoCheckInMinutes: Number.isInteger(minutes) && minutes >= 0 && minutes <= 240 ? minutes : 15,
        showCapacityView: on(fd, "showCapacityView"),
        startTimeMode: str(fd, "startTimeMode") === "CURRENT" ? "CURRENT" : "FIXED",
        startTimeFixed: fixed,
        showConflicts: on(fd, "showConflicts"),
        allowCrossSiteConflicts: on(fd, "allowCrossSiteConflicts"),
        defaultAuthorizations: on(fd, "defaultAuthorizations"),
      },
    });
    await logAudit(user.practiceId, user.id, "UPDATE_SCHEDULER_SETTINGS", "SchedulerSettings", user.practiceId, "general");
  });
}

// ---- Resources ----

export async function addResource(fd: FormData) {
  const locationId = str(fd, "locationId");
  return guarded(`/settings/scheduling?tab=resources&location=${locationId}`, async (user) => {
    const loc = await prisma.location.findFirst({ where: { id: locationId, practiceId: user.practiceId } });
    if (!loc) fail("Pick a site of service.");
    const name = str(fd, "name");
    if (!name) fail("Name the resource.");
    const units = Number(str(fd, "maxUnits"));
    if (!(Number.isInteger(units) && units >= 1 && units <= 99)) fail("Maximum units must be 1–99.");
    await prisma.schedulerResource.create({ data: { practiceId: user.practiceId, locationId: loc.id, name: name.slice(0, 80), maxUnits: units } });
  });
}

export async function updateResource(id: string, fd: FormData) {
  const r = await prisma.schedulerResource.findUnique({ where: { id } });
  return guarded(`/settings/scheduling?tab=resources&location=${r?.locationId ?? ""}`, async (user) => {
    if (!r || r.practiceId !== user.practiceId) fail("Resource not found.");
    const units = Number(str(fd, "maxUnits"));
    if (!(Number.isInteger(units) && units >= 1 && units <= 99)) fail("Maximum units must be 1–99.");
    await prisma.schedulerResource.update({ where: { id }, data: { maxUnits: units, active: on(fd, "active"), name: str(fd, "name").slice(0, 80) || r.name } });
  });
}
