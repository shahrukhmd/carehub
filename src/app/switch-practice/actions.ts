"use server";

import { redirect } from "next/navigation";
import { setActivePractice } from "@/lib/auth";

export async function switchPractice(formData: FormData) {
  const practiceId = String(formData.get("practiceId") ?? "");
  if (!practiceId) return;
  await setActivePractice(practiceId);
  redirect("/");
}
