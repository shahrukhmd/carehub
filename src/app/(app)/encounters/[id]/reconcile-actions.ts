"use server";

import { rolesFor } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { assertChartEditable } from "@/lib/visit-guard";

const FIELD = { meds: "medsReconciledAt", allergies: "allergiesReconciledAt", problems: "problemsReconciledAt" } as const;
const NOTE_FIELDS = ["chiefComplaint", "subjective", "objective", "assessment", "plan"] as const;

function done(encounterId: string, step: string): never {
  revalidatePath(`/encounters/${encounterId}`, "layout");
  redirect(`/encounters/${encounterId}?step=${step}`);
}

// Confirms the clinician went over the list with the patient at this visit. Clicking again clears it.
export async function toggleReconciled(encounterId: string, what: keyof typeof FIELD) {
  const user = await requireUser(rolesFor("chart.edit"));
  await assertChartEditable(encounterId, user, "clinical");
  const field = FIELD[what];
  if (!field) redirect(`/encounters/${encounterId}`);
  const encounter = await prisma.encounter.findFirstOrThrow({ where: { id: encounterId, practiceId: user.practiceId } });
  const on = !encounter[field];
  await prisma.encounter.update({ where: { id: encounter.id }, data: { [field]: on ? new Date() : null, ...(on ? { reconciledById: user.id } : {}) } });
  await logAudit(user.practiceId, user.id, on ? "RECONCILE" : "UNRECONCILE", "Encounter", encounter.id, what);
  done(encounterId, "meds");
}

export async function setTransferOfCare(encounterId: string, fd: FormData) {
  const user = await requireUser(rolesFor("chart.edit"));
  await assertChartEditable(encounterId, user, "clinical");
  const encounter = await prisma.encounter.findFirstOrThrow({ where: { id: encounterId, practiceId: user.practiceId } });
  await prisma.encounter.update({ where: { id: encounter.id }, data: { transferOfCare: fd.get("transferOfCare") === "on" } });
  done(encounterId, "meds");
}

// "Start from the last visit": fills the empty note sections and, when this visit has no diagnoses yet, the
// diagnoses from the patient's previous visit. Nothing already written is overwritten, and the note says where
// it came from so the clinician reviews every section.
export async function copyForward(encounterId: string, fromId: string) {
  const user = await requireUser(rolesFor("chart.edit"));
  await assertChartEditable(encounterId, user, "clinical");
  const encounter = await prisma.encounter.findFirstOrThrow({ where: { id: encounterId, practiceId: user.practiceId }, include: { diagnoses: true } });
  const from = await prisma.encounter.findFirst({
    where: { id: fromId, practiceId: user.practiceId, patientId: encounter.patientId, date: { lt: encounter.date } },
    include: { diagnoses: { orderBy: { priority: "asc" } } },
  });
  if (!from) redirect(`/encounters/${encounterId}?step=cc&error=${encodeURIComponent("That earlier visit was not found.")}`);

  const data: Record<string, string> = {};
  for (const f of NOTE_FIELDS) if (!encounter[f] && from[f]) data[f] = from[f]!;
  const copyDx = encounter.diagnoses.length === 0 && from.diagnoses.length > 0;
  await prisma.$transaction([
    prisma.encounter.update({ where: { id: encounter.id }, data: { ...data, copiedFromEncounterId: from.id } }),
    ...(copyDx ? [prisma.encounterDiagnosis.createMany({ data: from.diagnoses.map((d) => ({ encounterId: encounter.id, icd10: d.icd10, description: d.description, priority: d.priority })) })] : []),
    prisma.encounterEvent.create({
      data: { encounterId: encounter.id, userId: user.id, fromStatus: encounter.status, toStatus: encounter.status, note: `Note started from the visit on ${from.date.toISOString().slice(0, 10)} (copy forward)` },
    }),
  ]);
  await logAudit(user.practiceId, user.id, "COPY_FORWARD", "Encounter", encounter.id, `from ${from.id}: ${Object.keys(data).join(", ") || "no note sections"}${copyDx ? " + diagnoses" : ""}`);
  done(encounterId, "cc");
}
