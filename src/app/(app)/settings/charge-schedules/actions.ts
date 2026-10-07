"use server";

import { rolesFor } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { parseScheduleCsv } from "@/lib/charge-schedules";

const ROLES = rolesFor("codes.edit");
const MAX_IMPORT_BYTES = 2_000_000;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const day = (v: string) => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

function back(path: string, msg: { error?: string; ok?: string }): never {
  revalidatePath("/settings/charge-schedules");
  revalidatePath(path);
  redirect(`${path}?${msg.error ? `error=${encodeURIComponent(msg.error.slice(0, 400))}` : `ok=${encodeURIComponent(msg.ok ?? "Saved.")}`}`);
}

// Name, dates and who the schedule applies to. Ids that don't belong to the practice are dropped.
async function readHeader(fd: FormData, practiceId: string, path: string) {
  const name = str(fd, "name").slice(0, 120);
  if (!name) back(path, { error: "Name the charge schedule." });
  const startDate = day(str(fd, "startDate"));
  if (!startDate) back(path, { error: "Enter the start date." });
  const endText = str(fd, "endDate");
  const endDate = endText ? day(endText) : null;
  if (endText && !endDate) back(path, { error: "The end date is not a valid date." });
  if (endDate && endDate < startDate!) back(path, { error: "The end date is before the start date." });
  const ids = (k: string) => [...new Set(fd.getAll(k).map(String).filter((v) => /^[a-z0-9]{10,40}$/.test(v)))];
  const [locations, providers, payers] = await Promise.all([
    prisma.location.findMany({ where: { practiceId, id: { in: ids("locationIds") } }, select: { id: true } }),
    prisma.renderingProvider.findMany({ where: { practiceId, id: { in: ids("providerIds") } }, select: { id: true } }),
    prisma.payer.findMany({ where: { practiceId, id: { in: ids("payerIds") } }, select: { id: true } }),
  ]);
  return {
    name,
    startDate: startDate!,
    endDate,
    active: fd.get("active") === "on",
    locationIds: JSON.stringify(locations.map((x) => x.id)),
    providerIds: JSON.stringify(providers.map((x) => x.id)),
    payerIds: JSON.stringify(payers.map((x) => x.id)),
  };
}

// A new schedule starts with every billing code the practice already uses, at its current fee.
export async function createSchedule(fd: FormData) {
  const user = await requireUser(ROLES);
  const header = await readHeader(fd, user.practiceId, "/settings/charge-schedules");
  const [codes, templateItems] = await Promise.all([
    prisma.practiceCode.findMany({ where: { practiceId: user.practiceId, type: "CPT", active: true } }),
    prisma.superbillTemplateItem.findMany({ where: { template: { practiceId: user.practiceId, active: true } } }),
  ]);
  const items = new Map<string, { code: string; description: string; feeCents: number }>();
  for (const i of templateItems) items.set(i.cptCode.toUpperCase(), { code: i.cptCode.toUpperCase(), description: i.description, feeCents: i.amountCents });
  for (const c of codes) items.set(c.code.toUpperCase(), { code: c.code.toUpperCase(), description: c.description, feeCents: c.feeCents ?? items.get(c.code.toUpperCase())?.feeCents ?? 0 });
  const schedule = await prisma.chargeSchedule.create({ data: { ...header, practiceId: user.practiceId, items: { create: [...items.values()] } } });
  await logAudit(user.practiceId, user.id, "CREATE_CHARGE_SCHEDULE", "ChargeSchedule", schedule.id, `${header.name} · ${items.size} codes`);
  back(`/settings/charge-schedules/${schedule.id}`, { ok: `Charge schedule created with ${items.size} billing codes from the practice code list.` });
}

async function ownSchedule(user: { practiceId: string }, id: string) {
  const schedule = await prisma.chargeSchedule.findFirst({ where: { id, practiceId: user.practiceId }, include: { items: true } });
  if (!schedule) redirect("/settings/charge-schedules");
  return schedule;
}

// Saves the header and every fee on the page in one go.
export async function saveSchedule(scheduleId: string, fd: FormData) {
  const user = await requireUser(ROLES);
  const schedule = await ownSchedule(user, scheduleId);
  const path = `/settings/charge-schedules/${schedule.id}`;
  const header = await readHeader(fd, user.practiceId, path);

  const changes: { id: string; feeCents: number; revenueCode: string | null; allowedCents: number | null }[] = [];
  for (const item of schedule.items) {
    if (!fd.has(`fee_${item.id}`)) continue;
    const feeText = str(fd, `fee_${item.id}`).replace(/[$,\s]/g, "");
    const fee = feeText === "" ? 0 : Number(feeText);
    if (!Number.isFinite(fee) || fee < 0) back(path, { error: `${item.code}: the fee only accepts positive values.` });
    const allowText = str(fd, `allow_${item.id}`).replace(/[$,\s]/g, "");
    const allowed = allowText === "" ? null : Number(allowText);
    if (allowed !== null && (!Number.isFinite(allowed) || allowed < 0)) back(path, { error: `${item.code}: the allowed amount only accepts positive values.` });
    const revenue = str(fd, `rev_${item.id}`).toUpperCase();
    if (revenue.length > 4) back(path, { error: `${item.code}: the revenue code is limited to 4 characters.` });
    const feeCents = Math.round(fee * 100);
    const allowedCents = allowed === null ? null : Math.round(allowed * 100);
    if (feeCents !== item.feeCents || (revenue || null) !== item.revenueCode || allowedCents !== item.allowedCents) changes.push({ id: item.id, feeCents, revenueCode: revenue || null, allowedCents });
  }
  await prisma.$transaction([
    prisma.chargeSchedule.update({ where: { id: schedule.id }, data: header }),
    ...changes.map((c) => prisma.chargeScheduleItem.update({ where: { id: c.id }, data: { feeCents: c.feeCents, revenueCode: c.revenueCode, allowedCents: c.allowedCents } })),
  ]);
  await logAudit(user.practiceId, user.id, "UPDATE_CHARGE_SCHEDULE", "ChargeSchedule", schedule.id, `${header.name} · ${changes.length} fee(s) changed`);
  back(path, { ok: `Schedule saved${changes.length ? ` — ${changes.length} fee${changes.length === 1 ? "" : "s"} changed` : ""}.` });
}

export async function addScheduleCode(scheduleId: string, fd: FormData) {
  const user = await requireUser(ROLES);
  const schedule = await ownSchedule(user, scheduleId);
  const path = `/settings/charge-schedules/${schedule.id}`;
  const code = str(fd, "code").toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) back(path, { error: "A billing code is 5 characters (CPT or HCPCS)." });
  if (schedule.items.some((i) => i.code === code)) back(path, { error: `${code} is already on this schedule.` });
  const fee = Number(str(fd, "fee").replace(/[$,\s]/g, "") || "0");
  if (!Number.isFinite(fee) || fee < 0) back(path, { error: "The fee only accepts positive values." });
  const revenue = str(fd, "revenueCode").toUpperCase();
  if (revenue.length > 4) back(path, { error: "The revenue code is limited to 4 characters." });
  const allowText = str(fd, "allowed").replace(/[$,\s]/g, "");
  const allowed = allowText === "" ? null : Number(allowText);
  if (allowed !== null && (!Number.isFinite(allowed) || allowed < 0)) back(path, { error: "The allowed amount only accepts positive values." });
  const known = await prisma.practiceCode.findFirst({ where: { practiceId: user.practiceId, type: "CPT", code } });
  // The description comes from the practice's own list, then the code library.
  const library = known ? null : await prisma.masterCode.findFirst({ where: { codeSet: { in: ["CPT", "HCPCS"] }, code } });
  const description = str(fd, "description").slice(0, 300) || known?.description || library?.description.slice(0, 300) || code;
  await prisma.chargeScheduleItem.create({ data: { scheduleId: schedule.id, code, description, feeCents: Math.round(fee * 100), revenueCode: revenue || null, allowedCents: allowed === null ? null : Math.round(allowed * 100) } });
  await logAudit(user.practiceId, user.id, "ADD_CHARGE_SCHEDULE_CODE", "ChargeSchedule", schedule.id, code);
  back(path, { ok: `${code} added.` });
}

export async function removeScheduleCode(scheduleId: string, itemId: string) {
  const user = await requireUser(ROLES);
  const schedule = await ownSchedule(user, scheduleId);
  const item = schedule.items.find((i) => i.id === itemId);
  if (item) {
    await prisma.chargeScheduleItem.delete({ where: { id: item.id } });
    await logAudit(user.practiceId, user.id, "REMOVE_CHARGE_SCHEDULE_CODE", "ChargeSchedule", schedule.id, item.code);
  }
  back(`/settings/charge-schedules/${schedule.id}`, { ok: item ? `${item.code} removed from this schedule.` : "Nothing to remove." });
}

// Import a fee file: codes already on the schedule get the new fee, new codes are added. Nothing is removed.
export async function importSchedule(scheduleId: string, fd: FormData) {
  const user = await requireUser(ROLES);
  const schedule = await ownSchedule(user, scheduleId);
  const path = `/settings/charge-schedules/${schedule.id}`;
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) back(path, { error: "Choose the fee file (CSV) to import." });
  if ((file as File).size > MAX_IMPORT_BYTES) back(path, { error: "The file is too large (2 MB at most)." });
  const { rows, problems } = parseScheduleCsv(await (file as File).text());
  if (rows.length === 0) back(path, { error: `No fees could be read from the file. ${problems[0] ?? "Columns: Billing Code, Description, Fee, Revenue Code."}` });

  const byCode = new Map(schedule.items.map((i) => [i.code, i]));
  const names = new Map((await prisma.practiceCode.findMany({ where: { practiceId: user.practiceId, type: "CPT" }, select: { code: true, description: true } })).map((c) => [c.code.toUpperCase(), c.description]));
  let added = 0;
  let updated = 0;
  await prisma.$transaction(
    rows.flatMap((r) => {
      const have = byCode.get(r.code);
      if (!have) {
        added++;
        return [prisma.chargeScheduleItem.create({ data: { scheduleId: schedule.id, code: r.code, description: r.description || names.get(r.code) || r.code, feeCents: r.feeCents, revenueCode: r.revenueCode, allowedCents: r.allowedCents } })];
      }
      // An allowed column left blank in the file keeps the amount already on the schedule.
      const allowedCents = r.allowedCents ?? have.allowedCents;
      if (have.feeCents === r.feeCents && have.revenueCode === r.revenueCode && have.allowedCents === allowedCents && (!r.description || r.description === have.description)) return [];
      updated++;
      return [prisma.chargeScheduleItem.update({ where: { id: have.id }, data: { feeCents: r.feeCents, revenueCode: r.revenueCode, allowedCents, ...(r.description ? { description: r.description } : {}) } })];
    })
  );
  await logAudit(user.practiceId, user.id, "IMPORT_CHARGE_SCHEDULE", "ChargeSchedule", schedule.id, `${added} added, ${updated} updated, ${problems.length} skipped`);
  back(path, { ok: `Import finished: ${added} code${added === 1 ? "" : "s"} added, ${updated} updated${problems.length ? `, ${problems.length} row${problems.length === 1 ? "" : "s"} skipped (${problems[0]})` : ""}.` });
}

export async function copySchedule(scheduleId: string) {
  const user = await requireUser(ROLES);
  const schedule = await ownSchedule(user, scheduleId);
  const copy = await prisma.chargeSchedule.create({
    data: {
      practiceId: user.practiceId,
      name: `${schedule.name} (copy)`.slice(0, 120),
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      // A copy starts switched off so two schedules don't cover the same visits by accident.
      active: false,
      locationIds: schedule.locationIds,
      providerIds: schedule.providerIds,
      payerIds: schedule.payerIds,
      items: { create: schedule.items.map((i) => ({ code: i.code, description: i.description, feeCents: i.feeCents, revenueCode: i.revenueCode, allowedCents: i.allowedCents })) },
    },
  });
  await logAudit(user.practiceId, user.id, "COPY_CHARGE_SCHEDULE", "ChargeSchedule", copy.id, `from ${schedule.name}`);
  back(`/settings/charge-schedules/${copy.id}`, { ok: "Copy created. It is switched off until you set its dates and tick Active." });
}
