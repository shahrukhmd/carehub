"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { runEligibilityCheck } from "@/lib/clearinghouse/service";
import { ELIGIBILITY_ROLES, runBatchEligibility } from "@/lib/eligibility-batch";

const day = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : null);

export async function checkAll(fd: FormData) {
  const user = await requireUser(ELIGIBILITY_ROLES);
  const from = day(String(fd.get("from") ?? "")) ?? new Date();
  const to = day(String(fd.get("to") ?? "")) ?? from;
  const end = new Date(to.getTime() + 86_400_000);
  if (end.getTime() - from.getTime() > 15 * 86_400_000) redirect(`/schedule/eligibility?error=${encodeURIComponent("Check up to two weeks at a time.")}`);
  const r = await runBatchEligibility(user.practiceId, from, end, user.id, fd.get("force") === "on" ? 0 : 7);
  revalidatePath("/schedule");
  const q = new URLSearchParams({ from: String(fd.get("from")), to: String(fd.get("to") || fd.get("from")), done: `${r.checked}|${r.skipped}|${r.noInsurance}|${r.problems.length}` });
  redirect(`/schedule/eligibility?${q}`);
}

export async function checkOne(appointmentId: string, fd: FormData) {
  const user = await requireUser(ELIGIBILITY_ROLES);
  const a = await prisma.appointment.findFirst({ where: { id: appointmentId, practiceId: user.practiceId } });
  if (a) await runEligibilityCheck({ practiceId: user.practiceId, patientId: a.patientId, appointmentId: a.id });
  revalidatePath("/schedule");
  redirect(`/schedule/eligibility?from=${fd.get("from")}&to=${fd.get("to")}`);
}

export async function setAutoEligibility(fd: FormData) {
  const user = await requireUser(["ADMIN"]);
  const on = fd.get("eligibilityAuto") === "on";
  await prisma.practiceSettings.upsert({ where: { practiceId: user.practiceId }, update: { eligibilityAuto: on }, create: { practiceId: user.practiceId, eligibilityAuto: on } });
  await logAudit(user.practiceId, user.id, "UPDATE_SETTINGS", "PracticeSettings", user.practiceId, `nightly eligibility ${on ? "on" : "off"}`);
  redirect("/schedule/eligibility");
}
