"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { PATIENT_EDIT_ROLES } from "@/lib/gateway";
import { PAYER_RANKS, relationshipToInsuredLabel } from "@/lib/claim-format";

function text(fd: FormData, key: string) {
  const v = String(fd.get(key) ?? "").trim();
  return v || null;
}

function date(fd: FormData, key: string) {
  const v = text(fd, key);
  return v ? new Date(v) : null;
}

// Add or update one of the patient's coverages (primary / secondary / tertiary) with subscriber details.
export async function savePatientInsurance(patientId: string, insuranceId: string | null, fd: FormData) {
  const user = await requireUser([...PATIENT_EDIT_ROLES, "BILLER"]);
  const patient = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId } });
  if (!patient) throw new Error("Patient not found");
  const back = `/patients/${patientId}/insurance`;

  const payerId = text(fd, "payerId");
  const memberId = text(fd, "memberId");
  const rank = text(fd, "rank") ?? "PRIMARY";
  const relationship = text(fd, "relationshipToInsured") ?? "18";
  const fail = (m: string) => redirect(`${back}?error=${encodeURIComponent(m)}`);
  if (!payerId || !(await prisma.payer.findFirst({ where: { id: payerId, practiceId: user.practiceId } }))) fail("Pick an insurance payer.");
  if (!memberId) fail("Member / subscriber ID is required.");
  if (!PAYER_RANKS.includes(rank)) fail("Invalid coverage rank.");
  if (!(relationship in relationshipToInsuredLabel)) fail("Invalid relationship.");
  if (relationship !== "18" && (!text(fd, "insuredLastName") || !text(fd, "insuredFirstName"))) {
    fail("Enter the insured's name when the patient isn't the subscriber.");
  }
  const existing = insuranceId ? await prisma.insurance.findFirst({ where: { id: insuranceId, patientId } }) : null;
  if (insuranceId && !existing) fail("Coverage not found.");

  const data = {
    payerId: payerId!,
    memberId: memberId!,
    groupNumber: text(fd, "groupNumber"),
    planName: text(fd, "planName"),
    rank,
    isPrimary: rank === "PRIMARY",
    relationshipToInsured: relationship,
    insuredFirstName: text(fd, "insuredFirstName"),
    insuredLastName: text(fd, "insuredLastName"),
    insuredDob: date(fd, "insuredDob"),
    insuredSex: text(fd, "insuredSex"),
    insuredAddressLine1: text(fd, "insuredAddressLine1"),
    insuredCity: text(fd, "insuredCity"),
    insuredState: text(fd, "insuredState"),
    insuredZip: text(fd, "insuredZip"),
    effectiveDate: date(fd, "effectiveDate"),
    terminationDate: date(fd, "terminationDate"),
    active: fd.get("activeField") ? fd.get("active") === "on" : true,
  };

  // Only one active coverage per rank: the one being saved takes the slot.
  if (data.active) {
    await prisma.insurance.updateMany({
      where: { patientId, rank, active: true, ...(insuranceId ? { id: { not: insuranceId } } : {}) },
      data: { active: false, isPrimary: false },
    });
  }
  const saved = existing
    ? await prisma.insurance.update({ where: { id: existing.id }, data })
    : await prisma.insurance.create({ data: { ...data, patientId } });
  await logAudit(user.practiceId, user.id, existing ? "UPDATE_INSURANCE" : "ADD_INSURANCE", "Insurance", saved.id, rank);
  revalidatePath(`/patients/${patientId}`);
  revalidatePath(back);
  redirect(back);
}
