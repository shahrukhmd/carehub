"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

const MAX_BYTES = 300_000;

export async function saveMySignature(formData: FormData) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  const value = String(formData.get("signature") ?? "");
  if (formData.get("confirm") !== "on") redirect("/settings/signature?error=" + encodeURIComponent("Confirm that you adopt the signature."));
  if (!value) redirect("/settings/signature?error=" + encodeURIComponent("Draw or upload a signature first."));
  // Only an image data URL from the pad is accepted.
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value) || value.length > MAX_BYTES) {
    redirect("/settings/signature?error=" + encodeURIComponent("The signature image is invalid or too large."));
  }
  await prisma.user.update({ where: { id: user.id }, data: { signatureImage: value, signatureUpdatedAt: new Date() } });
  await logAudit(user.practiceId, user.id, "SIGNATURE_UPDATED", "User", user.id);
  redirect("/settings/signature?saved=1");
}
