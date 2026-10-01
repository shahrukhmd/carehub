// Background jobs every 15 minutes: Patient Connect automations (reminders, forms, surveys), overdue referral
// follow-ups, the nightly eligibility run for the next business day, and appeal deadline alerts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.CAREHUB_AUTOMATIONS === "off") return;
  const [{ runAutomations }, { flagOverdueReferrals }, { runNightlyEligibility }, { flagAppealDeadlines }] = await Promise.all([
    import("@/lib/connect/core"),
    import("@/lib/referrals"),
    import("@/lib/eligibility-batch"),
    import("@/lib/denials"),
  ]);
  const g = globalThis as { __carehubAutomations?: NodeJS.Timeout };
  if (g.__carehubAutomations) return;
  const tick = async () => {
    for (const [name, job] of [
      ["patient-connect", () => runAutomations()],
      ["referrals", () => flagOverdueReferrals()],
      ["eligibility", () => runNightlyEligibility()],
      ["appeal-deadlines", () => flagAppealDeadlines()],
    ] as const) {
      try {
        await job();
      } catch (err) {
        console.error(`[background:${name}] failed`, err);
      }
    }
  };
  g.__carehubAutomations = setInterval(tick, 15 * 60_000);
  setTimeout(tick, 60_000);
}
