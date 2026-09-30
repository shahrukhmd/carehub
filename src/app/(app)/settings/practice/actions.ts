"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { CLEARINGHOUSES } from "@/lib/practice-settings";
import { FAX_PROVIDERS } from "@/lib/fax";
import { normalizePhone } from "@/lib/patient-docs";

const ADDRESS_BLOCKS = ["payTo", "payee", "remit", "physical"] as const;
const ADDRESS_PARTS = ["Name", "Address1", "Address2", "City", "State", "Zip"] as const;

export async function savePracticeSettings(fd: FormData) {
  const user = await requireUser(["ADMIN"]);
  const str = (k: string) => String(fd.get(k) ?? "").trim() || null;
  const on = (k: string) => fd.get(k) === "on";
  const errors: string[] = [];

  const data: Record<string, string | number | boolean | null> = {};
  for (const block of ADDRESS_BLOCKS) {
    for (const part of ADDRESS_PARTS) {
      const key = `${block}${part}`;
      let v = str(key);
      if (v && part === "State") v = v.toUpperCase().slice(0, 2);
      if (v && part === "Zip" && !/^\d{5}(-?\d{4})?$/.test(v)) errors.push(`${key.replace(/([A-Z])/g, " $1")}: ZIP must be 5 or 9 digits.`);
      data[key] = v ? v.slice(0, 120) : null;
    }
  }
  const taxId = str("practiceTaxId");
  if (taxId && !/^\d{2}-?\d{7}$/.test(taxId)) errors.push("Practice tax ID must be 9 digits (NN-NNNNNNN).");
  const cutoff = str("cutoffDay");
  const cutoffDay = cutoff ? Number(cutoff) : null;
  if (cutoffDay !== null && !(Number.isInteger(cutoffDay) && cutoffDay >= 1 && cutoffDay <= 28)) errors.push("Cutoff day must be 1–28.");
  const yearEnd = Number(str("yearEndMonth") ?? 12);
  const clearinghouse = str("clearinghouse") ?? "MOCK";
  const faxRaw = str("faxNumber");
  const faxNumber = faxRaw ? normalizePhone(faxRaw) : null;
  if (faxRaw && !faxNumber) errors.push("Fax number must be 10 digits.");
  if (!(clearinghouse in CLEARINGHOUSES)) errors.push("Pick a clearinghouse.");

  if (errors.length) redirect(`/settings/practice?error=${encodeURIComponent(errors.join(" ").slice(0, 300))}`);

  Object.assign(data, {
    yearEndMonth: Number.isInteger(yearEnd) && yearEnd >= 1 && yearEnd <= 12 ? yearEnd : 12,
    taxIdSource: str("taxIdSource") === "PRACTICE" ? "PRACTICE" : "ACCOUNT",
    practiceTaxId: taxId,
    useVisitNumbers: on("useVisitNumbers"),
    cutoffDay,
    cutoffLastDay: on("cutoffLastDay"),
    cutoffMonth: str("cutoffMonth") === "SAME" ? "SAME" : "FOLLOWING",
    billingPhone: str("billingPhone"),
    allowZeroChargeClaims: on("allowZeroChargeClaims"),
    includeEmergencyFlag: on("includeEmergencyFlag"),
    allowEdiVoid: on("allowEdiVoid"),
    enableClaimRules: on("enableClaimRules"),
    suppressSecondaryEraAdjustments: on("suppressSecondaryEraAdjustments"),
    holdClaimsForCredentialing: on("holdClaimsForCredentialing"),
    documentAiEnabled: on("documentAiEnabled"),
    faxNumber: faxNumber,
    faxProvider: str("faxProvider") && str("faxProvider")! in FAX_PROVIDERS ? str("faxProvider")! : "MOCK",
    clearinghouse,
  });
  await prisma.practiceSettings.upsert({
    where: { practiceId: user.practiceId },
    update: data,
    create: { practiceId: user.practiceId, ...data },
  });
  await logAudit(user.practiceId, user.id, "UPDATE_PRACTICE_SETTINGS", "PracticeSettings", user.practiceId, "general settings");
  revalidatePath("/settings/practice");
  revalidatePath("/billing", "layout");
  redirect("/settings/practice?saved=1");
}
