"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { mergePatients, pairKey } from "@/lib/patient-merge";

export async function mergeCharts(fd: FormData) {
  const user = await requireUser(["ADMIN"]);
  const keep = String(fd.get("keep") ?? "");
  const a = String(fd.get("a") ?? "");
  const b = String(fd.get("b") ?? "");
  const other = keep === a ? b : a;
  if (fd.get("confirm") !== "on") redirect(`/settings/patients/merge?a=${a}&b=${b}&error=${encodeURIComponent("Tick the box to confirm the merge.")}`);
  let result: { moved: string } | null = null;
  try {
    result = await mergePatients(user.practiceId, keep, other, user.id);
  } catch (err) {
    redirect(`/settings/patients/merge?a=${a}&b=${b}&error=${encodeURIComponent((err as Error).message)}`);
  }
  revalidatePath("/settings/patients");
  revalidatePath("/patients");
  redirect(`/patients/${keep}?merged=${encodeURIComponent(result?.moved || "nothing to move")}`);
}

export async function dismissPair(a: string, b: string) {
  const user = await requireUser(["ADMIN"]);
  const found = await prisma.patient.count({ where: { id: { in: [a, b] }, practiceId: user.practiceId } });
  if (found === 2) {
    await prisma.duplicateDismissal.upsert({
      where: { practiceId_pairKey: { practiceId: user.practiceId, pairKey: pairKey(a, b) } },
      update: {},
      create: { practiceId: user.practiceId, pairKey: pairKey(a, b), userId: user.id },
    });
    await logAudit(user.practiceId, user.id, "NOT_DUPLICATE", "Patient", a, `Not the same person as ${b}`);
  }
  revalidatePath("/settings/patients");
  redirect("/settings/patients");
}
