import "server-only";
import { prisma } from "@/lib/prisma";
import { agingBucket } from "@/lib/format";
import { OPEN_AR_STATUSES, PRE_RELEASE_STATUSES } from "@/lib/claim-format";
import { can, type PermissionKey } from "@/lib/permissions";
import { getCredentialingAlerts } from "@/lib/credentialing";
import { loadWaitingForTeam } from "@/lib/patient-thread";
import { careGapsFor } from "@/lib/care-rules";
import { myTasksWhere } from "@/lib/tasks";

// The practice dashboard: tiles a user picks (or a preset view picks for them). Each tile is a small query with a
// headline number, a few rows and a link into the screen where the work is done. Tiles are gated by the same
// permission map as the pages they open.

export type TileRow = { label: string; value: string | number; href?: string; tone?: "ok" | "warn" | "bad" | "muted" };
export type TileData = { value: string | number; sub?: string; rows?: TileRow[]; href: string; tone?: "ok" | "warn" | "bad" };
export type TileDef = { key: string; title: string; group: string; permission: PermissionKey; span: 1 | 2; about: string };

type User = { id: string; practiceId: string; role: string };
const $ = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const startOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);

export const TILES: TileDef[] = [
  { key: "today", title: "Today's schedule", group: "Front office", permission: "schedule.view", span: 1, about: "Booked, arrived, in room, no-shows" },
  { key: "gateway", title: "Gateway pipeline", group: "Front office", permission: "gateway.work", span: 1, about: "Open cases by team" },
  { key: "eligibility", title: "Eligibility problems", group: "Front office", permission: "eligibility.run", span: 1, about: "Upcoming visits whose last check was not active" },
  { key: "waiting", title: "Waiting for my team", group: "Front office", permission: "patients.thread", span: 1, about: "Patient messages and tasks waiting on your team" },
  { key: "tasks", title: "My open tasks", group: "Front office", permission: "tasks.work", span: 1, about: "Tasks assigned to you or your team" },
  { key: "visits", title: "Visit pipeline", group: "Clinical", permission: "chart.worklist", span: 1, about: "Charts in progress, with CDS, coding, awaiting signature" },
  { key: "caregaps", title: "Care gaps due", group: "Clinical", permission: "caregaps.view", span: 1, about: "Active patients with a screening or lab due" },
  { key: "referrals", title: "Referrals overdue", group: "Clinical", permission: "referrals.work", span: 1, about: "Sent referrals with no consult note" },
  { key: "outcomes", title: "Wound outcomes (90 days)", group: "Clinical", permission: "chart.worklist", span: 1, about: "Healed vs still open, median days to heal" },
  { key: "prerelease", title: "Pre-release queue", group: "Revenue", permission: "billing.work", span: 1, about: "Generated claims waiting to be billed" },
  { key: "ar", title: "A/R aging", group: "Revenue", permission: "billing.work", span: 1, about: "Open insurance balance by age" },
  { key: "collections", title: "Collections this month", group: "Revenue", permission: "billing.work", span: 1, about: "Received this month vs last month" },
  { key: "denials", title: "Denials & appeals", group: "Revenue", permission: "billing.work", span: 1, about: "Open denials and appeal deadlines" },
  { key: "payers", title: "Top payers this month", group: "Revenue", permission: "billing.work", span: 1, about: "Charges by payer, month to date" },
  { key: "unbilled", title: "Unbilled visits", group: "Revenue", permission: "billing.work", span: 1, about: "Signed visits with charges and no claim" },
  { key: "credentialing", title: "Credentialing alerts", group: "Revenue", permission: "credentialing.work", span: 1, about: "Expiring and pending enrollments" },
];

// Preset views: a tab picks a set of tiles; "custom" uses the user's own selection.
export const VIEWS: { key: string; label: string; tiles: string[] }[] = [
  { key: "practice", label: "Practice", tiles: ["today", "visits", "prerelease", "ar", "collections", "gateway", "waiting", "caregaps"] },
  { key: "front", label: "Front office", tiles: ["today", "gateway", "eligibility", "waiting", "tasks", "referrals"] },
  { key: "clinical", label: "Clinical", tiles: ["visits", "caregaps", "referrals", "outcomes", "waiting", "today"] },
  { key: "revenue", label: "Revenue", tiles: ["prerelease", "unbilled", "ar", "collections", "denials", "payers", "credentialing"] },
  { key: "custom", label: "My view", tiles: [] },
];

export function parseTiles(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string" && TILES.some((t) => t.key === k)) : [];
  } catch {
    return [];
  }
}

export const tilesFor = (role: string) => TILES.filter((t) => can(role, t.permission));

export async function loadTile(key: string, user: User): Promise<TileData | null> {
  const p = user.practiceId;
  const now = new Date();
  switch (key) {
    case "today": {
      const day = startOfDay();
      const appts = await prisma.appointment.findMany({ where: { practiceId: p, startsAt: { gte: day, lt: new Date(day.getTime() + 86_400_000) } }, select: { status: true } });
      const n = (s: string[]) => appts.filter((a) => s.includes(a.status)).length;
      return {
        value: appts.length,
        sub: "booked today",
        href: "/schedule",
        rows: [
          { label: "Checked in / in room", value: n(["CHECKED_IN", "IN_ROOM"]), href: "/flow" },
          { label: "Completed", value: n(["COMPLETED"]) },
          { label: "No-shows / cancelled", value: n(["NO_SHOW", "CANCELLED"]), tone: n(["NO_SHOW"]) ? "warn" : "muted" },
        ],
      };
    }
    case "gateway": {
      const cases = await prisma.intakeCase.groupBy({ by: ["stage"], where: { practiceId: p, stage: { notIn: ["CLOSED", "SCHEDULED"] } }, _count: { _all: true } });
      const c = (s: string[]) => cases.filter((x) => s.includes(x.stage)).reduce((a, x) => a + x._count._all, 0);
      return {
        value: cases.reduce((a, x) => a + x._count._all, 0),
        sub: "open cases",
        href: "/",
        rows: [
          { label: "Data entry", value: c(["DATA_ENTRY"]), href: "/?tab=data-entry" },
          { label: "Verification / auth", value: c(["VERIFICATION", "AUTH_PENDING", "PCC_REFERRAL"]), href: "/?tab=verification" },
          { label: "Scheduling", value: c(["SCHEDULING"]), href: "/?tab=scheduling" },
        ],
      };
    }
    case "eligibility": {
      const appts = await prisma.appointment.findMany({
        where: { practiceId: p, startsAt: { gte: now, lt: new Date(now.getTime() + 7 * 86_400_000) }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
        select: { id: true, patientId: true, patient: { select: { eligibilityChecks: { orderBy: { checkedAt: "desc" }, take: 1, select: { status: true } } } } },
      });
      const problems = appts.filter((a) => a.patient.eligibilityChecks[0] && a.patient.eligibilityChecks[0].status !== "ACTIVE").length;
      const unchecked = appts.filter((a) => a.patient.eligibilityChecks.length === 0).length;
      return { value: problems + unchecked, sub: "of next 7 days' visits", href: "/schedule/eligibility", tone: problems ? "bad" : unchecked ? "warn" : "ok", rows: [{ label: "Not active / error", value: problems, tone: problems ? "bad" : "muted" }, { label: "Never checked", value: unchecked, tone: unchecked ? "warn" : "muted" }] };
    }
    case "waiting": {
      const rows = await loadWaitingForTeam(user);
      return { value: rows.length, sub: "waiting for your team", href: rows[0]?.href ?? "/", tone: rows.some((r) => r.days >= 2) ? "bad" : rows.length ? "warn" : "ok", rows: rows.slice(0, 4).map((r) => ({ label: r.patient, value: r.days ? `${r.days}d` : "today", href: r.href })) };
    }
    case "tasks": {
      const open = await prisma.task.findMany({ where: { ...myTasksWhere(user), status: "OPEN" }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }], take: 4, select: { id: true, title: true, priority: true, link: true } });
      const n = await prisma.task.count({ where: { ...myTasksWhere(user), status: "OPEN" } });
      return { value: n, sub: "open", href: "/tasks", rows: open.map((t) => ({ label: t.title, value: t.priority === "URGENT" || t.priority === "HIGH" ? t.priority.toLowerCase() : "", href: t.link ?? "/tasks", tone: t.priority === "URGENT" ? "bad" : t.priority === "HIGH" ? "warn" : "muted" })) };
    }
    case "visits": {
      const g = await prisma.encounter.groupBy({ by: ["status"], where: { practiceId: p, status: { in: ["IN_PROGRESS", "CDS_QUERY", "READY_FOR_CDS", "READY_FOR_CODING", "CODING_QUERY", "READY_FOR_SIGNATURE"] } }, _count: { _all: true } });
      const n = (s: string[]) => g.filter((x) => s.includes(x.status)).reduce((a, x) => a + x._count._all, 0);
      return {
        value: g.reduce((a, x) => a + x._count._all, 0),
        sub: "charts in the pipeline",
        href: "/encounters",
        rows: [
          { label: "In progress / queried", value: n(["IN_PROGRESS", "CDS_QUERY"]), href: "/encounters?queue=mine" },
          { label: "CDS review", value: n(["READY_FOR_CDS"]), href: "/encounters?queue=cds" },
          { label: "Coding", value: n(["READY_FOR_CODING", "CODING_QUERY"]), href: "/encounters?queue=coding" },
          { label: "Awaiting signature", value: n(["READY_FOR_SIGNATURE"]), href: "/encounters?queue=signature" },
        ],
      };
    }
    case "caregaps": {
      const since = new Date(now.getTime() - 365 * 86_400_000);
      const patients = await prisma.patient.findMany({ where: { practiceId: p, status: "ACTIVE", OR: [{ encounters: { some: { date: { gte: since } } } }, { wounds: { some: { status: "ACTIVE" } } }] }, select: { id: true }, take: 500 });
      const gaps = await careGapsFor(p, patients.map((x) => x.id));
      const byRule = new Map<string, number>();
      let patientsDue = 0;
      for (const list of gaps.values()) {
        const due = list.filter((g) => g.status === "DUE");
        if (due.length) patientsDue++;
        for (const g of due) byRule.set(g.name, (byRule.get(g.name) ?? 0) + 1);
      }
      return { value: patientsDue, sub: "patients with something due", href: "/care-gaps", rows: [...byRule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([l, v]) => ({ label: l, value: v })) };
    }
    case "referrals": {
      const refs = await prisma.outgoingReferral.findMany({ where: { practiceId: p, status: { in: ["SENT", "SCHEDULED"] }, sentAt: { not: null } }, select: { id: true, sentAt: true, followUpDays: true, toName: true } });
      const overdue = refs.filter((r) => r.sentAt && now.getTime() - r.sentAt.getTime() > r.followUpDays * 86_400_000);
      return { value: overdue.length, sub: `of ${refs.length} open referrals`, href: "/referrals?view=overdue", tone: overdue.length ? "warn" : "ok", rows: overdue.slice(0, 4).map((r) => ({ label: r.toName ?? "Referral", value: `${Math.floor((now.getTime() - r.sentAt!.getTime()) / 86_400_000)}d`, href: `/referrals/${r.id}` })) };
    }
    case "outcomes": {
      const since = new Date(now.getTime() - 90 * 86_400_000);
      const [healed, open] = await Promise.all([
        prisma.wound.findMany({ where: { practiceId: p, healedDate: { gte: since } }, select: { onsetDate: true, createdAt: true, healedDate: true } }),
        prisma.wound.count({ where: { practiceId: p, status: "ACTIVE" } }),
      ]);
      const days = healed.map((w) => (w.healedDate!.getTime() - (w.onsetDate ?? w.createdAt).getTime()) / 86_400_000).sort((a, b) => a - b);
      const median = days.length ? Math.round(days[Math.floor(days.length / 2)]) : null;
      return { value: healed.length, sub: "wounds healed in 90 days", href: "/reports?r=wound_outcomes", rows: [{ label: "Still open", value: open }, { label: "Median days to heal", value: median ?? "—" }, { label: "Healing rate", value: healed.length + open ? `${Math.round((healed.length / (healed.length + open)) * 100)}%` : "—" }] };
    }
    case "prerelease": {
      const claims = await prisma.claim.findMany({ where: { practiceId: p, status: { in: PRE_RELEASE_STATUSES } }, select: { status: true, billedCents: true } });
      const ready = claims.filter((c) => c.status === "READY").length;
      return { value: claims.length, sub: `${$(claims.reduce((s, c) => s + c.billedCents, 0))} · ${ready} ready to bill`, href: "/billing/claims/release", tone: claims.length - ready ? "warn" : "ok", rows: [{ label: "Ready to bill", value: ready, tone: "ok" }, { label: "Need fixing", value: claims.length - ready, tone: claims.length - ready ? "warn" : "muted" }] };
    }
    case "unbilled": {
      const n = await prisma.encounter.count({ where: { practiceId: p, status: { in: ["READY_FOR_BILLING"] }, charges: { some: {} }, claims: { none: { status: { not: "VOID" } } } } });
      return { value: n, sub: "signed visits without a claim", href: "/billing?tab=visits", tone: n ? "warn" : "ok" };
    }
    case "ar": {
      const claims = await prisma.claim.findMany({ where: { practiceId: p, status: { in: [...OPEN_AR_STATUSES, "TRANSFERRED"] } }, select: { billedCents: true, paidCents: true, adjustedCents: true, submittedAt: true, createdAt: true } });
      const buckets = new Map<string, number>();
      let total = 0;
      for (const c of claims) {
        const bal = Math.max(c.billedCents - c.paidCents - c.adjustedCents, 0);
        if (!bal) continue;
        total += bal;
        const b = agingBucket(Math.floor((now.getTime() - (c.submittedAt ?? c.createdAt).getTime()) / 86_400_000));
        buckets.set(b, (buckets.get(b) ?? 0) + bal);
      }
      const over90 = buckets.get("90+ days") ?? 0;
      return { value: $(total), sub: "open A/R", href: "/billing/reports?r=aging", tone: total && over90 / total > 0.25 ? "bad" : "ok", rows: ["0-30 days", "31-60 days", "61-90 days", "90+ days"].map((b) => ({ label: b, value: $(buckets.get(b) ?? 0), tone: b === "90+ days" && over90 ? "warn" : undefined })) };
    }
    case "collections": {
      const m0 = startOfMonth();
      const m1 = startOfMonth(new Date(m0.getFullYear(), m0.getMonth() - 1, 1));
      const [cur, prev] = await Promise.all([
        prisma.deposit.aggregate({ where: { practiceId: p, postedAt: { gte: m0 } }, _sum: { totalCents: true } }),
        prisma.deposit.aggregate({ where: { practiceId: p, postedAt: { gte: m1, lt: m0 } }, _sum: { totalCents: true } }),
      ]);
      const c = cur._sum.totalCents ?? 0;
      const pv = prev._sum.totalCents ?? 0;
      return { value: $(c), sub: "received month to date", href: "/billing/reports?r=collections", rows: [{ label: "Last month", value: $(pv) }, { label: "Change", value: pv ? `${c >= pv ? "+" : ""}${Math.round(((c - pv) / pv) * 100)}%` : "—", tone: pv && c < pv ? "warn" : "ok" }] };
    }
    case "denials": {
      const [open, appeals] = await Promise.all([
        prisma.claimDenial.findMany({ where: { practiceId: p, status: "OPEN" }, select: { amountCents: true, category: true } }),
        prisma.task.count({ where: { practiceId: p, status: "OPEN", type: "APPEAL_DEADLINE" } }),
      ]);
      const byCat = new Map<string, number>();
      for (const d of open) byCat.set(d.category ?? "Other", (byCat.get(d.category ?? "Other") ?? 0) + 1);
      return { value: open.length, sub: `${$(open.reduce((s, d) => s + (d.amountCents ?? 0), 0))} denied · ${appeals} appeal deadline${appeals === 1 ? "" : "s"} near`, href: "/billing/denials", tone: appeals ? "bad" : open.length ? "warn" : "ok", rows: [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([l, v]) => ({ label: l, value: v })) };
    }
    case "payers": {
      const claims = await prisma.claim.findMany({ where: { practiceId: p, status: { not: "VOID" }, payerRank: "PRIMARY", createdAt: { gte: startOfMonth() } }, select: { payerName: true, billedCents: true } });
      const by = new Map<string, number>();
      for (const c of claims) by.set(c.payerName, (by.get(c.payerName) ?? 0) + c.billedCents);
      const rows = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      return { value: by.size, sub: "payers billed this month", href: "/billing/reports?r=payer_mix", rows: rows.map(([l, v]) => ({ label: l, value: $(v) })) };
    }
    case "credentialing": {
      const alerts = await getCredentialingAlerts([p]);
      return { value: alerts.length, sub: "alerts", href: "/credentialing", tone: alerts.length ? "warn" : "ok", rows: alerts.slice(0, 4).map((a) => ({ label: a.title, value: a.severity === "high" ? "high" : "", href: a.href, tone: a.severity === "high" ? "bad" : "warn" })) };
    }
  }
  return null;
}
