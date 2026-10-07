import "server-only";
import { prisma } from "@/lib/prisma";

// Background jobs on a real scheduler (pg-boss on the PostgreSQL database): each job has a cron schedule, runs
// once even when several server processes are up, and writes a run log an administrator can see and re-run
// from Settings -> Automation runs. CAREHUB_AUTOMATIONS=off keeps the scheduler from starting.

export type JobDef = { key: string; label: string; cron: string; about: string; run: () => Promise<string | number | void> };

const summarize = (r: string | number | void) => (typeof r === "number" ? `${r} record${r === 1 ? "" : "s"}` : r ?? "done");

export const JOBS: JobDef[] = [
  {
    key: "patient-connect",
    label: "Patient Connect automations",
    cron: "*/15 * * * *",
    about: "Appointment reminders, intake forms and surveys due to go out",
    run: async () => summarize(await (await import("@/lib/connect/core")).runAutomations()),
  },
  {
    key: "referrals",
    label: "Overdue referral follow-ups",
    cron: "0 * * * *",
    about: "Sent referrals with no consult note after the practice's follow-up days",
    run: async () => summarize(await (await import("@/lib/referrals")).flagOverdueReferrals()),
  },
  {
    key: "eligibility",
    label: "Nightly eligibility batch",
    cron: "0 2 * * *",
    about: "Coverage checks for the next business day's visits, for practices with the batch switched on",
    run: async () => summarize(await (await import("@/lib/eligibility-batch")).runNightlyEligibility()),
  },
  {
    key: "appeal-deadlines",
    label: "Appeal deadline alerts",
    cron: "0 6 * * *",
    about: "Tasks for denials whose appeal deadline is inside the practice's alert window",
    run: async () => summarize(await (await import("@/lib/denials")).flagAppealDeadlines()),
  },
  {
    key: "ar-followups",
    label: "AR follow-up engine",
    cron: "30 1 * * *",
    about: "Opens items for claims with no payer response, escalates items past their SLA, refreshes priorities",
    run: async () => summarize(await (await import("@/lib/followups")).runFollowUpJob()),
  },
  {
    key: "payment-plans",
    label: "Payment plan instalments",
    cron: "15 1 * * *",
    about: "Marks missed instalments, raises tasks, defaults a plan after two misses",
    run: async () => summarize(await (await import("@/lib/statements")).runPaymentPlanJob()),
  },
  {
    key: "report-subscriptions",
    label: "Report subscriptions",
    cron: "30 6 * * *",
    about: "Emails each user's scheduled reports as CSV (daily, Mondays, first of the month)",
    run: async () => summarize(await (await import("@/lib/report-catalog")).runReportSubscriptions()),
  },
  {
    key: "monitoring",
    label: "Monitoring rules",
    cron: "0 7 * * *",
    about: "Runs every practice's data-quality checks and raises findings as tasks and emails",
    run: async () => summarize(await (await import("@/lib/report-catalog")).runMonitoring()),
  },
  {
    key: "report-subscriptions",
    label: "Report subscriptions",
    cron: "30 6 * * *",
    about: "Emails each user's scheduled reports as CSV (daily, Mondays, first of the month)",
    run: async () => summarize(await (await import("@/lib/report-catalog")).runReportSubscriptions()),
  },
  {
    key: "monitoring",
    label: "Monitoring rules",
    cron: "0 7 * * *",
    about: "Runs every practice's data-quality checks and raises findings as tasks and emails",
    run: async () => summarize(await (await import("@/lib/report-catalog")).runMonitoring()),
  },
  {
    key: "alerts-expire",
    label: "Expire patient alerts",
    cron: "10 0 * * *",
    about: "Closes patient alerts whose end date has passed",
    run: async () => summarize(await (await import("@/lib/patient-alerts")).expireAlerts()),
  },
];

export const jobByKey = (key: string) => JOBS.find((j) => j.key === key) ?? null;

// Runs one job now and records it. Used by the scheduler and by the "Run now" button.
export async function runJob(key: string, triggeredBy: "SCHEDULE" | "MANUAL", userId?: string | null) {
  const job = jobByKey(key);
  if (!job) throw new Error(`Unknown job ${key}`);
  const run = await prisma.jobRun.create({ data: { job: key, triggeredBy, userId: userId ?? null } });
  try {
    const summary = await job.run();
    await prisma.jobRun.update({ where: { id: run.id }, data: { status: "OK", finishedAt: new Date(), summary: String(summary ?? "done").slice(0, 500) } });
    return { ok: true as const, summary: String(summary ?? "done") };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.jobRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), error: message.slice(0, 1000) } });
    console.error(`[job:${key}] failed`, err);
    return { ok: false as const, summary: message };
  }
}

// The last run of every job, for the settings screen.
export async function jobStatus() {
  const runs = await prisma.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 200 });
  return JOBS.map((j) => ({ ...j, last: runs.find((r) => r.job === j.key) ?? null, recent: runs.filter((r) => r.job === j.key).slice(0, 5) }));
}

// Starts pg-boss once per process and registers every job on its schedule.
export async function startJobRunner() {
  const g = globalThis as { __carehubJobRunner?: Promise<void> };
  if (g.__carehubJobRunner) return g.__carehubJobRunner;
  g.__carehubJobRunner = (async () => {
    const url = process.env.DATABASE_URL;
    if (!url || !url.startsWith("postgres")) {
      console.warn("[jobs] DATABASE_URL is not PostgreSQL; the scheduler is off");
      return;
    }
    const { PgBoss } = await import("pg-boss");
    const boss = new PgBoss({ connectionString: url, schema: "pgboss" });
    boss.on("error", (err: Error) => console.error("[jobs] pg-boss error", err));
    await boss.start();
    for (const job of JOBS) {
      await boss.createQueue(job.key);
      await boss.schedule(job.key, job.cron, {}, { tz: process.env.CAREHUB_TZ ?? "America/New_York" });
      await boss.work(job.key, async () => {
        await runJob(job.key, "SCHEDULE");
      });
    }
    console.log(`[jobs] scheduler running with ${JOBS.length} jobs`);
  })();
  return g.__carehubJobRunner;
}
