// Background jobs run on the scheduler in src/lib/jobs.ts (pg-boss on PostgreSQL): one run per schedule even with
// several server processes, a run log per job, and "Run now" from Settings -> Automation runs.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.CAREHUB_AUTOMATIONS === "off") return;
  const { startJobRunner } = await import("@/lib/jobs");
  startJobRunner().catch((err) => console.error("[jobs] scheduler failed to start", err));
}
