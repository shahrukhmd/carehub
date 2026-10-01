import "server-only";
import { prisma } from "@/lib/prisma";
import { patientName } from "@/lib/format";
import { flowTimes, minutesBetween } from "@/lib/flow";
import type { Table } from "@/lib/financial-reports";
import { PAY_METHODS } from "@/lib/checkout";

// Practice operations reports (front desk, scheduling, intake, billing throughput).

export const OPS_REPORTS: [string, string, string][] = [
  ["daily", "Daily summary", "Appointments, new and established patients, no-shows, visits, charges and copays by day and provider"],
  ["appointments", "Appointment list", "Every appointment in the period with status, type and provider"],
  ["noshow", "No-shows & cancellations", "No-show and cancellation rates by provider, and the reasons given"],
  ["seen", "Unique patients seen", "Patients seen per provider, with how many were new"],
  ["sources", "Referral sources", "Where new patients came from and how many reached a first visit"],
  ["lag", "Visit-to-claim lag", "Days from visit to claim submission, and visits still unbilled"],
  ["wait", "Wait times", "Average wait (arrived → room) and visit length from the flow board"],
  ["drawer", "Front-desk collections", "Copays and payments taken at the desk by staff member and method — for the cash drawer close"],
];

const day = (d: Date) => d.toISOString().slice(0, 10);
const $ = (c: number) => Math.round(c) / 100;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export async function runOpsReport(practiceId: string, key: string, from: Date, to: Date): Promise<Table> {
  const range = { gte: from, lte: to };
  switch (key) {
    case "daily": {
      const [appts, encs, receipts] = await Promise.all([
        prisma.appointment.findMany({ where: { practiceId, startsAt: range }, include: { provider: true, patient: { select: { id: true, encounters: { select: { date: true }, orderBy: { date: "asc" }, take: 1 } } } } }),
        prisma.encounter.findMany({ where: { practiceId, date: range }, include: { provider: true, charges: true } }),
        prisma.receipt.findMany({ where: { practiceId, createdAt: range, voidedAt: null }, include: { patient: { select: { id: true } } } }),
      ]);
      const g = new Map<string, { appts: number; newPts: number; noShow: number; cancelled: number; visits: number; charges: number; copays: number }>();
      const row = (k: string) => g.get(k) ?? g.set(k, { appts: 0, newPts: 0, noShow: 0, cancelled: 0, visits: 0, charges: 0, copays: 0 }).get(k)!;
      for (const a of appts) {
        const r = row(`${day(a.startsAt)}|${a.provider.name}`);
        r.appts++;
        if (a.status === "NO_SHOW") r.noShow++;
        if (a.status === "CANCELLED") r.cancelled++;
        const first = a.patient.encounters[0]?.date;
        if (!first || day(first) === day(a.startsAt)) r.newPts++;
      }
      for (const e of encs) {
        const r = row(`${day(e.date)}|${e.provider.name}`);
        r.visits++;
        r.charges += e.charges.reduce((s, c) => s + c.amountCents * c.units, 0);
      }
      for (const rc of receipts) {
        const a = rc.appointmentId ? appts.find((x) => x.id === rc.appointmentId) : null;
        const r = row(`${day(rc.createdAt)}|${a?.provider.name ?? "Front desk"}`);
        r.copays += rc.amountCents;
      }
      const rows = [...g.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, r]) => [...k.split("|"), r.appts, r.newPts, r.noShow, r.cancelled, r.visits, $(r.charges), $(r.copays)]);
      const t = [...g.values()].reduce((s, r) => ({ appts: s.appts + r.appts, newPts: s.newPts + r.newPts, noShow: s.noShow + r.noShow, cancelled: s.cancelled + r.cancelled, visits: s.visits + r.visits, charges: s.charges + r.charges, copays: s.copays + r.copays }), { appts: 0, newPts: 0, noShow: 0, cancelled: 0, visits: 0, charges: 0, copays: 0 });
      return { columns: ["Date", "Provider", "Appointments", "New patients", "No-shows", "Cancelled", "Visits", "Charges", "Collected at desk"], rows, totals: ["Total", "", t.appts, t.newPts, t.noShow, t.cancelled, t.visits, $(t.charges), $(t.copays)], money: [7, 8] };
    }
    case "appointments": {
      const appts = await prisma.appointment.findMany({ where: { practiceId, startsAt: range }, include: { provider: true, location: true, patient: true }, orderBy: { startsAt: "asc" }, take: 5000 });
      return {
        columns: ["Date", "Time", "Patient", "MRN", "Provider", "Location", "Type", "Status", "Booked via", "Cancel reason"],
        rows: appts.map((a) => [day(a.startsAt), a.startsAt.toTimeString().slice(0, 5), patientName(a.patient), a.patient.mrn, a.provider.name, a.location.name, a.visitType, a.status, a.bookingSource === "ONLINE" ? "Online" : "Staff", a.cancelReason ?? ""]),
      };
    }
    case "noshow": {
      const appts = await prisma.appointment.findMany({ where: { practiceId, startsAt: range }, include: { provider: true } });
      const g = new Map<string, { n: number; ns: number; c: number; reasons: Map<string, number> }>();
      for (const a of appts) {
        const r = g.get(a.provider.name) ?? { n: 0, ns: 0, c: 0, reasons: new Map() };
        r.n++;
        if (a.status === "NO_SHOW") r.ns++;
        if (a.status === "CANCELLED") {
          r.c++;
          const reason = (a.cancelReason ?? "No reason").split(" — ")[0];
          r.reasons.set(reason, (r.reasons.get(reason) ?? 0) + 1);
        }
        g.set(a.provider.name, r);
      }
      return {
        columns: ["Provider", "Booked", "No-shows", "No-show rate", "Cancelled", "Cancellation rate", "Top cancel reasons"],
        rows: [...g.entries()].map(([p, r]) => [p, r.n, r.ns, pct(r.ns, r.n), r.c, pct(r.c, r.n), [...r.reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} (${v})`).join(", ")]),
      };
    }
    case "seen": {
      const encs = await prisma.encounter.findMany({ where: { practiceId, date: range }, include: { provider: true, patient: { select: { id: true, encounters: { select: { date: true }, orderBy: { date: "asc" }, take: 1 } } } } });
      const g = new Map<string, { pts: Set<string>; newPts: Set<string>; visits: number }>();
      const all = new Set<string>();
      for (const e of encs) {
        const r = g.get(e.provider.name) ?? { pts: new Set(), newPts: new Set(), visits: 0 };
        r.pts.add(e.patientId);
        r.visits++;
        all.add(e.patientId);
        const first = e.patient.encounters[0]?.date;
        if (first && first >= from && first <= to) r.newPts.add(e.patientId);
        g.set(e.provider.name, r);
      }
      return { columns: ["Provider", "Unique patients", "New patients", "Visits", "Visits per patient"], rows: [...g.entries()].map(([p, r]) => [p, r.pts.size, r.newPts.size, r.visits, r.pts.size ? (r.visits / r.pts.size).toFixed(1) : "—"]), totals: ["All providers", all.size, "", encs.length, ""] };
    }
    case "sources": {
      const cases = await prisma.intakeCase.findMany({ where: { practiceId, createdAt: range }, include: { patient: { select: { encounters: { select: { id: true }, take: 1 } } } } });
      const g = new Map<string, { n: number; seen: number; closed: number }>();
      for (const c of cases) {
        const k = `${c.referralSourceType ?? "Not recorded"}|${c.referralSourceName ?? ""}`;
        const r = g.get(k) ?? { n: 0, seen: 0, closed: 0 };
        r.n++;
        if (c.patient.encounters.length) r.seen++;
        if (c.stage === "CLOSED") r.closed++;
        g.set(k, r);
      }
      return { columns: ["Source type", "Source", "Referrals", "Reached a visit", "Conversion", "Closed without visit"], rows: [...g.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, r]) => [...k.split("|"), r.n, r.seen, pct(r.seen, r.n), Math.max(r.closed - r.seen, 0)]) };
    }
    case "lag": {
      const encs = await prisma.encounter.findMany({ where: { practiceId, date: range }, include: { provider: true, claims: { where: { status: { not: "VOID" }, payerRank: "PRIMARY" }, orderBy: { createdAt: "asc" }, take: 1 }, charges: { select: { id: true } } } });
      const g = new Map<string, { days: number[]; unbilled: number; old: number }>();
      const now = Date.now();
      for (const e of encs) {
        const r = g.get(e.provider.name) ?? { days: [], unbilled: 0, old: 0 };
        const c = e.claims[0];
        if (c?.submittedAt) r.days.push((c.submittedAt.getTime() - e.date.getTime()) / 86_400_000);
        else if (e.charges.length) {
          r.unbilled++;
          if (now - e.date.getTime() > 7 * 86_400_000) r.old++;
        }
        g.set(e.provider.name, r);
      }
      return {
        columns: ["Provider", "Claims submitted", "Average days visit → claim", "Longest (days)", "Visits not yet billed", "Unbilled > 7 days"],
        rows: [...g.entries()].map(([p, r]) => [p, r.days.length, r.days.length ? (r.days.reduce((a, b) => a + b, 0) / r.days.length).toFixed(1) : "—", r.days.length ? Math.round(Math.max(...r.days)) : "—", r.unbilled, r.old]),
      };
    }
    case "wait": {
      const appts = await prisma.appointment.findMany({ where: { practiceId, startsAt: range }, include: { provider: true, events: { orderBy: { at: "asc" } } } });
      const g = new Map<string, { w: number[]; v: number[] }>();
      for (const a of appts) {
        const t = flowTimes(a.events);
        const w = minutesBetween(t.arrived, t.roomed);
        const v = minutesBetween(t.arrived, t.out);
        if (w === null && v === null) continue;
        const k = `${day(a.startsAt)}|${a.provider.name}`;
        const r = g.get(k) ?? { w: [], v: [] };
        if (w !== null) r.w.push(w);
        if (v !== null) r.v.push(v);
        g.set(k, r);
      }
      const avg = (x: number[]) => (x.length ? Math.round(x.reduce((a, b) => a + b, 0) / x.length) : "—");
      return { columns: ["Date", "Provider", "Patients tracked", "Avg wait (min)", "Longest wait (min)", "Avg visit (min)"], rows: [...g.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, r]) => [...k.split("|"), Math.max(r.w.length, r.v.length), avg(r.w), r.w.length ? Math.max(...r.w) : "—", avg(r.v)]) };
    }
    case "drawer": {
      const receipts = await prisma.receipt.findMany({ where: { practiceId, createdAt: range }, orderBy: { createdAt: "asc" } });
      const users = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(receipts.map((r) => r.collectedById).filter((x): x is string => Boolean(x)))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
      const g = new Map<string, { n: number; cents: number; voided: number }>();
      for (const r of receipts) {
        const k = `${day(r.createdAt)}|${users.get(r.collectedById ?? "") ?? "—"}|${PAY_METHODS[r.method]?.split(" ")[0] ?? r.method}`;
        const x = g.get(k) ?? { n: 0, cents: 0, voided: 0 };
        if (r.voidedAt) x.voided++;
        else {
          x.n++;
          x.cents += r.amountCents;
        }
        g.set(k, x);
      }
      const total = receipts.filter((r) => !r.voidedAt).reduce((s, r) => s + r.amountCents, 0);
      return { columns: ["Date", "Collected by", "Method", "Receipts", "Amount", "Voided"], rows: [...g.entries()].map(([k, x]) => [...k.split("|"), x.n, $(x.cents), x.voided]), totals: ["Total", "", "", receipts.filter((r) => !r.voidedAt).length, $(total), receipts.filter((r) => r.voidedAt).length], money: [4] };
    }
  }
  return { columns: [], rows: [] };
}
