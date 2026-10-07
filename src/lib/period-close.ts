import "server-only";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/format";
import { PRE_RELEASE_STATUSES } from "@/lib/claim-format";
import { parseCsv } from "@/lib/patient-import";

// Payment operations: the month-end close with its checklist and frozen snapshot, deposit balancing and bank
// reconciliation, and the cash day sheet. The close sets PracticeSettings.closedThrough, which the posting
// services already refuse to post into.

export const DEPOSIT_STATUSES: Record<string, string> = { OPEN: "Open", DEPOSITED: "Deposited", RECONCILED: "Reconciled" };
const DAY = 86_400_000;

export function periodBounds(period: string) {
  const [y, m] = period.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);
  return { start, end, last: new Date(end.getTime() - 1) };
}
export const periodLabel = (period: string) => periodBounds(period).start.toLocaleDateString("en-US", { month: "long", year: "numeric" });
export const currentPeriod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
export const previousPeriod = (period: string) => {
  const { start } = periodBounds(period);
  const p = new Date(start.getFullYear(), start.getMonth() - 1, 1);
  return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, "0")}`;
};

// What still needs attention before the month can close.
export async function closeChecklist(practiceId: string, period: string) {
  const { start, end } = periodBounds(period);
  const range = { gte: start, lt: end };
  const [openDeposits, unappliedDeposits, unpostedEras, unreleased, openBatchesDue] = await Promise.all([
    prisma.deposit.findMany({ where: { practiceId, postedAt: range, status: { not: "RECONCILED" } }, select: { id: true, payerName: true, totalCents: true, status: true, postedAt: true } }),
    prisma.deposit.findMany({ where: { practiceId, postedAt: range, unappliedCents: { gt: 0 } }, select: { id: true, payerName: true, unappliedCents: true } }),
    prisma.eraFile.findMany({ where: { practiceId, claims: { some: { matchStatus: { not: "POSTED" } } } }, select: { id: true, fileName: true, totalCents: true } }),
    prisma.claim.findMany({ where: { practiceId, status: { in: PRE_RELEASE_STATUSES }, lines: { some: { dosFrom: range } } }, select: { id: true, payerName: true, billedCents: true } }),
    prisma.encounter.count({ where: { practiceId, date: range, status: "READY_FOR_BILLING", claims: { none: {} } } }),
  ]);
  return {
    openDeposits,
    unappliedDeposits,
    unpostedEras,
    unreleased,
    unbilledVisits: openBatchesDue,
    clean: openDeposits.length === 0 && unappliedDeposits.length === 0 && unpostedEras.length === 0 && unreleased.length === 0 && openBatchesDue === 0,
  };
}

// The frozen numbers for the month: charges, payments by method, adjustments, deposits.
export async function periodSnapshot(practiceId: string, period: string) {
  const { start, end } = periodBounds(period);
  const range = { gte: start, lt: end };
  const [charges, deposits, applications, receipts, claims] = await Promise.all([
    prisma.claimLine.aggregate({ where: { claim: { practiceId, status: { not: "VOID" } }, dosFrom: range }, _sum: { chargeCents: true }, _count: { _all: true } }),
    prisma.deposit.findMany({ where: { practiceId, postedAt: range }, select: { payerType: true, paymentMethod: true, totalCents: true, unappliedCents: true } }),
    prisma.paymentApplication.groupBy({ by: ["type"], where: { deposit: { practiceId }, postedAt: range }, _sum: { amountCents: true } }),
    prisma.receipt.aggregate({ where: { practiceId, createdAt: range, voidedAt: null }, _sum: { amountCents: true }, _count: { _all: true } }),
    prisma.claim.count({ where: { practiceId, submittedAt: range } }),
  ]);
  const byMethod: Record<string, number> = {};
  let insurance = 0;
  let patient = 0;
  for (const d of deposits) {
    byMethod[d.paymentMethod] = (byMethod[d.paymentMethod] ?? 0) + d.totalCents;
    if (d.payerType === "PATIENT") patient += d.totalCents;
    else insurance += d.totalCents;
  }
  const adj = applications.find((a) => a.type === "ADJUSTMENT")?._sum.amountCents ?? 0;
  const paid = applications.find((a) => a.type === "PAYMENT")?._sum.amountCents ?? 0;
  return {
    period,
    chargesCents: charges._sum.chargeCents ?? 0,
    chargeLines: charges._count._all,
    claimsSubmitted: claims,
    depositsCount: deposits.length,
    depositsCents: insurance + patient,
    insuranceCents: insurance,
    patientCents: patient,
    byMethod,
    appliedCents: paid,
    adjustmentsCents: adj,
    unappliedCents: deposits.reduce((s, d) => s + d.unappliedCents, 0),
    frontDeskReceipts: receipts._count._all,
    frontDeskCents: receipts._sum.amountCents ?? 0,
  };
}

export async function closePeriod(practiceId: string, period: string, userId: string, note: string | null) {
  const checklist = await closeChecklist(practiceId, period);
  if (!checklist.clean && !note) throw new Error("The checklist is not clear — acknowledge the open items with a note, or clear them first.");
  const snapshot = await periodSnapshot(practiceId, period);
  const { last } = periodBounds(period);
  const existing = await prisma.periodClose.findUnique({ where: { practiceId_period: { practiceId, period } } });
  const close = existing
    ? await prisma.periodClose.update({ where: { id: existing.id }, data: { closedAt: new Date(), closedById: userId, reopenedAt: null, reopenedById: null, reopenReason: null, note, snapshot: JSON.stringify(snapshot) } })
    : await prisma.periodClose.create({ data: { practiceId, period, closedById: userId, note, snapshot: JSON.stringify(snapshot) } });
  // The lock: nothing posts on or before the last day of the closed month.
  const settings = await prisma.practiceSettings.findUnique({ where: { practiceId }, select: { closedThrough: true } });
  if (!settings?.closedThrough || settings.closedThrough < last) await prisma.practiceSettings.update({ where: { practiceId }, data: { closedThrough: last } });
  return { close, snapshot, checklist };
}

export async function reopenPeriod(practiceId: string, period: string, userId: string, reason: string) {
  const close = await prisma.periodClose.findUnique({ where: { practiceId_period: { practiceId, period } } });
  if (!close || close.reopenedAt) throw new Error("That month is not closed.");
  await prisma.periodClose.update({ where: { id: close.id }, data: { reopenedAt: new Date(), reopenedById: userId, reopenReason: reason } });
  // The lock moves back to the latest month that is still closed.
  const latest = await prisma.periodClose.findFirst({ where: { practiceId, reopenedAt: null }, orderBy: { period: "desc" } });
  await prisma.practiceSettings.update({ where: { practiceId }, data: { closedThrough: latest ? periodBounds(latest.period).last : null } });
  return close;
}

// ---- Deposits: balancing and bank reconciliation ----

export async function markDeposited(practiceId: string, depositIds: string[], depositDate: Date, bankAccount: string | null) {
  return prisma.deposit.updateMany({ where: { id: { in: depositIds }, practiceId, status: { not: "RECONCILED" } }, data: { status: "DEPOSITED", depositDate, bankAccount } });
}

export type BankLine = { date: Date; amountCents: number; description: string };

// A bank statement export: finds the date, amount and description columns by header name, else by position.
export function parseBankCsv(text: string): BankLine[] {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (rows.length === 0) return [];
  const head = rows[0].map((h) => h.toLowerCase());
  const find = (names: string[], fallback: number) => {
    const i = head.findIndex((h) => names.some((n) => h.includes(n)));
    return i >= 0 ? i : fallback;
  };
  const hasHeader = head.some((h) => /date|amount|desc|memo/.test(h));
  const di = find(["date"], 0);
  const ai = find(["amount", "credit", "deposit"], 1);
  const xi = find(["desc", "memo", "detail", "narr"], 2);
  const out: BankLine[] = [];
  for (const r of rows.slice(hasHeader ? 1 : 0)) {
    const date = new Date(r[di] ?? "");
    const amount = Math.round(Number(String(r[ai] ?? "").replace(/[$,\s]/g, "")) * 100);
    if (Number.isNaN(date.getTime()) || !Number.isFinite(amount) || amount <= 0) continue;
    out.push({ date, amountCents: amount, description: (r[xi] ?? "").slice(0, 120) });
  }
  return out;
}

// Matches bank credits to deposits by amount within three days of the deposit date (or posted date).
export async function reconcileDeposits(practiceId: string, lines: BankLine[], userId: string) {
  const open = await prisma.deposit.findMany({ where: { practiceId, status: { not: "RECONCILED" } }, orderBy: { postedAt: "asc" } });
  const used = new Set<string>();
  const matched: { line: BankLine; depositId: string; payerName: string }[] = [];
  const unmatched: BankLine[] = [];
  for (const line of lines) {
    const hit = open.find((d) => !used.has(d.id) && d.totalCents === line.amountCents && Math.abs((d.depositDate ?? d.postedAt).getTime() - line.date.getTime()) <= 3 * DAY);
    if (hit) {
      used.add(hit.id);
      matched.push({ line, depositId: hit.id, payerName: hit.payerName });
    } else unmatched.push(line);
  }
  for (const m of matched) {
    await prisma.deposit.update({ where: { id: m.depositId }, data: { status: "RECONCILED", reconciledAt: new Date(), depositDate: m.line.date, bankRef: m.line.description || null } });
  }
  await prisma.bankImport.create({ data: { practiceId, importedById: userId, lines: lines.length, matched: matched.length, unmatched: JSON.stringify(unmatched.map((u) => ({ date: u.date.toISOString().slice(0, 10), amount: u.amountCents, description: u.description }))) } });
  return { matched, unmatched, stillOpen: open.filter((d) => !used.has(d.id)) };
}

// ---- Cash day sheet ----

export async function daySheet(practiceId: string, date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start.getTime() + DAY);
  const range = { gte: start, lt: end };
  const [charges, deposits, applications, receipts, users] = await Promise.all([
    prisma.charge.findMany({ where: { practiceId, encounter: { date: range } }, select: { amountCents: true } }),
    prisma.deposit.findMany({ where: { practiceId, postedAt: range }, select: { id: true, payerType: true, payerName: true, paymentMethod: true, totalCents: true, unappliedCents: true, status: true, checkNumber: true } }),
    prisma.paymentApplication.findMany({ where: { deposit: { practiceId }, postedAt: range }, select: { type: true, amountCents: true } }),
    prisma.receipt.findMany({ where: { practiceId, createdAt: range }, select: { number: true, kind: true, method: true, amountCents: true, voidedAt: true, collectedById: true, patient: { select: { firstName: true, lastName: true } } } }),
    prisma.user.findMany({ where: { memberships: { some: { practiceId } } }, select: { id: true, name: true } }),
  ]);
  const name = new Map(users.map((u) => [u.id, u.name]));
  const byUser = new Map<string, { n: number; cents: number; byMethod: Record<string, number> }>();
  for (const r of receipts) {
    if (r.voidedAt) continue;
    const k = name.get(r.collectedById ?? "") ?? "Unknown";
    const g = byUser.get(k) ?? { n: 0, cents: 0, byMethod: {} };
    g.n++;
    g.cents += r.amountCents;
    g.byMethod[r.method] = (g.byMethod[r.method] ?? 0) + r.amountCents;
    byUser.set(k, g);
  }
  const deskCents = [...byUser.values()].reduce((s, g) => s + g.cents, 0);
  const patientDeposits = deposits.filter((d) => d.payerType === "PATIENT").reduce((s, d) => s + d.totalCents, 0);
  return {
    date: start,
    chargesCents: charges.reduce((s, c) => s + c.amountCents, 0),
    chargeCount: charges.length,
    deposits,
    paymentsCents: applications.filter((a) => a.type === "PAYMENT").reduce((s, a) => s + a.amountCents, 0),
    adjustmentsCents: applications.filter((a) => a.type === "ADJUSTMENT").reduce((s, a) => s + a.amountCents, 0),
    receipts,
    byUser: [...byUser.entries()].map(([user, g]) => ({ user, ...g })),
    deskCents,
    patientDepositsCents: patientDeposits,
    varianceCents: deskCents - patientDeposits,
    summary: `${formatMoney(deskCents)} taken at the desk · ${formatMoney(deposits.reduce((s, d) => s + d.totalCents, 0))} in ${deposits.length} deposit${deposits.length === 1 ? "" : "s"}`,
  };
}
