import "server-only";
import type { ChargeSchedule } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Charge schedules: the practice's fee for each billing code, for a set of sites of service, providers and
// insurances over a date range. A visit's charges take their fee from the schedule that covers the visit; a code
// with no fee on that schedule falls back to the practice code list.

export function parseIds(value: string | null | undefined): string[] {
  try {
    const v = JSON.parse(value ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export type VisitScope = { date: Date; locationId?: string | null; providerId?: string | null; payerId?: string | null };

// A scope list that is empty applies to everything; otherwise the visit's value has to be in it.
const covers = (ids: string[], id: string | null | undefined) => ids.length === 0 || Boolean(id && ids.includes(id));

export function scheduleCovers(s: Pick<ChargeSchedule, "active" | "startDate" | "endDate" | "locationIds" | "providerIds" | "payerIds">, v: VisitScope) {
  if (!s.active) return false;
  if (s.startDate.getTime() > v.date.getTime()) return false;
  if (s.endDate && s.endDate.getTime() + 86_399_000 < v.date.getTime()) return false;
  return covers(parseIds(s.locationIds), v.locationId) && covers(parseIds(s.providerIds), v.providerId) && covers(parseIds(s.payerIds), v.payerId);
}

// The schedule for a visit: of those that cover it, the one naming the most of site / provider / insurance, then
// the one that started most recently.
export async function scheduleFor(practiceId: string, v: VisitScope) {
  const schedules = await prisma.chargeSchedule.findMany({ where: { practiceId, active: true, startDate: { lte: v.date } }, include: { items: true } });
  const specific = (s: ChargeSchedule) => [s.locationIds, s.providerIds, s.payerIds].filter((x) => parseIds(x).length > 0).length;
  const match = schedules.filter((s) => scheduleCovers(s, v)).sort((a, b) => specific(b) - specific(a) || b.startDate.getTime() - a.startDate.getTime())[0];
  if (!match) return null;
  return { id: match.id, name: match.name, fees: new Map(match.items.filter((i) => i.feeCents > 0 || i.allowedCents).map((i) => [i.code.toUpperCase(), i])) };
}

export type VisitSchedule = NonNullable<Awaited<ReturnType<typeof scheduleFor>>>;

// The site, rendering provider and primary insurance of a visit, as a charge schedule sees them.
export async function scheduleForEncounter(practiceId: string, encounterId: string) {
  const e = await prisma.encounter.findFirst({
    where: { id: encounterId, practiceId },
    select: {
      date: true,
      providerId: true,
      appointment: { select: { startsAt: true, locationId: true } },
      patient: { select: { siteOfServiceId: true, insurances: { where: { active: true, rank: "PRIMARY" }, select: { payerId: true }, take: 1 } } },
    },
  });
  if (!e) return null;
  const rendering = await prisma.renderingProvider.findFirst({ where: { practiceId, userId: e.providerId }, select: { id: true } });
  return scheduleFor(practiceId, {
    date: e.appointment?.startsAt ?? e.date,
    locationId: e.appointment?.locationId ?? e.patient.siteOfServiceId,
    providerId: rendering?.id ?? null,
    payerId: e.patient.insurances[0]?.payerId ?? null,
  });
}

// ---- CSV export / import ----

const cell = (v: string | number) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function scheduleCsv(items: { code: string; description: string; feeCents: number; revenueCode: string | null; allowedCents?: number | null }[]) {
  return [["Billing Code", "Description", "Fee", "Revenue Code", "Allowed"], ...items.map((i) => [i.code, i.description, (i.feeCents / 100).toFixed(2), i.revenueCode ?? "", i.allowedCents != null ? (i.allowedCents / 100).toFixed(2) : ""])].map((r) => r.map(cell).join(",")).join("\r\n");
}

function csvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows.filter((r) => r.some((c) => c.trim()));
}

export type ImportedFee = { code: string; description: string; feeCents: number; revenueCode: string | null; allowedCents: number | null };

// Reads a fee file: columns Billing Code, Description, Fee, Revenue Code, Allowed (a header row is optional;
// description, revenue code and the allowed amount may be left out). Returns the rows it could use and the problems found.
export function parseScheduleCsv(text: string): { rows: ImportedFee[]; problems: string[] } {
  const all = csvRows(text.replace(/^\uFEFF/, ""));
  const problems: string[] = [];
  const rows = new Map<string, ImportedFee>();
  all.forEach((r, i) => {
    const code = (r[0] ?? "").trim().toUpperCase();
    if (i === 0 && !/^[A-Z0-9]{5}$/.test(code)) return; // header row
    if (!/^[A-Z0-9]{5}$/.test(code)) {
      problems.push(`Row ${i + 1}: "${(r[0] ?? "").slice(0, 20)}" is not a 5-character billing code.`);
      return;
    }
    // Two columns: code, fee. Three or more: code, description, fee, revenue code.
    const feeText = (r.length === 2 ? r[1] : r[2] ?? "").replace(/[$,\s]/g, "");
    const fee = feeText === "" ? 0 : Number(feeText);
    if (!Number.isFinite(fee) || fee < 0) {
      problems.push(`Row ${i + 1} (${code}): the fee "${feeText.slice(0, 20)}" is not a positive amount.`);
      return;
    }
    const revenue = (r[3] ?? "").trim().toUpperCase();
    if (revenue && !/^[A-Z0-9]{1,4}$/.test(revenue)) {
      problems.push(`Row ${i + 1} (${code}): the revenue code is limited to 4 characters.`);
      return;
    }
    const allowedText = (r[4] ?? "").replace(/[$,\s]/g, "");
    const allowed = allowedText === "" ? null : Number(allowedText);
    if (allowed !== null && (!Number.isFinite(allowed) || allowed < 0)) {
      problems.push(`Row ${i + 1} (${code}): the allowed amount "${allowedText.slice(0, 20)}" is not a positive amount.`);
      return;
    }
    rows.set(code, { code, description: (r.length === 2 ? "" : (r[1] ?? "")).trim().slice(0, 300), feeCents: Math.round(fee * 100), revenueCode: revenue || null, allowedCents: allowed === null ? null : Math.round(allowed * 100) });
  });
  return { rows: [...rows.values()], problems };
}
