// Patient Connect automations: check the schedule every 15 minutes and send due reminders, forms and surveys.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.CAREHUB_AUTOMATIONS === "off") return;
  const { runAutomations } = await import("@/lib/connect/core");
  const g = globalThis as { __carehubAutomations?: NodeJS.Timeout };
  if (g.__carehubAutomations) return;
  const tick = () => runAutomations().catch((err) => console.error("[patient-connect] automations failed", err));
  g.__carehubAutomations = setInterval(tick, 15 * 60_000);
  setTimeout(tick, 60_000);
}
