"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { rolesFor } from "@/lib/permissions";
import { closePeriod, markDeposited, parseBankCsv, reconcileDeposits, reopenPeriod } from "@/lib/period-close";
import { formatMoney } from "@/lib/format";

const str = (fd: FormData, k: string, max = 300) => String(fd.get(k) ?? "").trim().slice(0, max);
function back(q: Record<string, string | undefined>): never {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) u.set(k, v);
  revalidatePath("/billing/close");
  revalidatePath("/billing");
  redirect(`/billing/close?${u}`);
}

export async function closeMonth(fd: FormData) {
  const user = await requireUser(rolesFor("settings.admin"));
  const period = str(fd, "period", 7);
  if (!/^\d{4}-\d{2}$/.test(period)) back({ error: "Pick the month." });
  const note = str(fd, "note", 500) || null;
  let failed: string | null = null;
  try {
    const r = await closePeriod(user.practiceId, period, user.id, note);
    await logAudit(user.practiceId, user.id, "CLOSE_PERIOD", "PeriodClose", r.close.id, `${period}: charges ${formatMoney(r.snapshot.chargesCents)}, deposits ${formatMoney(r.snapshot.depositsCents)}${note ? ` · ${note}` : ""}`);
  } catch (err) {
    failed = err instanceof Error ? err.message : "Could not close the month.";
  }
  if (failed) back({ period, error: failed });
  back({ period, ok: `${period} closed. Posting on or before its last day is now refused.` });
}

export async function reopenMonth(fd: FormData) {
  const user = await requireUser(rolesFor("settings.admin"));
  const period = str(fd, "period", 7);
  const reason = str(fd, "reason", 300);
  if (!reason) back({ period, error: "Say why the month is being reopened." });
  let failed: string | null = null;
  try {
    await reopenPeriod(user.practiceId, period, user.id, reason);
    await logAudit(user.practiceId, user.id, "REOPEN_PERIOD", "PeriodClose", undefined, `${period}: ${reason}`);
  } catch (err) {
    failed = err instanceof Error ? err.message : "Could not reopen the month.";
  }
  if (failed) back({ period, error: failed });
  back({ period, ok: `${period} reopened: ${reason}` });
}

export async function depositSlip(fd: FormData) {
  const user = await requireUser(rolesFor("billing.work"));
  const ids = fd.getAll("deposit").map(String);
  const dateRaw = str(fd, "depositDate", 10);
  if (ids.length === 0) back({ tab: "deposits", error: "Tick the deposits that went to the bank together." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) back({ tab: "deposits", error: "Pick the bank deposit date." });
  const r = await markDeposited(user.practiceId, ids, new Date(`${dateRaw}T12:00:00`), str(fd, "bankAccount", 60) || null);
  await logAudit(user.practiceId, user.id, "DEPOSIT_SLIP", "Deposit", undefined, `${r.count} deposits dated ${dateRaw}`);
  back({ tab: "deposits", ok: `${r.count} deposit${r.count === 1 ? "" : "s"} marked deposited on ${dateRaw}.` });
}

export async function importBankStatement(fd: FormData) {
  const user = await requireUser(rolesFor("billing.work"));
  const file = fd.get("file");
  const pasted = str(fd, "csv", 200_000);
  const text = file instanceof File && file.size > 0 ? await file.text() : pasted;
  if (!text.trim()) back({ tab: "deposits", error: "Upload or paste the bank statement CSV." });
  const lines = parseBankCsv(text);
  if (lines.length === 0) back({ tab: "deposits", error: "No credit lines were found — the CSV needs date and amount columns." });
  const r = await reconcileDeposits(user.practiceId, lines, user.id);
  await logAudit(user.practiceId, user.id, "BANK_RECONCILE", "Deposit", undefined, `${lines.length} bank lines · ${r.matched.length} matched · ${r.unmatched.length} unmatched`);
  back({ tab: "deposits", ok: `${r.matched.length} of ${lines.length} bank credits matched to deposits and reconciled${r.unmatched.length ? `; ${r.unmatched.length} unmatched (listed below)` : ""}.` });
}
