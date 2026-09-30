import "server-only";
import { prisma } from "@/lib/prisma";
import { agingBucket, patientName } from "@/lib/format";
import { OPEN_AR_STATUSES, claimNumber, claimStatusLabel } from "@/lib/claim-format";

export const REPORTS: [string, string, string][] = [
  ["collections", "Collections", "Money received by payer and payment method"],
  ["cpt", "Charges & collections by code", "Billed, paid, adjusted and collection rate per CPT/HCPCS"],
  ["provider", "Provider productivity", "Visits, charges and payments per rendering provider"],
  ["aging", "Aging by payer", "Open balances by payer and age"],
  ["patient_aging", "Patient balances", "What patients owe, oldest first"],
  ["credits", "Credit balances", "Overpaid claims and unapplied deposits (refunds due)"],
  ["denials", "Denials by reason", "Denied claims grouped by payer reason"],
  ["ledger", "Patient ledger", "Every charge, payment and adjustment for one patient"],
];

export type Table = { columns: string[]; rows: (string | number)[][]; totals?: (string | number)[]; money?: number[] };

const BUCKETS = ["0-30 days", "31-60 days", "61-90 days", "90+ days"];
const $ = (c: number) => Math.round(c) / 100;
const balanceOf = (c: { billedCents: number; paidCents: number; adjustedCents: number }) => Math.max(c.billedCents - c.paidCents - c.adjustedCents, 0);
const ageDays = (d: Date | null) => (d ? Math.floor((Date.now() - d.getTime()) / 86_400_000) : 0);

export async function runReport(practiceId: string, key: string, from: Date, to: Date, patientId?: string): Promise<Table> {
  const range = { gte: from, lte: to };
  switch (key) {
    case "collections": {
      const deps = await prisma.deposit.findMany({ where: { practiceId, postedAt: range }, orderBy: { postedAt: "asc" } });
      const groups = new Map<string, { n: number; total: number; applied: number }>();
      for (const d of deps) {
        const k = `${d.payerType === "PATIENT" ? "Patient payments" : d.payerName}|${d.paymentMethod}`;
        const g = groups.get(k) ?? { n: 0, total: 0, applied: 0 };
        g.n++;
        g.total += d.totalCents;
        g.applied += d.totalCents - d.unappliedCents;
        groups.set(k, g);
      }
      const rows = [...groups.entries()].sort((a, b) => b[1].total - a[1].total).map(([k, g]) => [...k.split("|"), g.n, $(g.total), $(g.applied), $(g.total - g.applied)]);
      const t = [...groups.values()].reduce((s, g) => ({ n: s.n + g.n, total: s.total + g.total, applied: s.applied + g.applied }), { n: 0, total: 0, applied: 0 });
      return { columns: ["Payer", "Method", "Deposits", "Received", "Applied", "Unapplied"], rows, totals: ["Total", "", t.n, $(t.total), $(t.applied), $(t.total - t.applied)], money: [3, 4, 5] };
    }
    case "cpt": {
      const lines = await prisma.claimLine.findMany({ where: { dosFrom: range, claim: { practiceId, status: { not: "VOID" }, payerRank: "PRIMARY" } } });
      const g = new Map<string, { units: number; billed: number; paid: number; adj: number }>();
      for (const l of lines) {
        const r = g.get(l.cptCode) ?? { units: 0, billed: 0, paid: 0, adj: 0 };
        r.units += l.units;
        r.billed += l.chargeCents;
        r.paid += l.paidCents;
        r.adj += l.adjustedCents;
        g.set(l.cptCode, r);
      }
      const codes = await prisma.practiceCode.findMany({ where: { practiceId, code: { in: [...g.keys()] } } });
      const desc = new Map(codes.map((c) => [c.code, c.description]));
      const rows = [...g.entries()]
        .sort((a, b) => b[1].billed - a[1].billed)
        .map(([code, r]) => [code, desc.get(code) ?? "", r.units, $(r.billed), $(r.paid), $(r.adj), r.billed - r.adj > 0 ? `${Math.round((r.paid / (r.billed - r.adj)) * 100)}%` : "—"]);
      const t = [...g.values()].reduce((s, r) => ({ units: s.units + r.units, billed: s.billed + r.billed, paid: s.paid + r.paid, adj: s.adj + r.adj }), { units: 0, billed: 0, paid: 0, adj: 0 });
      return { columns: ["Code", "Description", "Units", "Billed", "Paid", "Adjusted", "Net collection"], rows, totals: ["Total", "", t.units, $(t.billed), $(t.paid), $(t.adj), ""], money: [3, 4, 5] };
    }
    case "provider": {
      const encs = await prisma.encounter.findMany({ where: { practiceId, date: range }, include: { provider: true, charges: true, claims: { where: { status: { not: "VOID" } } } } });
      const g = new Map<string, { visits: number; charges: number; paid: number; balance: number }>();
      for (const e of encs) {
        const r = g.get(e.provider.name) ?? { visits: 0, charges: 0, paid: 0, balance: 0 };
        r.visits++;
        r.charges += e.charges.reduce((s, c) => s + c.amountCents * c.units, 0);
        r.paid += e.claims.reduce((s, c) => s + c.paidCents, 0);
        r.balance += e.claims.filter((c) => c.payerRank === "PRIMARY").reduce((s, c) => s + balanceOf(c), 0);
        g.set(e.provider.name, r);
      }
      const rows = [...g.entries()].sort((a, b) => b[1].charges - a[1].charges).map(([n, r]) => [n, r.visits, $(r.charges), $(r.paid), $(r.balance), r.visits ? $(r.charges / r.visits) : 0]);
      return { columns: ["Provider", "Visits", "Charges", "Paid", "Open balance", "Charges per visit"], rows, money: [2, 3, 4, 5] };
    }
    case "aging": {
      const claims = await prisma.claim.findMany({ where: { practiceId, status: { in: [...OPEN_AR_STATUSES, "TRANSFERRED"] }, balanceResponsibility: "INSURANCE" } });
      const g = new Map<string, number[]>();
      for (const c of claims) {
        const bal = balanceOf(c);
        if (!bal) continue;
        const r = g.get(c.payerName) ?? [0, 0, 0, 0];
        r[BUCKETS.indexOf(agingBucket(ageDays(c.submittedAt ?? c.createdAt)))] += bal;
        g.set(c.payerName, r);
      }
      const rows = [...g.entries()].map(([p, r]) => [p, ...r.map($), $(r.reduce((a, b) => a + b, 0))]).sort((a, b) => Number(b[5]) - Number(a[5]));
      const t = [0, 1, 2, 3].map((i) => [...g.values()].reduce((s, r) => s + r[i], 0));
      return { columns: ["Payer", ...BUCKETS, "Total"], rows, totals: ["Total", ...t.map($), $(t.reduce((a, b) => a + b, 0))], money: [1, 2, 3, 4, 5] };
    }
    case "patient_aging": {
      const claims = await prisma.claim.findMany({ where: { practiceId, balanceResponsibility: "PATIENT", status: { notIn: ["VOID", "PAID", "WRITTEN_OFF"] } }, include: { patient: true } });
      const g = new Map<string, { name: string; mrn: string; r: number[]; phone: string }>();
      for (const c of claims) {
        const bal = balanceOf(c);
        if (!bal) continue;
        const e = g.get(c.patientId) ?? { name: patientName(c.patient), mrn: c.patient.mrn, r: [0, 0, 0, 0], phone: c.patient.phone ?? "" };
        e.r[BUCKETS.indexOf(agingBucket(ageDays(c.submittedAt ?? c.createdAt)))] += bal;
        g.set(c.patientId, e);
      }
      const rows = [...g.values()].map((e) => [e.name, e.mrn, e.phone, ...e.r.map($), $(e.r.reduce((a, b) => a + b, 0))]).sort((a, b) => Number(b[7]) - Number(a[7]));
      return { columns: ["Patient", "MRN", "Phone", ...BUCKETS, "Total"], rows, money: [3, 4, 5, 6, 7] };
    }
    case "credits": {
      const [claims, deps] = await Promise.all([
        prisma.claim.findMany({ where: { practiceId, status: { not: "VOID" } }, include: { patient: true } }),
        prisma.deposit.findMany({ where: { practiceId, unappliedCents: { gt: 0 } } }),
      ]);
      const rows: (string | number)[][] = [];
      for (const c of claims) {
        const over = c.paidCents + c.adjustedCents - c.billedCents;
        if (over > 0) rows.push(["Overpaid claim", claimNumber(c), patientName(c.patient), c.payerName, $(over)]);
      }
      for (const d of deps) rows.push(["Unapplied deposit", d.checkNumber ?? "", d.payerType === "PATIENT" ? "Patient payment" : "", d.payerName, $(d.unappliedCents)]);
      return { columns: ["Type", "Reference", "Patient", "Payer", "Amount"], rows, totals: ["Total", "", "", "", rows.reduce((s, r) => s + Number(r[4]), 0)], money: [4] };
    }
    case "denials": {
      const claims = await prisma.claim.findMany({ where: { practiceId, status: "DENIED", updatedAt: range } });
      const g = new Map<string, { n: number; cents: number }>();
      for (const c of claims) {
        const k = `${c.payerName}|${(c.denialReason ?? "No reason recorded").slice(0, 120)}`;
        const r = g.get(k) ?? { n: 0, cents: 0 };
        r.n++;
        r.cents += c.billedCents;
        g.set(k, r);
      }
      return {
        columns: ["Payer", "Reason", "Claims", "Billed"],
        rows: [...g.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, r]) => [...k.split("|"), r.n, $(r.cents)]),
        money: [3],
      };
    }
    case "ledger": {
      if (!patientId) return { columns: ["Pick a patient"], rows: [] };
      const claims = await prisma.claim.findMany({
        where: { practiceId, patientId, status: { not: "VOID" } },
        include: { lines: true, applications: { include: { deposit: true } }, encounter: true },
        orderBy: { createdAt: "asc" },
      });
      // Build entries first, then sort by date and run the balance in that order.
      const entries: { date: string; order: number; type: string; detail: string; charge: number; payment: number; adj: number }[] = [];
      for (const c of claims) {
        if (c.payerRank === "PRIMARY")
          for (const l of c.lines) entries.push({ date: l.dosFrom.toISOString().slice(0, 10), order: 0, type: "Charge", detail: `${l.cptCode}${l.modifiers ? `-${l.modifiers}` : ""} · ${claimNumber(c)}`, charge: l.chargeCents, payment: 0, adj: 0 });
        for (const a of c.applications)
          entries.push({
            date: a.postedAt.toISOString().slice(0, 10),
            order: 1,
            type: a.type === "ADJUSTMENT" ? "Adjustment" : a.deposit.payerType === "PATIENT" ? "Patient payment" : "Insurance payment",
            detail: `${a.deposit.payerName}${a.deposit.checkNumber ? ` #${a.deposit.checkNumber}` : ""} · ${claimNumber(c)} (${claimStatusLabel[c.status] ?? c.status})`,
            charge: 0,
            payment: a.type === "ADJUSTMENT" ? 0 : a.amountCents,
            adj: a.type === "ADJUSTMENT" ? a.amountCents : 0,
          });
      }
      entries.sort((x, y) => x.date.localeCompare(y.date) || x.order - y.order);
      let running = 0;
      const rows = entries.map((e) => {
        running += e.charge - e.payment - e.adj;
        return [e.date, e.type, e.detail, e.charge ? $(e.charge) : "", e.payment ? $(e.payment) : "", e.adj ? $(e.adj) : "", $(running)];
      });
      return { columns: ["Date", "Type", "Detail", "Charge", "Payment", "Adjustment", "Balance"], rows, money: [3, 4, 5, 6] };
    }
  }
  return { columns: [], rows: [] };
}

export function toCsv(t: Table) {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [t.columns, ...t.rows, ...(t.totals ? [t.totals] : [])].map((r) => r.map(esc).join(",")).join("\r\n");
}

export function reportRange(sp: { from?: string; to?: string }) {
  const now = new Date();
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? new Date(`${sp.from}T00:00:00`) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? new Date(`${sp.to}T23:59:59`) : now;
  return { from, to };
}

