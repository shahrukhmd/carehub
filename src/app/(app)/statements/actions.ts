"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { rolesFor } from "@/lib/permissions";
import { PLAN_FREQUENCIES, STATEMENT_CHANNELS, createPaymentPlan, decideCollections, recordInstallment, runStatements } from "@/lib/statements";
import { PAY_METHODS } from "@/lib/checkout";

const str = (fd: FormData, k: string, max = 300) => String(fd.get(k) ?? "").trim().slice(0, max);
function back(tab: string, msg: { ok?: string; error?: string }): never {
  revalidatePath("/statements");
  redirect(`/statements?tab=${tab}${msg.error ? `&error=${encodeURIComponent(msg.error)}` : msg.ok ? `&ok=${encodeURIComponent(msg.ok)}` : ""}`);
}

// Generate statements for the ticked guarantors (or everyone eligible when none are ticked).
export async function runStatementCycle(fd: FormData) {
  const user = await requireUser(rolesFor("billing.work"));
  const picked = fd.getAll("guarantor").map(String);
  const h = await headers();
  const origin = h.get("origin") ?? (h.get("host") ? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}` : null);
  const r = await runStatements(user.practiceId, user.id, picked.length ? picked : null, origin);
  await logAudit(user.practiceId, user.id, "STATEMENT_RUN", "StatementRun", r.run?.id, `${r.created} statements · ${r.sent} sent electronically · ${r.toCollections} to collections`);
  if (r.created === 0) back("run", { error: "Nothing was eligible: every guarantor is on hold, on a plan, in collections, under the minimum, or had a statement too recently." });
  back("log", { ok: `${r.created} statement${r.created === 1 ? "" : "s"} generated${r.sent ? `, ${r.sent} sent by email or portal` : ""}${r.toCollections ? `, ${r.toCollections} account${r.toCollections === 1 ? "" : "s"} moved to collections review` : ""}. Paper statements print from the log.` });
}

// ---- Patient statement preference and hold (from the patient's account page) ----
export async function saveStatementPreference(patientId: string, fd: FormData) {
  const user = await requireUser(rolesFor("payments.take"));
  const patient = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId }, select: { id: true } });
  if (!patient) redirect("/patients");
  const pref = str(fd, "statementPreference", 10);
  const hold = fd.get("statementHold") === "on";
  const reason = str(fd, "statementHoldReason", 200);
  const until = str(fd, "statementHoldUntil", 10);
  if (hold && !reason) redirect(`/patients/${patientId}/claims?error=${encodeURIComponent("Say why statements are on hold.")}`);
  await prisma.patient.update({
    where: { id: patientId },
    data: { statementPreference: pref in STATEMENT_CHANNELS ? pref : "PAPER", statementHold: hold, statementHoldReason: hold ? reason : null, statementHoldUntil: hold && /^\d{4}-\d{2}-\d{2}$/.test(until) ? new Date(`${until}T00:00:00`) : null },
  });
  await logAudit(user.practiceId, user.id, "STATEMENT_PREFERENCE", "Patient", patientId, `${pref}${hold ? ` · hold: ${reason}` : ""}`);
  revalidatePath(`/patients/${patientId}`, "layout");
  redirect(`/patients/${patientId}/claims?ok=${encodeURIComponent("Statement settings saved.")}`);
}

// ---- Payment plans ----
export async function startPaymentPlan(fd: FormData) {
  const user = await requireUser(rolesFor("payments.take"));
  const patientId = str(fd, "patientId", 40);
  const patient = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId }, select: { id: true } });
  if (!patient) back("plans", { error: "Pick the patient." });
  const total = Math.round(Number(str(fd, "total", 12).replace(/[$,\s]/g, "")) * 100);
  const installment = Math.round(Number(str(fd, "installment", 12).replace(/[$,\s]/g, "")) * 100);
  if (!(total > 0) || !(installment > 0) || installment > total) back("plans", { error: "Enter the plan total and an instalment amount no larger than the total." });
  const first = str(fd, "firstDueAt", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(first)) back("plans", { error: "Pick the first due date." });
  const frequency = str(fd, "frequency", 10);
  if (!(frequency in PLAN_FREQUENCIES)) back("plans", { error: "Pick how often instalments are due." });
  if (await prisma.paymentPlan.findFirst({ where: { patientId, status: "ACTIVE" } })) back("plans", { error: "This patient already has an active plan." });
  const plan = await createPaymentPlan({ practiceId: user.practiceId, patientId, totalCents: total, installmentCents: installment, frequency, firstDueAt: new Date(`${first}T09:00:00`), method: str(fd, "method", 20), cardRef: str(fd, "cardRef", 40) || null, note: str(fd, "note", 300) || null, userId: user.id });
  await logAudit(user.practiceId, user.id, "CREATE_PAYMENT_PLAN", "PaymentPlan", plan.id, `${(total / 100).toFixed(2)} in ${(installment / 100).toFixed(2)} ${frequency.toLowerCase()} instalments`);
  back("plans", { ok: "Payment plan set up. Statements pause while it is active." });
}

export async function postInstallment(planId: string, installmentId: string, fd: FormData) {
  const user = await requireUser(rolesFor("payments.take"));
  const method = str(fd, "method", 10);
  if (!(method in PAY_METHODS)) back("plans", { error: "Pick how the instalment was paid." });
  await recordInstallment({ practiceId: user.practiceId, planId, installmentId, method, reference: str(fd, "reference", 60) || null, userId: user.id });
  await logAudit(user.practiceId, user.id, "PLAN_INSTALLMENT", "PaymentPlan", planId, method);
  back("plans", { ok: "Instalment posted and a receipt issued." });
}

export async function cancelPaymentPlan(planId: string, fd: FormData) {
  const user = await requireUser(rolesFor("billing.work"));
  const reason = str(fd, "reason", 200);
  if (!reason) back("plans", { error: "Say why the plan is cancelled." });
  const plan = await prisma.paymentPlan.findFirst({ where: { id: planId, practiceId: user.practiceId, status: "ACTIVE" } });
  if (!plan) back("plans", { error: "Plan not found." });
  await prisma.paymentPlan.update({ where: { id: plan!.id }, data: { status: "CANCELLED", note: reason } });
  await prisma.paymentPlanInstallment.updateMany({ where: { planId: plan!.id, status: { in: ["DUE", "MISSED"] } }, data: { status: "SKIPPED" } });
  await logAudit(user.practiceId, user.id, "CANCEL_PAYMENT_PLAN", "PaymentPlan", plan!.id, reason);
  back("plans", { ok: "Plan cancelled; the balance returns to the statement cycle." });
}

// ---- Collections ----
export async function decideCollectionsCase(caseId: string, fd: FormData) {
  const user = await requireUser(rolesFor("billing.work"));
  const decision = str(fd, "decision", 20) as "IN_HOUSE" | "REFERRED" | "WRITTEN_OFF" | "CLOSED";
  if (!["IN_HOUSE", "REFERRED", "WRITTEN_OFF", "CLOSED"].includes(decision)) back("collections", { error: "Pick a decision." });
  const agency = str(fd, "agency", 120) || null;
  const note = str(fd, "note", 300) || null;
  if (decision === "REFERRED" && !agency) back("collections", { error: "Name the collection agency." });
  if ((decision === "WRITTEN_OFF" || decision === "CLOSED") && !note) back("collections", { error: "Add a note with the reason." });
  await decideCollections({ practiceId: user.practiceId, caseId, decision, agency, note, userId: user.id });
  await logAudit(user.practiceId, user.id, "COLLECTIONS_DECISION", "CollectionsCase", caseId, `${decision}${agency ? ` · ${agency}` : ""}${note ? ` · ${note}` : ""}`);
  back("collections", { ok: `Recorded: ${decision === "REFERRED" ? `referred to ${agency}` : decision === "IN_HOUSE" ? "in-house calls" : decision === "WRITTEN_OFF" ? "written off" : "closed"}.` });
}
