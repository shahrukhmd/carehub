// Background jobs every 15 minutes: Patient Connect automations (reminders, forms, surveys), overdue referral
// follow-ups, and the nightly eligibility run for the next business day.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.CAREHUB_AUTOMATIONS === "off") return;
  const [{ runAutomations }, { flagOverdueReferrals }, { runNightlyEligibility }] = await Promise.all([
    import("@/lib/connect/core"),
    import("@/lib/referrals"),
    import("@/lib/eligibility-batch"),
  ]);
  const g = globalThis as { __carehubAutomations?: NodeJS.Timeout };
  if (g.__carehubAutomations) return;
  const tick = async () => {
    for (const [name, job] of [
      ["patient-connect", () => runAutomations()],
      ["referrals", () => flagOverdueReferrals()],
      ["eligibility", () => runNightlyEligibility()],
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
