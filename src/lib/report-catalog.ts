import "server-only";
import { prisma } from "@/lib/prisma";
import { formatMoney, patientName } from "@/lib/format";
import { OPEN_AR_STATUSES, claimNumber } from "@/lib/claim-format";
import { REPORTS as FINANCIAL, runReport, type Table } from "@/lib/financial-reports";
import { OPS_REPORTS, runOpsReport } from "@/lib/ops-reports";
import { scheduleFor } from "@/lib/charge-schedules";
import { sendMessage } from "@/lib/connect/core";
import { createTask } from "@/lib/tasks";
import type { PermissionKey } from "@/lib/permissions";

// The report framework: one catalogue of every report as data (key, group, label, what it shows, who may run
// it, which runner), a CSV writer, saved views, scheduled subscriptions delivered by email, and monitoring
// rules that watch data quality and raise findings on a schedule.

export type ReportDef = { key: string; group: "ops" | "clinical" | "revenue" | "accounts" | "operations"; label: string; about: string; permission: PermissionKey; href: string };
const CLINICAL_OPS = new Set(["wound_outcomes", "wound_provider", "hbo"]);

// Revenue reports added by the framework (on top of src/lib/financial-reports.ts).
export const EXTRA_FINANCIAL: [string, string, string][] = [
  ["underpayments", "Underpayments vs allowable", "Paid claims where the payer paid less than the charge-schedule allowable, with the shortfall"],
  ["rejections", "Clearinghouse rejections", "Claims rejected before reaching the payer, with the reason and the attempt count"],
  ["fully_adjusted", "Fully adjusted lines", "Service lines written off in full: billed, adjustment and the claim's status"],
  ["copay", "Copay expected vs collected", "Visits in the period: the copay the eligibility check expected against what the desk collected"],
  ["checks", "Payment check summary", "Every deposit in the period with what was applied, to which claims, and what is still unapplied"],
  ["statements", "Statement history", "Statements sent in the period by notice number, channel and amount"],
  ["plans", "Payment plans", "Plans by status with totals, paid and missed instalments"],
  ["collections_cases", "Collections cases", "Accounts in collections: status, agency, balance and outcome"],
  ["batch_variance", "Deposits & bank reconciliation", "Deposits in the period and whether they reached the bank statement"],
  ["imports", "Import batches", "Every import with its kind, counts and status"],
  ["automation", "Automation runs", "Background job runs in the period and their outcomes"],
];

export const CATALOG: ReportDef[] = [
  ...OPS_REPORTS.filter(([k]) => !CLINICAL_OPS.has(k)).map(([key, label, about]) => ({ key, group: "ops" as const, label, about, permission: "reports.ops" as PermissionKey, href: `/reports?r=${key}` })),
  ...OPS_REPORTS.filter(([k]) => CLINICAL_OPS.has(k)).map(([key, label, about]) => ({ key, group: "clinical" as const, label, about, permission: "reports.clinical" as PermissionKey, href: `/reports?r=${key}` })),
  ...FINANCIAL.map(([key, label, about]) => ({ key, group: "revenue" as const, label, about, permission: "billing.work" as PermissionKey, href: `/billing/reports?r=${key}` })),
  ...EXTRA_FINANCIAL.map(([key, label, about]) => ({ key, group: (["statements", "plans", "collections_cases"].includes(key) ? "accounts" : ["batch_variance", "imports", "automation"].includes(key) ? "operations" : "revenue") as ReportDef["group"], label, about, permission: "billing.work" as PermissionKey, href: `/billing/reports?r=${key}` })),
];
export const reportDef = (key: string) => CATALOG.find((r) => r.key === key) ?? null;
export const FINANCIAL_KEYS = [...FINANCIAL.map(([k]) => k), ...EXTRA_FINANCIAL.map(([k]) => k)];

const $ = (c: number) => Math.round(c) / 100;

export async function runCatalogReport(practiceId: string, key: string, from: Date, to: Date, patientId?: string): Promise<Table> {
  const range = { gte: from, lte: to };
  if (OPS_REPORTS.some(([k]) => k === key)) return runOpsReport(practiceId, key, from, to);
  if (FINANCIAL.some(([k]) => k === key)) return runReport(practiceId, key, from, to, patientId);
  switch (key) {
    case "underpayments": {
      const claims = await prisma.claim.findMany({ where: { practiceId, paidCents: { gt: 0 }, status: { not: "VOID" }, lines: { some: { dosFrom: range } } }, include: { lines: true, patient: true } });
      const rows: (string | number)[][] = [];
      let short = 0;
      for (const c of claims) {
        const sched = await scheduleFor(practiceId, { date: c.lines[0]?.dosFrom ?? from, payerId: c.payerId, locationId: c.serviceLocationId, providerId: c.renderingProviderId });
        if (!sched) continue;
        let expected = 0;
        let any = false;
        for (const l of c.lines) {
          const a = sched.fees.get(l.cptCode.toUpperCase())?.allowedCents;
          if (a === null || a === undefined) continue;
          any = true;
          expected += a * Math.max(1, l.units);
        }
        if (!any) continue;
        const patientShare = c.balanceResponsibility === "PATIENT" ? Math.max(0, c.billedCents - c.paidCents - c.adjustedCents) : 0;
        const gap = expected - c.paidCents - patientShare;
        if (gap <= 0) continue;
        short += gap;
        rows.push([claimNumber(c), patientName(c.patient), c.payerName, c.lines[0]?.dosFrom.toISOString().slice(0, 10) ?? "", $(c.billedCents), $(expected), $(c.paidCents), $(gap), c.status]);
      }
      return { columns: ["Claim", "Patient", "Payer", "DOS", "Billed", "Allowable", "Paid", "Shortfall", "Status"], rows: rows.sort((a, b) => Number(b[7]) - Number(a[7])), totals: ["Total", "", "", "", "", "", "", $(short), ""], money: [4, 5, 6, 7] };
    }
    case "rejections": {
      const claims = await prisma.claim.findMany({ where: { practiceId, OR: [{ status: "EDI_REJECTED" }, { events: { some: { action: "EDI_REJECTED", createdAt: range } } }] }, include: { patient: true, events: { where: { action: "EDI_REJECTED" }, orderBy: { createdAt: "desc" }, take: 1 } } });
      return { columns: ["Claim", "Patient", "Payer", "Rejected", "Reason", "Attempt", "Status now"], rows: claims.map((c) => [claimNumber(c), patientName(c.patient), c.payerName, c.events[0]?.createdAt.toISOString().slice(0, 10) ?? "", c.rejectionReason ?? c.events[0]?.note ?? "", c.attempt, c.status]) };
    }
    case "fully_adjusted": {
      const lines = await prisma.claimLine.findMany({ where: { dosFrom: range, chargeCents: { gt: 0 }, claim: { practiceId, status: { not: "VOID" } } }, include: { claim: { include: { patient: true } } } });
      const full = lines.filter((l) => l.paidCents === 0 && l.adjustedCents >= l.chargeCents);
      return { columns: ["Claim", "Patient", "Payer", "DOS", "Code", "Billed", "Adjusted", "Claim status"], rows: full.map((l) => [claimNumber(l.claim), patientName(l.claim.patient), l.claim.payerName, l.dosFrom.toISOString().slice(0, 10), l.cptCode, $(l.chargeCents), $(l.adjustedCents), l.claim.status]), totals: ["Total", "", "", "", "", $(full.reduce((s, l) => s + l.chargeCents, 0)), $(full.reduce((s, l) => s + l.adjustedCents, 0)), ""], money: [5, 6] };
    }
    case "copay": {
      const appts = await prisma.appointment.findMany({ where: { practiceId, startsAt: range, status: { in: ["CHECKED_IN", "IN_ROOM", "COMPLETED"] } }, include: { patient: true, provider: true } });
      const copayReceipts = await prisma.receipt.findMany({ where: { practiceId, voidedAt: null, kind: "COPAY", appointmentId: { in: appts.map((a) => a.id) } }, select: { appointmentId: true, amountCents: true } });
      const rows = [];
      let expected = 0;
      let collected = 0;
      for (const a of appts) {
        const elig = await prisma.eligibilityCheck.findFirst({ where: { patientId: a.patientId, copayCents: { not: null }, checkedAt: { lte: a.startsAt } }, orderBy: { checkedAt: "desc" }, select: { copayCents: true } });
        const exp = elig?.copayCents ?? 0;
        const got = copayReceipts.filter((r) => r.appointmentId === a.id).reduce((s, r) => s + r.amountCents, 0);
        expected += exp;
        collected += got;
        rows.push([a.startsAt.toISOString().slice(0, 10), patientName(a.patient), a.provider.name, $(exp), $(got), $(exp - got)]);
      }
      return { columns: ["Visit", "Patient", "Provider", "Copay expected", "Collected", "Missed"], rows, totals: ["Total", "", "", $(expected), $(collected), $(expected - collected)], money: [3, 4, 5] };
    }
    case "checks": {
      const deps = await prisma.deposit.findMany({ where: { practiceId, postedAt: range }, include: { applications: { include: { claim: { include: { patient: true } } } } }, orderBy: { postedAt: "asc" } });
      return { columns: ["Posted", "Payer", "Method · ref", "Amount", "Applied", "Unapplied", "Claims", "Bank"], rows: deps.map((d) => [d.postedAt.toISOString().slice(0, 10), d.payerName, `${d.paymentMethod}${d.checkNumber ? ` ${d.checkNumber}` : ""}`, $(d.totalCents), $(d.totalCents - d.unappliedCents), $(d.unappliedCents), d.applications.map((a) => `${claimNumber(a.claim)} ${patientName(a.claim.patient)} ${formatMoney(a.amountCents)}`).join("; "), `${d.status}${d.depositDate ? ` ${d.depositDate.toISOString().slice(0, 10)}` : ""}`]), totals: ["Total", "", "", $(deps.reduce((s, d) => s + d.totalCents, 0)), $(deps.reduce((s, d) => s + d.totalCents - d.unappliedCents, 0)), $(deps.reduce((s, d) => s + d.unappliedCents, 0)), "", ""], money: [3, 4, 5] };
    }
    case "statements": {
      const st = await prisma.statement.findMany({ where: { practiceId, createdAt: range }, include: { patient: true }, orderBy: { createdAt: "desc" } });
      return { columns: ["Date", "Guarantor", "Notice", "Channel", "Status", "Amount"], rows: st.map((s) => [s.createdAt.toISOString().slice(0, 10), patientName(s.patient), s.cycle, s.channel, s.status, $(s.totalCents)]), totals: ["Total", "", "", "", "", $(st.reduce((s, x) => s + x.totalCents, 0))], money: [5] };
    }
    case "plans": {
      const plans = await prisma.paymentPlan.findMany({ where: { practiceId }, include: { patient: true, installments: true } });
      return { columns: ["Patient", "Status", "Total", "Paid", "Remaining", "Instalment", "Every", "Missed", "Next due"], rows: plans.map((p) => [patientName(p.patient), p.status, $(p.totalCents), $(p.paidCents), $(p.totalCents - p.paidCents), $(p.installmentCents), p.frequency, p.missed, p.nextDueAt?.toISOString().slice(0, 10) ?? ""]), money: [2, 3, 4, 5] };
    }
    case "collections_cases": {
      const cases = await prisma.collectionsCase.findMany({ where: { practiceId }, include: { patient: true }, orderBy: { createdAt: "desc" } });
      return { columns: ["Patient", "Balance", "Status", "Agency", "Referred", "Opened", "Outcome"], rows: cases.map((c) => [patientName(c.patient), $(c.balanceCents), c.status, c.agency ?? "", c.referredAt?.toISOString().slice(0, 10) ?? "", c.createdAt.toISOString().slice(0, 10), c.outcome ?? c.note ?? ""]), money: [1] };
    }
    case "batch_variance": {
      const deps = await prisma.deposit.findMany({ where: { practiceId, postedAt: range }, orderBy: { postedAt: "asc" } });
      return { columns: ["Posted", "Payer", "Amount", "Status", "Deposit date", "Bank ref", "Days open"], rows: deps.map((d) => [d.postedAt.toISOString().slice(0, 10), d.payerName, $(d.totalCents), d.status, d.depositDate?.toISOString().slice(0, 10) ?? "", d.bankRef ?? "", d.status === "RECONCILED" ? 0 : Math.floor((Date.now() - d.postedAt.getTime()) / 86_400_000)]), money: [2] };
    }
    case "imports": {
      const b = await prisma.importBatch.findMany({ where: { practiceId, createdAt: range }, orderBy: { createdAt: "desc" } });
      return { columns: ["Date", "Kind", "File", "Rows", "Imported", "Skipped", "Status"], rows: b.map((x) => [x.createdAt.toISOString().slice(0, 10), x.kind, x.fileName, x.totalRows, x.createdCount, x.skippedCount, x.status]) };
    }
    case "automation": {
      const runs = await prisma.jobRun.findMany({ where: { startedAt: range }, orderBy: { startedAt: "desc" }, take: 500 });
      return { columns: ["Started", "Job", "Trigger", "Status", "Summary"], rows: runs.map((r) => [r.startedAt.toISOString().replace("T", " ").slice(0, 16), r.job, r.triggeredBy, r.status, r.summary ?? r.error ?? ""]) };
    }
    default:
      return { columns: ["Report"], rows: [[`Unknown report ${key}`]] };
  }
}

export function toCsv(table: Table) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [table.columns, ...table.rows, ...(table.totals ? [table.totals] : [])].map((r) => r.map(esc).join(",")).join("\r\n");
}

// Range presets for saved views and subscriptions.
export const RANGE_PRESETS: Record<string, { label: string; range: () => { from: Date; to: Date } }> = {
  YESTERDAY: { label: "Yesterday", range: () => { const d = new Date(); d.setDate(d.getDate() - 1); return { from: new Date(d.getFullYear(), d.getMonth(), d.getDate()), to: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59) }; } },
  LAST_7: { label: "Last 7 days", range: () => ({ from: new Date(Date.now() - 7 * 86_400_000), to: new Date() }) },
  MTD: { label: "Month to date", range: () => { const d = new Date(); return { from: new Date(d.getFullYear(), d.getMonth(), 1), to: d }; } },
  LAST_MONTH: { label: "Last month", range: () => { const d = new Date(); return { from: new Date(d.getFullYear(), d.getMonth() - 1, 1), to: new Date(d.getFullYear(), d.getMonth(), 0, 23, 59, 59) }; } },
  LAST_30: { label: "Last 30 days", range: () => ({ from: new Date(Date.now() - 30 * 86_400_000), to: new Date() }) },
  QTD: { label: "Quarter to date", range: () => { const d = new Date(); return { from: new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1), to: d }; } },
};
export const CADENCES: Record<string, string> = { DAILY: "Every morning", WEEKLY: "Monday mornings", MONTHLY: "First of the month" };

// Scheduled deliveries: each active subscription whose cadence is due today gets the report as CSV by email.
// Without an email provider the message (with a row count and the first lines) lands in the message log.
export async function runReportSubscriptions() {
  const now = new Date();
  const subs = await prisma.reportSubscription.findMany({ where: { active: true }, include: { user: { select: { email: true, name: true } }, practice: { select: { name: true } } } });
  let sent = 0;
  for (const s of subs) {
    const due = s.cadence === "DAILY" || (s.cadence === "WEEKLY" && now.getDay() === 1) || (s.cadence === "MONTHLY" && now.getDate() === 1);
    if (!due) continue;
    if (s.lastSentAt && now.getTime() - s.lastSentAt.getTime() < 20 * 3_600_000) continue;
    const def = reportDef(s.reportKey);
    const preset = RANGE_PRESETS[s.rangePreset] ?? RANGE_PRESETS.LAST_7;
    if (!def) continue;
    const { from, to } = preset.range();
    const table = await runCatalogReport(s.practiceId, s.reportKey, from, to);
    const csv = toCsv(table);
    await sendMessage({
      practiceId: s.practiceId,
      channel: "EMAIL",
      to: s.user.email,
      subject: `${s.practice.name}: ${def.label} (${preset.label})`,
      body: `${def.label} for ${preset.label.toLowerCase()} — ${table.rows.length} rows.\n\nOpen in CareHub: ${def.href}&from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}\n\nCSV:\n${csv.slice(0, 1500)}${csv.length > 1500 ? "\n…" : ""}`,
      kind: "OTHER",
      userId: s.userId,
    });
    await prisma.reportSubscription.update({ where: { id: s.id }, data: { lastSentAt: now } });
    sent++;
  }
  return `${sent} report${sent === 1 ? "" : "s"} delivered`;
}

// ---- Monitoring rules: built-in data-quality checks an administrator switches on, with thresholds ----
export type MonitorCheck = { key: string; label: string; about: string; unit: string; defaultThreshold: number; run: (practiceId: string, threshold: number) => Promise<{ count: number; detail: string }> };
const DAY = 86_400_000;
export const MONITOR_CHECKS: MonitorCheck[] = [
  { key: "interface_inbox", label: "Result messages stuck in the interface inbox", about: "Lab/imaging results that could not be matched to an order", unit: "messages", defaultThreshold: 1, run: async (p) => { const n = await prisma.interfaceMessage.count({ where: { practiceId: p, status: { in: ["UNMATCHED", "PARTIAL", "FAILED"] } } }); return { count: n, detail: `${n} result message(s) waiting to be linked to an order` }; } },
  { key: "zero_charges", label: "Zero-dollar charges", about: "Charges entered yesterday with a $0 amount", unit: "charges", defaultThreshold: 1, run: async (p) => { const n = await prisma.charge.count({ where: { practiceId: p, amountCents: 0, encounter: { date: { gte: new Date(Date.now() - DAY) } } } }); return { count: n, detail: `${n} zero-dollar charge(s) on visits dated in the last day` }; } },
  { key: "duplicate_checks", label: "Duplicate check numbers", about: "Two deposits with the same check number and payer", unit: "duplicates", defaultThreshold: 1, run: async (p) => { const deps = await prisma.deposit.findMany({ where: { practiceId: p, checkNumber: { not: null } }, select: { checkNumber: true, payerName: true } }); const seen = new Map<string, number>(); for (const d of deps) seen.set(`${d.payerName}|${d.checkNumber}`, (seen.get(`${d.payerName}|${d.checkNumber}`) ?? 0) + 1); const dup = [...seen.entries()].filter(([, n]) => n > 1); return { count: dup.length, detail: dup.map(([k]) => k.replace("|", " check ")).slice(0, 5).join("; ") }; } },
  { key: "unsigned_visits", label: "Visits not signed within 7 days", about: "Charts still open or waiting a week after the visit", unit: "visits", defaultThreshold: 1, run: async (p) => { const n = await prisma.encounter.count({ where: { practiceId: p, status: { in: ["IN_PROGRESS", "CDS_QUERY", "READY_FOR_CDS", "READY_FOR_CODING", "CODING_QUERY", "READY_FOR_SIGNATURE"] }, date: { lt: new Date(Date.now() - 7 * DAY) } } }); return { count: n, detail: `${n} visit(s) older than 7 days not yet signed` }; } },
  { key: "patients_missing", label: "Patients missing sex or date of birth", about: "Registration gaps that block claims", unit: "patients", defaultThreshold: 1, run: async (p) => { const n = await prisma.patient.count({ where: { practiceId: p, status: "ACTIVE", OR: [{ sex: "U" }, { sex: "" }] } }); return { count: n, detail: `${n} active patient(s) with unknown sex` }; } },
  { key: "rejected_claims", label: "Clearinghouse rejections open", about: "Claims rejected and not yet resubmitted", unit: "claims", defaultThreshold: 1, run: async (p) => { const n = await prisma.claim.count({ where: { practiceId: p, status: "EDI_REJECTED" } }); return { count: n, detail: `${n} rejected claim(s) waiting` }; } },
  { key: "unbalanced_deposits", label: "Deposits not reconciled after 2 days", about: "Posted deposits that have not reached the bank statement", unit: "deposits", defaultThreshold: 1, run: async (p) => { const n = await prisma.deposit.count({ where: { practiceId: p, status: { not: "RECONCILED" }, postedAt: { lt: new Date(Date.now() - 2 * DAY) } } }); return { count: n, detail: `${n} deposit(s) older than 2 days not reconciled` }; } },
  { key: "timely_filing", label: "Claims nearing timely filing", about: "Unsent or unanswered claims within the payer's alert window", unit: "claims", defaultThreshold: 1, run: async (p) => { const claims = await prisma.claim.findMany({ where: { practiceId: p, status: { in: ["DRAFT", "READY", "HOLD", "EDI_REJECTED", "SUBMITTED"] }, payer: { timelyFilingAlertDays: { not: null } } }, include: { payer: { select: { timelyFilingAlertDays: true } }, lines: { select: { dosFrom: true }, orderBy: { dosFrom: "asc" }, take: 1 } } }); const near = claims.filter((c) => c.lines[0] && c.payer?.timelyFilingAlertDays && (Date.now() - c.lines[0].dosFrom.getTime()) / DAY >= c.payer.timelyFilingAlertDays); return { count: near.length, detail: near.slice(0, 5).map((c) => claimNumber(c)).join(", ") }; } },
  { key: "eras_unposted", label: "ERAs not posted within 3 days", about: "Remittance files imported but not fully posted", unit: "files", defaultThreshold: 1, run: async (p) => { const n = await prisma.eraFile.count({ where: { practiceId: p, claims: { some: { matchStatus: { not: "POSTED" } } } } }); return { count: n, detail: `${n} ERA file(s) with unposted claims` }; } },
  { key: "open_ar_unworked", label: "Open AR with no follow-up", about: "Claims out with a payer and nobody working them", unit: "claims", defaultThreshold: 5, run: async (p) => { const n = await prisma.claim.count({ where: { practiceId: p, status: { in: OPEN_AR_STATUSES }, followUps: { none: { status: { in: ["OPEN", "WAITING_PAYER", "WAITING_PRACTICE", "WAITING_PATIENT"] } } } } }); return { count: n, detail: `${n} open claim(s) without a follow-up item` }; } },
];

// Runs every active rule for every practice; findings at or over the threshold become a task for the billing
// team and an email to the rule's recipients.
export async function runMonitoring(practiceId?: string) {
  const rules = await prisma.monitoringRule.findMany({ where: { active: true, ...(practiceId ? { practiceId } : {}) } });
  let findings = 0;
  for (const rule of rules) {
    const check = MONITOR_CHECKS.find((c) => c.key === rule.checkKey);
    if (!check) continue;
    const r = await check.run(rule.practiceId, rule.threshold);
    await prisma.monitoringRule.update({ where: { id: rule.id }, data: { lastRunAt: new Date(), lastCount: r.count, lastDetail: r.detail.slice(0, 500) } });
    if (r.count < rule.threshold) continue;
    findings++;
    await createTask({ practiceId: rule.practiceId, type: "BILLING", title: `Monitor: ${check.label} — ${r.count} ${check.unit}`, body: r.detail, assignedRole: "BILLER", priority: "NORMAL", link: "/settings/monitoring", sourceType: "MONITOR", sourceId: `${rule.id}:${new Date().toISOString().slice(0, 10)}` });
    for (const to of (rule.recipients ?? "").split(/[\s,;]+/).filter(Boolean)) {
      await sendMessage({ practiceId: rule.practiceId, channel: "EMAIL", to, subject: `CareHub monitor: ${check.label} (${r.count})`, body: `${check.about}\n\n${r.detail}\n\nThreshold: ${rule.threshold} ${check.unit}.`, kind: "OTHER" });
    }
  }
  return `${rules.length} rules checked, ${findings} findings`;
}
