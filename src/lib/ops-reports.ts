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
  ["wound_outcomes", "Wound outcomes by etiology", "Wounds healed in the period: healing rate, days and weeks to heal, and area reduction at 4 weeks — by wound type"],
  ["wound_provider", "Wound outcomes by provider", "The same outcome measures per treating provider"],
  ["hbo", "HBO utilization", "Hyperbaric treatments in the period: sessions, patients, aborted treatments and complications, by indication"],
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
    case "wound_outcomes":
    case "wound_provider": {
      // Wounds that were open at any point in the period: healed (closed with a healed date) or still active.
      const wounds = await prisma.wound.findMany({
        where: { practiceId, status: { not: "VOID" }, createdAt: { lte: to }, OR: [{ healedDate: null }, { healedDate: { gte: from } }] },
        include: {
          assessments: { orderBy: { assessedAt: "asc" }, select: { assessedAt: true, areaCm2: true, lengthCm: true, widthCm: true, encounter: { select: { provider: { select: { name: true } } } } } },
        },
      });
      const { etiologyLabel } = await import("@/lib/wound");
      const g = new Map<string, { open: number; healed: number; healedInPeriod: number; days: number[]; reduction4w: number[]; weeks: number[] }>();
      const area = (a: { areaCm2: number | null; lengthCm: number | null; widthCm: number | null }) => a.areaCm2 ?? (a.lengthCm && a.widthCm ? a.lengthCm * a.widthCm : null);
      for (const w of wounds) {
        const first = w.assessments[0];
        const keyName = key === "wound_provider" ? (first?.encounter.provider.name ?? "No provider") : (etiologyLabel[w.etiology] ?? w.etiology);
        const r = g.get(keyName) ?? { open: 0, healed: 0, healedInPeriod: 0, days: [], reduction4w: [], weeks: [] };
        const start = w.onsetDate ?? first?.assessedAt ?? w.createdAt;
        const end = w.healedDate ?? to;
        if (w.healedDate) {
          r.healed++;
          if (w.healedDate >= from && w.healedDate <= to) {
            r.healedInPeriod++;
            r.days.push((w.healedDate.getTime() - start.getTime()) / 86_400_000);
          }
        } else r.open++;
        r.weeks.push((Math.min(end.getTime(), to.getTime()) - start.getTime()) / (7 * 86_400_000));
        // Area reduction at ~4 weeks: the first assessment against the one closest to 28 days later.
        const a0 = first ? area(first) : null;
        if (first && a0) {
          const at4 = w.assessments.filter((a) => a.assessedAt.getTime() - first.assessedAt.getTime() >= 21 * 86_400_000).sort((a, b) => Math.abs(a.assessedAt.getTime() - first.assessedAt.getTime() - 28 * 86_400_000) - Math.abs(b.assessedAt.getTime() - first.assessedAt.getTime() - 28 * 86_400_000))[0];
          const a4 = at4 ? area(at4) : null;
          if (a4 !== null) r.reduction4w.push(((a0 - a4) / a0) * 100);
        }
        g.set(keyName, r);
      }
      const med = (x: number[]) => (x.length ? Math.round([...x].sort((a, b) => a - b)[Math.floor(x.length / 2)]) : "—");
      const avg = (x: number[], dp = 1) => (x.length ? Number((x.reduce((a, b) => a + b, 0) / x.length).toFixed(dp)) : "—");
      const rows = [...g.entries()].sort((a, b) => b[1].open + b[1].healed - (a[1].open + a[1].healed)).map(([k, r]) => [k, r.open + r.healed, r.open, r.healedInPeriod, pct(r.healed, r.open + r.healed), med(r.days), avg(r.weeks), r.reduction4w.length ? `${avg(r.reduction4w, 0)}% (n=${r.reduction4w.length})` : "—", r.reduction4w.length ? pct(r.reduction4w.filter((x) => x >= 50).length, r.reduction4w.length) : "—"]);
      const all = [...g.values()];
      const sum = (f: (r: (typeof all)[number]) => number) => all.reduce((s, r) => s + f(r), 0);
      return {
        columns: [key === "wound_provider" ? "Provider" : "Wound type", "Wounds", "Still open", "Healed in period", "Healing rate (all)", "Median days to heal", "Avg weeks in treatment", "Area reduction at 4 wk", "≥50% reduction at 4 wk"],
        rows,
        totals: ["All", sum((r) => r.open + r.healed), sum((r) => r.open), sum((r) => r.healedInPeriod), pct(sum((r) => r.healed), sum((r) => r.open + r.healed)), med(all.flatMap((r) => r.days)), avg(all.flatMap((r) => r.weeks)), "", ""],
      };
    }
    case "hbo": {
      // HBO Treatment Records completed in the period, with the indication from the pretreatment checklist.
      const docs = await prisma.encounterDocument.findMany({
        where: { status: "COMPLETE", template: { key: { startsWith: "hbo_treatment" } }, encounter: { practiceId, date: range } },
        select: { data: true, encounter: { select: { patientId: true, date: true, documents: { where: { template: { key: { startsWith: "hbo_pretreatment" } } }, select: { data: true } } } } },
      });
      const read = (json: string | null, part: string) => {
        try {
          const v = JSON.parse(json ?? "{}") as Record<string, unknown>;
          const k = Object.keys(v).find((x) => x.includes(part));
          return k ? v[k] : undefined;
        } catch {
          return undefined;
        }
      };
      const g = new Map<string, { sessions: number; patients: Set<string>; aborted: number; complications: number; minutes: number[] }>();
      for (const d of docs) {
        const ind = String(read(d.encounter.documents[0]?.data ?? null, "approved_indication") ?? "Not recorded").split(" (")[0];
        const r = g.get(ind) ?? { sessions: 0, patients: new Set(), aborted: 0, complications: 0, minutes: [] };
        r.sessions++;
        r.patients.add(d.encounter.patientId);
        const events = read(d.data, "events_during_treatment");
        const list = Array.isArray(events) ? events.map(String) : typeof events === "string" ? events.split(",") : [];
        if (list.some((e) => /aborted/i.test(e))) r.aborted++;
        if (list.some((e) => e.trim() && !/^none$/i.test(e.trim()))) r.complications++;
        const mins = Number(read(d.data, "total_treatment_time"));
        if (Number.isFinite(mins) && mins > 0) r.minutes.push(mins);
        g.set(ind, r);
      }
      const avg = (x: number[]) => (x.length ? Math.round(x.reduce((a, b) => a + b, 0) / x.length) : "—");
      const all = [...g.values()];
      return {
        columns: ["Indication", "Sessions", "Patients", "Avg minutes", "Aborted", "With a complication", "Complication rate"],
        rows: [...g.entries()].sort((a, b) => b[1].sessions - a[1].sessions).map(([k, r]) => [k, r.sessions, r.patients.size, avg(r.minutes), r.aborted, r.complications, pct(r.complications, r.sessions)]),
        totals: ["All", all.reduce((s, r) => s + r.sessions, 0), new Set(all.flatMap((r) => [...r.patients])).size, avg(all.flatMap((r) => r.minutes)), all.reduce((s, r) => s + r.aborted, 0), all.reduce((s, r) => s + r.complications, 0), pct(all.reduce((s, r) => s + r.complications, 0), all.reduce((s, r) => s + r.sessions, 0))],
      };
    }
  }
  return { columns: [], rows: [] };
}
