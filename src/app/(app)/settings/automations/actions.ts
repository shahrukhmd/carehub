"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { rolesFor } from "@/lib/permissions";
import { jobByKey, runJob } from "@/lib/jobs";

// "Run now" for one background job; the run is logged like a scheduled one.
export async function runJobNow(key: string) {
  const user = await requireUser(rolesFor("settings.admin"));
  const job = jobByKey(key);
  if (!job) redirect("/settings/automations?error=Unknown%20job");
  const result = await runJob(key, "MANUAL", user.id);
  await logAudit(user.practiceId, user.id, "RUN_JOB", "Job", key, `${job!.label}: ${result.ok ? result.summary : `failed — ${result.summary}`}`);
  revalidatePath("/settings/automations");
  redirect(`/settings/automations?${result.ok ? "ok" : "error"}=${encodeURIComponent(`${job!.label}: ${result.summary}`)}`);
}
