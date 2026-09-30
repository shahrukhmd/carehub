"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { RX_WRITE_ROLES, allergyConflicts, prescriptionPdf } from "@/lib/prescriptions";
import { getFaxAdapter } from "@/lib/fax";
import { faxNumberOrNull } from "@/lib/fax";
import { IMMUNIZATION_ROLES, VACCINES } from "@/lib/immunizations";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const back = (fd: FormData, patientId: string, anchor: string) => {
  const b = str(fd, "back");
  return /^\/(patients|encounters)\/[a-z0-9]+$/.test(b) ? `${b}#${anchor}` : `/patients/${patientId}#${anchor}`;
};
function go(to: string, msg?: { error?: string; ok?: string }) {
  const [path, hash] = to.split("#");
  const q = msg?.error ? `rxError=${encodeURIComponent(msg.error)}` : msg?.ok ? `rxOk=${encodeURIComponent(msg.ok)}` : "";
  revalidatePath(path);
  redirect(`${path}${q ? `?${q}` : ""}${hash ? `#${hash}` : ""}`);
}

async function ownPatient(practiceId: string, id: string) {
  const p = await prisma.patient.findFirst({ where: { id, practiceId }, include: { allergies: true } });
  if (!p) throw new Error("Patient not found");
  return p;
}

// ---- Prescriptions ----

export async function createPrescription(patientId: string, fd: FormData) {
  const user = await requireUser(RX_WRITE_ROLES);
  const p = await ownPatient(user.practiceId, patientId);
  const to = back(fd, patientId, "rx");
  const drug = str(fd, "drug").slice(0, 120);
  const sig = str(fd, "sig").slice(0, 400);
  const quantity = str(fd, "quantity").slice(0, 20);
  if (!drug || !sig || !quantity) go(to, { error: "Drug, directions (sig) and quantity are required." });
  const refills = Number(str(fd, "refills") || "0");
  const days = Number(str(fd, "daysSupply") || "0");
  const conflicts = allergyConflicts(drug, p.allergies);
  const encounterId = str(fd, "encounterId") || null;
  const rx = await prisma.prescription.create({
    data: {
      practiceId: user.practiceId,
      patientId,
      encounterId: encounterId && (await prisma.encounter.findFirst({ where: { id: encounterId, patientId } })) ? encounterId : null,
      prescriberId: user.id,
      drug,
      strength: str(fd, "strength").slice(0, 40) || null,
      form: str(fd, "form").slice(0, 40) || null,
      route: str(fd, "route").slice(0, 40) || null,
      sig,
      quantity,
      quantityUnit: str(fd, "quantityUnit").slice(0, 30) || null,
      refills: Number.isInteger(refills) && refills >= 0 && refills <= 11 ? refills : 0,
      daysSupply: Number.isInteger(days) && days > 0 && days <= 365 ? days : null,
      dispenseAsWritten: fd.get("daw") === "on",
      controlled: fd.get("controlled") === "on",
      diagnosisCode: str(fd, "diagnosisCode").slice(0, 12) || null,
      pharmacyName: str(fd, "pharmacyName").slice(0, 120) || null,
      pharmacyPhone: str(fd, "pharmacyPhone").slice(0, 20) || null,
      pharmacyFax: str(fd, "pharmacyFax").slice(0, 20) || null,
      notes: str(fd, "notes").slice(0, 300) || null,
    },
  });
  await logAudit(user.practiceId, user.id, "CREATE_RX", "Prescription", rx.id, `${drug} for ${p.lastName}, ${p.firstName}`);
  go(to, conflicts.length ? { error: `Allergy warning: ${conflicts.map((a) => `${a.allergen} (${a.reaction || a.severity})`).join(", ")}. Review before signing.` } : { ok: "Prescription drafted — review and sign." });
}

export async function signPrescription(rxId: string, fd: FormData) {
  const user = await requireUser(RX_WRITE_ROLES);
  const rx = await prisma.prescription.findFirst({ where: { id: rxId, practiceId: user.practiceId }, include: { patient: { include: { allergies: true } } } });
  if (!rx) throw new Error("Prescription not found");
  const to = back(fd, rx.patientId, "rx");
  if (rx.status !== "DRAFT") go(to, { error: "Only drafts can be signed." });
  const conflicts = allergyConflicts(rx.drug, rx.patient.allergies);
  const override = str(fd, "override").slice(0, 200);
  if (conflicts.length && !override) go(to, { error: `This drug may conflict with the patient's allergy to ${conflicts.map((a) => a.allergen).join(", ")}. Enter a reason to override.` });
  const me = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const med = await prisma.medication.create({
    data: {
      patientId: rx.patientId,
      encounterId: rx.encounterId,
      prescriberId: user.id,
      name: [rx.drug, rx.strength, rx.form].filter(Boolean).join(" "),
      sig: rx.sig,
      status: "ACTIVE",
    },
  });
  await prisma.prescription.update({
    where: { id: rx.id },
    data: { status: "SIGNED", signedAt: new Date(), signedName: me.name, prescriberId: user.id, medicationId: med.id, allergyOverride: conflicts.length ? override : null },
  });
  await logAudit(user.practiceId, user.id, "SIGN_RX", "Prescription", rx.id, `${rx.drug}${override ? ` · allergy override: ${override}` : ""}`);
  go(to, { ok: me.signatureImage ? "Signed and added to the medication list. Print or fax it to the pharmacy." : "Signed. Add your signature image in Settings › My signature so it prints on prescriptions." });
}

export async function printPrescription(rxId: string) {
  const user = await requireUser(["ADMIN", "CLINICIAN", "FRONT_DESK"]);
  const rx = await prisma.prescription.findFirst({ where: { id: rxId, practiceId: user.practiceId } });
  if (!rx) throw new Error("Prescription not found");
  if (rx.status === "SIGNED") await prisma.prescription.update({ where: { id: rx.id }, data: { status: "PRINTED", sentVia: "PRINT", sentAt: new Date() } });
  await logAudit(user.practiceId, user.id, "PRINT_RX", "Prescription", rx.id, rx.drug);
  revalidatePath(`/patients/${rx.patientId}`);
  redirect(`/api/rx/${rx.id}`);
}

export async function faxPrescription(rxId: string, fd: FormData) {
  const user = await requireUser(["ADMIN", "CLINICIAN", "FRONT_DESK"]);
  const rx = await prisma.prescription.findFirst({ where: { id: rxId, practiceId: user.practiceId } });
  if (!rx) throw new Error("Prescription not found");
  const to = back(fd, rx.patientId, "rx");
  if (!["SIGNED", "PRINTED", "SENT"].includes(rx.status)) go(to, { error: "Sign the prescription before faxing it." });
  if (rx.controlled) go(to, { error: "Controlled substances can't be faxed — print it for a wet signature (or send by EPCS once e-prescribing is connected)." });
  const number = faxNumberOrNull(str(fd, "pharmacyFax") || rx.pharmacyFax);
  if (!number) go(to, { error: "Enter the pharmacy's 10-digit fax number." });
  await prescriptionPdf(rx.id, user.practiceId); // renders to confirm the document builds
  const settings = await prisma.practiceSettings.findUnique({ where: { practiceId: user.practiceId } });
  const result = await getFaxAdapter(settings?.faxProvider).send({ to: number!, recipientName: rx.pharmacyName, pages: 1, title: `Prescription ${rx.drug}` });
  const fax = await prisma.fax.create({
    data: {
      practiceId: user.practiceId,
      direction: "OUTBOUND",
      status: result.status,
      faxNumber: number!,
      recipientName: rx.pharmacyName ?? "Pharmacy",
      pages: 1,
      contentType: `Prescription: ${rx.drug}`,
      encounterId: rx.encounterId,
      patientId: rx.patientId,
      error: result.error ?? null,
      providerRef: result.providerRef ?? null,
      userId: user.id,
      sentAt: new Date(),
    },
  });
  if (result.status === "SUCCESS") await prisma.prescription.update({ where: { id: rx.id }, data: { status: "SENT", sentVia: "FAX", sentAt: new Date(), faxId: fax.id, pharmacyFax: number } });
  await logAudit(user.practiceId, user.id, "FAX_RX", "Prescription", rx.id, `${rx.drug} → ${number} ${result.status}`);
  go(to, result.status === "SUCCESS" ? { ok: `Faxed to ${rx.pharmacyName ?? number}.` } : { error: `Fax failed: ${result.error ?? "unknown error"}` });
}

export async function cancelPrescription(rxId: string, fd: FormData) {
  const user = await requireUser(RX_WRITE_ROLES);
  const rx = await prisma.prescription.findFirst({ where: { id: rxId, practiceId: user.practiceId } });
  if (!rx) throw new Error("Prescription not found");
  const reason = str(fd, "reason").slice(0, 200) || "Cancelled";
  await prisma.prescription.update({ where: { id: rx.id }, data: { status: "CANCELLED", cancelledReason: reason } });
  if (rx.medicationId) await prisma.medication.updateMany({ where: { id: rx.medicationId, status: "ACTIVE" }, data: { status: "DISCONTINUED", discontinuedAt: new Date() } });
  await logAudit(user.practiceId, user.id, "CANCEL_RX", "Prescription", rx.id, `${rx.drug}: ${reason}`);
  go(back(fd, rx.patientId, "rx"), { ok: "Prescription cancelled." });
}

// ---- Immunizations ----

export async function recordImmunization(patientId: string, fd: FormData) {
  const user = await requireUser(IMMUNIZATION_ROLES);
  await ownPatient(user.practiceId, patientId);
  const to = back(fd, patientId, "imm");
  const cvx = str(fd, "cvx");
  const known = VACCINES.find((v) => v.cvx === cvx);
  const vaccine = known?.name ?? str(fd, "vaccine").slice(0, 120);
  if (!vaccine) go(to, { error: "Choose the vaccine." });
  const date = str(fd, "administeredAt") ? new Date(`${str(fd, "administeredAt")}T12:00:00`) : new Date();
  if (Number.isNaN(date.getTime()) || date.getTime() > Date.now() + 86_400_000) go(to, { error: "Enter a valid date (not in the future)." });
  const source = ["ADMINISTERED", "HISTORICAL", "REFUSED"].includes(str(fd, "source")) ? str(fd, "source") : "ADMINISTERED";
  if (source === "ADMINISTERED" && !str(fd, "lotNumber")) go(to, { error: "Lot number is required for vaccines given here." });
  const dose = Number(str(fd, "doseMl"));
  const exp = str(fd, "expirationDate") ? new Date(`${str(fd, "expirationDate")}T12:00:00`) : null;
  const imm = await prisma.immunization.create({
    data: {
      practiceId: user.practiceId,
      patientId,
      encounterId: str(fd, "encounterId") || null,
      vaccine,
      cvxCode: known?.cvx ?? (cvx || null),
      administeredAt: date,
      source,
      lotNumber: str(fd, "lotNumber").slice(0, 40) || null,
      manufacturer: str(fd, "manufacturer").slice(0, 60) || known?.mfr || null,
      expirationDate: exp && !Number.isNaN(exp.getTime()) ? exp : null,
      site: str(fd, "site") || null,
      route: str(fd, "route") || known?.route || null,
      doseMl: Number.isFinite(dose) && dose > 0 ? dose : (known?.dose ?? null),
      administeredById: source === "ADMINISTERED" ? user.id : null,
      refusalReason: source === "REFUSED" ? str(fd, "refusalReason").slice(0, 200) || "Patient declined" : null,
      visDate: str(fd, "visDate") ? new Date(`${str(fd, "visDate")}T12:00:00`) : null,
      notes: str(fd, "notes").slice(0, 300) || null,
    },
  });
  await logAudit(user.practiceId, user.id, "RECORD_IMMUNIZATION", "Immunization", imm.id, `${vaccine} (${source.toLowerCase()})`);
  go(to, { ok: `${vaccine} recorded.` });
}

export async function deleteImmunization(id: string, fd: FormData) {
  const user = await requireUser(IMMUNIZATION_ROLES);
  const imm = await prisma.immunization.findFirst({ where: { id, practiceId: user.practiceId } });
  if (!imm) throw new Error("Not found");
  await prisma.immunization.delete({ where: { id } });
  await logAudit(user.practiceId, user.id, "DELETE_IMMUNIZATION", "Immunization", id, imm.vaccine);
  go(back(fd, imm.patientId, "imm"), { ok: "Immunization entry removed." });
}
