import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EDITABLE_CLAIM_STATUSES, claimStatusLabel } from "@/lib/claim-format";

// Claims dashboard: every open claim sorted into the bucket a biller works it from, with filters and
// timely-filing warnings. Used by /billing/claims and by previous / next on the claim screen.

export type ClaimFilters = {
  bucket?: string;
  dateType?: string;
  from?: string;
  to?: string;
  ageMin?: string;
  status?: string;
  rank?: string;
  insType?: string;
  payer?: string;
  patient?: string;
  mrn?: string;
  location?: string;
  provider?: string;
  referrer?: string;
  cpt?: string;
  balOp?: string;
  bal?: string;
};

export const FILTER_KEYS: (keyof ClaimFilters)[] = ["dateType", "from", "to", "ageMin", "status", "rank", "insType", "payer", "patient", "mrn", "location", "provider", "referrer", "cpt", "balOp", "bal"];

// Days a payer allows to file when its directory entry doesn't say, and how early to warn.
const DEFAULT_FILING_DAYS = 365;
const DEFAULT_ALERT_DAYS = 30;
const CLOSED = ["PAID", "WRITTEN_OFF"];
const WITH_PAYER = ["DENIED", "EDI_REJECTED", "APPEAL"];
const DAY = 86_400_000;

// The overview rows, in the order a claim moves through them. A claim sits in the row for its status; the
// last rows are cross-cutting views (a claim there also appears under its status).
export const BUCKETS: { key: string; label: string; hint: string; status?: string }[] = [
  { key: "DRAFT", status: "DRAFT", label: "Pre-release – needs fixing", hint: "Generated from a visit; a claim edit must be fixed before it can be billed" },
  { key: "READY", status: "READY", label: "Pre-release – ready to bill", hint: "Generated and clean; waiting in the pre-release queue for billing to bill it" },
  { key: "HOLD", status: "HOLD", label: "On hold", hint: "Held by a biller" },
  { key: "EDI_REJECTED", status: "EDI_REJECTED", label: "EDI rejections", hint: "Rejected by the clearinghouse — fix and resubmit" },
  { key: "SUBMITTED", status: "SUBMITTED", label: "EDI – awaiting payer response", hint: "Sent, no answer from the payer yet" },
  { key: "ACCEPTED", status: "ACCEPTED", label: "EDI – payer received", hint: "The payer has the claim" },
  { key: "DENIED", status: "DENIED", label: "Denied", hint: "Denied by the payer" },
  { key: "APPEAL", status: "APPEAL", label: "Under appeal", hint: "An appeal is with the payer" },
  { key: "PARTIAL", status: "PARTIAL", label: "Partially paid", hint: "Paid in part, balance open" },
  { key: "TRANSFERRED", status: "TRANSFERRED", label: "Balance to next payer", hint: "Paid by this payer; the rest moved to the next coverage" },
  { key: "DELINQUENT", status: "DELINQUENT", label: "Delinquent", hint: "Past due" },
  { key: "IN_COLLECTION", status: "IN_COLLECTION", label: "In collection", hint: "Sent to collections" },
  { key: "PAID", status: "PAID", label: "Paid", hint: "Paid in full" },
  { key: "WRITTEN_OFF", status: "WRITTEN_OFF", label: "Written off", hint: "Balance written off" },
  { key: "PATIENT", label: "Patient responsibility – pending statement", hint: "The patient owes the balance" },
  { key: "CREDIT", label: "Credit balances", hint: "Paid more than billed — refund or reapply" },
];

// Views reached from the tiles at the top rather than from an overview row.
export const TILE_VIEWS: Record<string, string> = {
  UNBILLED: "Unbilled — not yet sent to a payer",
  TF_APPROACHING: "Approaching timely filing",
  TF_PAST: "Past timely filing",
};

const claimSelect = {
  id: true,
  createdAt: true,
  submittedAt: true,
  status: true,
  payerRank: true,
  payerName: true,
  billedCents: true,
  paidCents: true,
  adjustedCents: true,
  balanceResponsibility: true,
  patientId: true,
  patient: { select: { firstName: true, lastName: true, middleName: true, mrn: true } },
  payer: { select: { timelyFilingLimit: true, timelyFilingUnit: true, timelyFilingAlertDays: true } },
  renderingProvider: { select: { name: true } },
  serviceLocation: { select: { name: true } },
  lines: { select: { dosFrom: true }, orderBy: { lineNumber: "asc" as const } },
} satisfies Prisma.ClaimSelect;

type ClaimRow = Prisma.ClaimGetPayload<{ select: typeof claimSelect }>;

export type DashboardClaim = ClaimRow & {
  dos: Date;
  balance: number;
  // Days left to file with the payer; only for claims that haven't gone out yet.
  filing: "APPROACHING" | "PAST" | null;
  filingDaysLeft: number | null;
};

function day(value: string | undefined, end = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T${end ? "23:59:59" : "00:00:00"}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function filingDays(p: ClaimRow["payer"]) {
  if (!p?.timelyFilingLimit) return DEFAULT_FILING_DAYS;
  return p.timelyFilingLimit * (p.timelyFilingUnit === "YEARS" ? 365 : p.timelyFilingUnit === "MONTHS" ? 30 : 1);
}

function decorate(c: ClaimRow, now: number): DashboardClaim {
  const dos = c.lines.length ? new Date(Math.min(...c.lines.map((l) => l.dosFrom.getTime()))) : c.createdAt;
  const unsent = EDITABLE_CLAIM_STATUSES.includes(c.status);
  const daysLeft = unsent ? filingDays(c.payer) - Math.floor((now - dos.getTime()) / DAY) : null;
  const alert = c.payer?.timelyFilingAlertDays ?? DEFAULT_ALERT_DAYS;
  return {
    ...c,
    dos,
    balance: c.billedCents - c.paidCents - c.adjustedCents,
    filingDaysLeft: daysLeft,
    filing: daysLeft === null ? null : daysLeft < 0 ? "PAST" : daysLeft <= alert ? "APPROACHING" : null,
  };
}

export function inBucket(c: DashboardClaim, key: string) {
  switch (key) {
    case "PATIENT":
      return c.balanceResponsibility === "PATIENT" && c.balance > 0 && !CLOSED.includes(c.status) && !WITH_PAYER.includes(c.status);
    case "CREDIT":
      return c.balance < 0;
    case "UNBILLED":
      return EDITABLE_CLAIM_STATUSES.includes(c.status);
    case "TF_APPROACHING":
      return c.filing === "APPROACHING";
    case "TF_PAST":
      return c.filing === "PAST";
    default:
      return c.status === key;
  }
}

const byPatient = (a: DashboardClaim, b: DashboardClaim) =>
  a.patient.lastName.localeCompare(b.patient.lastName) || a.patient.firstName.localeCompare(b.patient.firstName) || a.dos.getTime() - b.dos.getTime() || a.id.localeCompare(b.id);

// Every non-void claim that passes the filter panel, sorted by patient then date of service.
export async function filteredClaims(practiceId: string, f: ClaimFilters) {
  const where: Prisma.ClaimWhereInput = {
    practiceId,
    status: f.status && f.status in claimStatusLabel && f.status !== "VOID" ? f.status : { not: "VOID" },
    ...(f.rank ? { payerRank: f.rank } : {}),
    ...(f.payer ? { payerId: f.payer } : {}),
    ...(f.insType ? { payer: { insuranceType: f.insType } } : {}),
    ...(f.location ? { serviceLocationId: f.location } : {}),
    ...(f.provider ? { renderingProviderId: f.provider } : {}),
    ...(f.referrer ? { referringProviderId: f.referrer } : {}),
    ...(f.cpt?.trim() ? { lines: { some: { cptCode: { startsWith: f.cpt.trim().toUpperCase() } } } } : {}),
    ...(f.patient?.trim() || f.mrn?.trim()
      ? {
          patient: {
            ...(f.mrn?.trim() ? { mrn: { startsWith: f.mrn.trim() } } : {}),
            ...(f.patient?.trim() ? { OR: [{ lastName: { contains: f.patient.trim() } }, { firstName: { contains: f.patient.trim() } }] } : {}),
          },
        }
      : {}),
  };
  const now = Date.now();
  let claims = (await prisma.claim.findMany({ where, select: claimSelect })).map((c) => decorate(c, now));

  const from = day(f.from);
  const to = day(f.to, true);
  if (from || to) {
    const pick = (c: DashboardClaim) => (f.dateType === "created" ? c.createdAt : f.dateType === "submitted" ? c.submittedAt : c.dos);
    claims = claims.filter((c) => {
      const d = pick(c);
      return d !== null && (!from || d >= from) && (!to || d <= to);
    });
  }
  const ageMin = Number(f.ageMin);
  if (f.ageMin && Number.isFinite(ageMin) && ageMin > 0) claims = claims.filter((c) => (now - c.dos.getTime()) / DAY >= ageMin);
  const bal = f.bal ? Number(f.bal.replace(/[$,\s]/g, "")) : NaN;
  if (Number.isFinite(bal)) claims = claims.filter((c) => (f.balOp === "lte" ? c.balance <= bal * 100 : c.balance >= bal * 100));
  return claims.sort(byPatient);
}

export async function claimsDashboard(practiceId: string, f: ClaimFilters) {
  const hasFilters = FILTER_KEYS.some((k) => Boolean(f[k]) && !(k === "dateType" && !f.from && !f.to) && !(k === "balOp" && !f.bal));
  const [claims, everything, lastStatement] = await Promise.all([
    filteredClaims(practiceId, f),
    hasFilters ? filteredClaims(practiceId, {}) : null,
    prisma.statement.findFirst({ where: { practiceId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  // The tiles describe the whole practice, whatever the filter panel is narrowing the overview to.
  const all = everything ?? claims;
  const count = (key: string) => all.filter((c) => inBucket(c, key)).length;

  const overview = BUCKETS.map((b) => {
    const rows = claims.filter((c) => inBucket(c, b.key));
    return { ...b, count: rows.length, balance: rows.reduce((s, c) => s + c.balance, 0) };
  });
  const selected = f.bucket && (BUCKETS.some((b) => b.key === f.bucket) || f.bucket in TILE_VIEWS) ? f.bucket : (overview.find((b) => b.count > 0)?.key ?? "DRAFT");
  const list = claims.filter((c) => inBucket(c, selected));

  return {
    tiles: { unbilled: count("UNBILLED"), approaching: count("TF_APPROACHING"), denied: count("DENIED"), past: count("TF_PAST"), lastStatement: lastStatement?.createdAt ?? null },
    overview,
    selected,
    selectedLabel: BUCKETS.find((b) => b.key === selected)?.label ?? TILE_VIEWS[selected],
    list,
    hasFilters,
    total: claims.length,
  };
}

// The claims before and after this one in its status bucket, in the dashboard's order.
export async function claimNeighbours(practiceId: string, claim: { id: string; status: string }) {
  const peers = await filteredClaims(practiceId, { status: claim.status });
  const i = peers.findIndex((c) => c.id === claim.id);
  return { previous: i > 0 ? peers[i - 1].id : null, next: i >= 0 && i < peers.length - 1 ? peers[i + 1].id : null, position: i + 1, total: peers.length };
}
