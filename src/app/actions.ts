"use server";

import { scheduleForEncounter } from "@/lib/charge-schedules";
import { revalidatePath } from "next/cache";
import { getSchedulerSettings } from "@/lib/scheduler-setup";
import { redirect } from "next/navigation";
import { recordFlow } from "@/lib/flow";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { assertChartEditable } from "@/lib/visit-guard";
import { runEligibilityCheck } from "@/lib/clearinghouse/service";
import { placeOfServiceLabel } from "@/lib/superbill";
import { buildOccurrences, findConflicts } from "@/lib/schedule-conflicts";
import { PATIENT_EDIT_ROLES, canWorkTeam } from "@/lib/gateway";
import { fillCaseFromDocuments, openIntakeCase } from "@/lib/intake";
import { RegistrationError, readCustomValues, readPatientForm, readPatientPhoto, saveInsuranceBlocks } from "@/lib/patient-registration";
import { ScanError, fileScan, saveScanFiles, uploadedFiles } from "@/lib/scans";

function required(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function nextMrn() {
  return `CH-${Math.floor(100000 + Math.random() * 899999)}`;
}

// Registration problems come back as a banner on the form instead of an error screen.
function registrationFailed(back: string, err: unknown): never {
  if (!(err instanceof RegistrationError)) throw err;
  redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(err.message.slice(0, 300))}`);
}

export async function createPatient(formData: FormData) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "CLINICIAN", "INTAKE"]);
  const readIds = [...new Set(String(formData.get("docs") ?? "").split(",").filter((id) => /^[a-z0-9]{10,40}$/.test(id)))].slice(0, 40);
  let patientId: string;
  try {
    const data = await readPatientForm(formData, user.practiceId);
    const guarantorPatientId = String(formData.get("guarantorPatientId") ?? "") || null;
    if (guarantorPatientId && !(await prisma.patient.findFirst({ where: { id: guarantorPatientId, practiceId: user.practiceId } }))) {
      throw new RegistrationError("Guarantor account not found.");
    }
    const photoPath = await readPatientPhoto(formData, user.practiceId);
    const customFields = await readCustomValues(formData, user.practiceId);
    const patient = await prisma.patient.create({
      data: { ...data, customFields, practiceId: user.practiceId, mrn: nextMrn(), guarantorPatientId, photoPath: photoPath ?? null },
    });
    patientId = patient.id;
    try {
      await saveInsuranceBlocks(patient.id, user.practiceId, formData);
    } catch (err) {
      // Keep the chart; the coverage can be fixed from the edit screen.
      if (!(err instanceof RegistrationError)) throw err;
      await openIntakeCase(user, patient.id);
      await logAudit(user.practiceId, user.id, "CREATE_PATIENT", "Patient", patient.id, `${data.firstName} ${data.lastName}`);
      redirect(`/patients/${patient.id}/edit?error=${encodeURIComponent(`The patient was saved, but: ${err.message}`.slice(0, 300))}`);
    }
    await logAudit(user.practiceId, user.id, "CREATE_PATIENT", "Patient", patient.id, `${data.firstName} ${data.lastName}`);
  } catch (err) {
    // Keep the documents that were read, so the form comes back filled in.
    registrationFailed(readIds.length ? `/patients/new?docs=${readIds.join(",")}` : "/patients/new", err);
  }

  // Every new registration starts a Patient Gateway case for the data entry team.
  const intake = await openIntakeCase(user, patientId);

  // The documents read to fill the form now belong to the patient: filed under Scans, named after what they are.
  if (readIds.length) {
    const mine = await prisma.patientDocument.findMany({ where: { id: { in: readIds }, practiceId: user.practiceId, patientId: null }, select: { id: true } });
    await prisma.patientDocument.updateMany({ where: { id: { in: mine.map((d) => d.id) } }, data: { patientId, intakeCaseId: intake.id } });
    for (const d of mine) await fileScan(d.id, { rename: true, reviewedById: user.id });
    // What the documents say about the referral source and PCP goes onto the gateway case.
    await fillCaseFromDocuments(intake.id, mine.map((d) => d.id));
    if (mine.length) await logAudit(user.practiceId, user.id, "FILE_REGISTRATION_DOCUMENTS", "Patient", patientId, `${mine.length} document(s) filed under Scans`);
  }
  // Documents chosen but not read first are stored now, then read, classified and named in the background.
  const documents = uploadedFiles(formData, "documents");
  let scanProblem: string | null = null;
  if (documents.length > 0) {
    try {
      await saveScanFiles({ user, patientId, files: documents, group: "OTHER" });
    } catch (err) {
      if (!(err instanceof ScanError)) throw err;
      scanProblem = err.message;
    }
  }
  revalidatePath("/");
  revalidatePath("/patients");
  // The chart is saved either way; a document that couldn't be stored is reported on the Scans page.
  if (scanProblem) redirect(`/patients/${patientId}/scans?error=${encodeURIComponent(`The patient was saved, but a document wasn't: ${scanProblem}`.slice(0, 300))}`);
  if (formData.get("intent") === "schedule") redirect(`/schedule?patientId=${patientId}`);
  redirect(canWorkTeam(user.role, "DATA_ENTRY") ? `/gateway/${intake.id}` : `/patients/${patientId}`);
}

export async function updatePatient(patientId: string, formData: FormData) {
  const user = await requireUser(PATIENT_EDIT_ROLES);
  const patient = await prisma.patient.findFirstOrThrow({ where: { id: patientId, practiceId: user.practiceId } });
  try {
    const data = await readPatientForm(formData, user.practiceId);
    const photoPath = await readPatientPhoto(formData, user.practiceId);
    const customFields = await readCustomValues(formData, user.practiceId, patient.customFields);
    await prisma.patient.update({ where: { id: patient.id }, data: { ...data, customFields, ...(photoPath === undefined ? {} : { photoPath }) } });
    await saveInsuranceBlocks(patient.id, user.practiceId, formData);
    await logAudit(user.practiceId, user.id, "UPDATE_PATIENT", "Patient", patient.id, `${data.firstName} ${data.lastName}`);
  } catch (err) {
    registrationFailed(`/patients/${patient.id}/edit`, err);
  }

  revalidatePath(`/patients/${patient.id}`);
  revalidatePath("/patients");
  if (formData.get("intent") === "schedule") redirect(`/schedule?patientId=${patient.id}`);
  redirect(`/patients/${patient.id}`);
}

export async function setPatientStatus(patientId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "BILLER", "SCHEDULER"]);
  const status = required(formData, "status");
  await prisma.patient.updateMany({
    where: { id: patientId, practiceId: user.practiceId },
    data: { status },
  });

  await logAudit(user.practiceId, user.id, "SET_PATIENT_STATUS", "Patient", patientId, status);
  revalidatePath(`/patients/${patientId}`);
  revalidatePath("/patients");
}

export async function setGuarantorAccount(patientId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "BILLER"]);
  await prisma.patient.findFirstOrThrow({ where: { id: patientId, practiceId: user.practiceId } });

  const guarantorPatientId = String(formData.get("guarantorPatientId") ?? "") || null;
  if (guarantorPatientId === patientId) throw new Error("A patient cannot be their own guarantor account");
  if (guarantorPatientId) {
    await prisma.patient.findFirstOrThrow({ where: { id: guarantorPatientId, practiceId: user.practiceId } });
  }

  await prisma.patient.update({ where: { id: patientId }, data: { guarantorPatientId } });

  await logAudit(user.practiceId, user.id, "SET_GUARANTOR_ACCOUNT", "Patient", patientId, guarantorPatientId ?? "self");
  revalidatePath(`/patients/${patientId}`);
}

export async function addChargeFromTemplate(encounterId: string, templateItemId: string) {
  const user = await requireUser(["ADMIN", "CODER"]);
  await assertChartEditable(encounterId, user, "coding");
  const encounter = await prisma.encounter.findFirstOrThrow({
    where: { id: encounterId, practiceId: user.practiceId },
  });
  const item = await prisma.superbillTemplateItem.findFirstOrThrow({
    where: { id: templateItemId, template: { practiceId: user.practiceId } },
  });
  // The charge schedule covering the visit overrides the template's fee for the codes it prices.
  const scheduled = (await scheduleForEncounter(user.practiceId, encounter.id))?.fees.get(item.cptCode.toUpperCase());

  await prisma.charge.create({
    data: {
      practiceId: user.practiceId,
      encounterId: encounter.id,
      cptCode: item.cptCode,
      description: item.description,
      amountCents: scheduled?.feeCents ?? item.amountCents,
      modifiers: item.modifiers,
    },
  });

  revalidatePath(`/encounters/${encounterId}`, "layout");
  revalidatePath("/billing");
}

export async function createAppointment(formData: FormData) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "CLINICIAN", "SCHEDULER"]);
  const patientId = required(formData, "patientId");
  const providerId = required(formData, "providerId");
  const locationId = required(formData, "locationId");
  const startsAtRaw = required(formData, "startsAt");
  const startsAt = new Date(startsAtRaw);
  const visitType = required(formData, "visitType");
  const [visitTypeRow, schedSettings] = await Promise.all([
    prisma.visitType.findFirst({ where: { practiceId: user.practiceId, code: visitType } }),
    getSchedulerSettings(user.practiceId),
  ]);
  // Blank length: use the visit type's default duration (Scheduler admin -> Visit type & time).
  const minutesRaw = Number(formData.get("durationMinutes") || visitTypeRow?.durationMin || 30);
  const minutes = Math.min(Math.max(minutesRaw || 30, 5), 480);
  const collaboratingProviderId = String(formData.get("collaboratingProviderId") ?? "") || null;
  const accountNumber = String(formData.get("accountNumber") ?? "").trim().slice(0, 40) || null;
  const resourceId = String(formData.get("resourceId") ?? "") || null;
  const clinicalStaffId = String(formData.get("clinicalStaffId") ?? "") || null;
  const supervisingProviderId = String(formData.get("supervisingProviderId") ?? "") || null;
  const intakeCaseId = String(formData.get("intakeCaseId") ?? "") || null;
  const placeOfService = String(formData.get("placeOfService") ?? "") || null;
  const recurrence = ["WEEKLY", "BIWEEKLY"].includes(String(formData.get("recurrence")))
    ? (String(formData.get("recurrence")) as "WEEKLY" | "BIWEEKLY")
    : "NONE";
  const weekdays = formData.getAll("weekdays").map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const endDateRaw = String(formData.get("recurrenceEnd") ?? "");
  const endDate = endDateRaw ? new Date(`${endDateRaw}T23:59:00`) : null;
  const returnTo = String(formData.get("returnTo") ?? "");
  const safeReturn = /^\/gateway\/[A-Za-z0-9_-]+$/.test(returnTo) ? returnTo : null;
  if (Number.isNaN(startsAt.getTime())) throw new Error("Invalid start time");
  if (recurrence !== "NONE" && !endDate) throw new Error("A recurring visit needs an end date");

  const [collaborator, resource] = await Promise.all([
    collaboratingProviderId ? prisma.renderingProvider.findFirst({ where: { id: collaboratingProviderId, practiceId: user.practiceId } }) : true,
    resourceId ? prisma.schedulerResource.findFirst({ where: { id: resourceId, practiceId: user.practiceId, locationId, active: true } }) : true,
  ]);
  if (!collaborator) throw new Error("Collaborating physician not found");
  if (!resource) throw new Error("That resource isn't available at this location");

  const [patient, provider, location, staff, supervisor, intakeCase] = await Promise.all([
    prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId } }),
    prisma.user.findFirst({ where: { id: providerId, practiceId: user.practiceId } }),
    prisma.location.findFirst({ where: { id: locationId, practiceId: user.practiceId } }),
    clinicalStaffId ? prisma.membership.findFirst({ where: { userId: clinicalStaffId, practiceId: user.practiceId } }) : true,
    supervisingProviderId
      ? prisma.renderingProvider.findFirst({ where: { id: supervisingProviderId, practiceId: user.practiceId, isSupervising: true } })
      : true,
    intakeCaseId ? prisma.intakeCase.findFirst({ where: { id: intakeCaseId, practiceId: user.practiceId, patientId } }) : true,
  ]);
  if (!patient || !provider || !location || !staff || !supervisor || !intakeCase) throw new Error("Not found");
  if (placeOfService && !(placeOfService in placeOfServiceLabel)) throw new Error("Invalid site of service");

  const occurrences = buildOccurrences(startsAt, minutes, recurrence, weekdays, endDate);
  const conflicts = await findConflicts({
    practiceId: user.practiceId,
    patientId,
    providerId,
    locationId,
    clinicalStaffId,
    intakeCaseId,
    occurrences,
    resourceId,
    rules: { doubleBooking: schedSettings.showConflicts, crossSite: schedSettings.allowCrossSiteConflicts },
  });
  // Conflicts go back to the scheduler, who can accept them and book anyway.
  if (conflicts.length && formData.get("acceptConflicts") !== "on") {
    const back = new URLSearchParams({
      conflicts: conflicts.slice(0, 12).join("\n"),
      patientId,
      bookWith: providerId,
      bookLocation: locationId,
      bookStart: startsAtRaw,
      bookType: visitType,
      bookLen: String(minutes),
      bookStaff: clinicalStaffId ?? "",
      bookSup: supervisingProviderId ?? "",
      bookAuth: intakeCaseId ?? "",
      bookPos: placeOfService ?? "",
      bookRoom: String(formData.get("room") ?? ""),
      bookNotes: String(formData.get("reason") ?? ""),
      bookRecur: recurrence,
      bookRecurEnd: endDateRaw,
      bookDays: weekdays.join(","),
      bookCollab: collaboratingProviderId ?? "",
      bookAcct: accountNumber ?? "",
      bookRes: resourceId ?? "",
      ...(safeReturn ? { returnTo: safeReturn } : {}),
    });
    redirect(`/schedule?${back.toString()}#book`);
  }

  const seriesId = occurrences.length > 1 ? `series_${Date.now().toString(36)}` : null;
  const common = {
    practiceId: user.practiceId,
    patientId,
    providerId,
    locationId,
    visitType,
    reason: String(formData.get("reason") ?? "") || null,
    room: String(formData.get("room") ?? "").trim() || null,
    status: "SCHEDULED",
    clinicalStaffId,
    supervisingProviderId,
    intakeCaseId,
    placeOfService,
    seriesId,
    collaboratingProviderId,
    accountNumber,
    resourceId,
    createdById: user.id,
    conflictNote: conflicts.length ? `Booked with accepted conflicts: ${conflicts.join("; ")}`.slice(0, 1000) : null,
  };
  const created = [];
  for (const o of occurrences) {
    created.push(await prisma.appointment.create({ data: { ...common, startsAt: o.startsAt, endsAt: o.endsAt } }));
  }
  if (conflicts.length) {
    await logAudit(user.practiceId, user.id, "BOOK_WITH_CONFLICTS", "Appointment", created[0].id, conflicts.join("; "));
  }

  await runEligibilityCheck({
    practiceId: user.practiceId,
    patientId,
    appointmentId: created[0].id,
  });

  revalidatePath("/schedule");
  revalidatePath("/");
  revalidatePath("/encounters");
  // Booking from a Patient Gateway case returns the scheduler to that case (same-site paths only).
  redirect(safeReturn ?? "/schedule");
}

// Cancel with a reason from Scheduler admin -> Cancellation reasons.
export async function cancelAppointment(id: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "CLINICIAN", "SCHEDULER"]);
  const reason = String(formData.get("cancelReason") ?? "").trim();
  const known = await prisma.cancellationReason.findFirst({ where: { practiceId: user.practiceId, name: reason } });
  if (!known) throw new Error("Pick a cancellation reason");
  const note = String(formData.get("cancelNote") ?? "").trim();
  const appt = await prisma.appointment.findFirst({ where: { id, practiceId: user.practiceId }, include: { encounter: true } });
  if (!appt) throw new Error("Appointment not found");
  if (appt.encounter) throw new Error("This visit has been started — it can't be cancelled from the schedule");
  const full = note ? `${reason} — ${note}`.slice(0, 300) : reason;
  const scope = formData.get("series") === "on" && appt.seriesId ? { seriesId: appt.seriesId, startsAt: { gte: appt.startsAt } } : { id: appt.id };
  const targets = await prisma.appointment.findMany({
    where: { practiceId: user.practiceId, ...scope, encounter: null, status: { notIn: ["COMPLETED", "CANCELLED"] } },
    select: { id: true },
  });
  const { count } = await prisma.appointment.updateMany({
    where: { id: { in: targets.map((t) => t.id) } },
    data: { status: "CANCELLED", cancelReason: full, cancelledAt: new Date() },
  });
  await recordFlow(targets.map((t) => t.id), "CANCELLED", user.id);
  await logAudit(user.practiceId, user.id, "CANCEL_APPOINTMENT", "Appointment", appt.id, `${full}${count > 1 ? ` (${count} visits in series)` : ""}`);
  revalidatePath("/schedule");
  revalidatePath("/");
}

export async function updateAppointmentStatus(id: string, status: string) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "CLINICIAN", "SCHEDULER"]);
  const { count } = await prisma.appointment.updateMany({ where: { id, practiceId: user.practiceId }, data: { status } });
  if (count) await recordFlow(id, status, user.id);
  revalidatePath("/schedule");
  revalidatePath("/");
}

export async function startEncounter(appointmentId: string) {
  const user = await requireUser(["ADMIN", "FRONT_DESK", "CLINICIAN"]);
  const appt = await prisma.appointment.findFirstOrThrow({
    where: { id: appointmentId, practiceId: user.practiceId },
    include: { encounter: true, location: { select: { placeOfService: true } } },
  });

  if (appt.encounter) {
    redirect(`/encounters/${appt.encounter.id}`);
  }

  // Care team carries over from the booking; a provider who requires supervision defaults to their supervisor.
  const rendering = await prisma.renderingProvider.findFirst({
    where: { userId: appt.providerId, practiceId: user.practiceId },
    select: { requiresSupervision: true, supervisingProviderId: true },
  });
  const encounter = await prisma.encounter.create({
    data: {
      practiceId: user.practiceId,
      patientId: appt.patientId,
      providerId: appt.providerId,
      appointmentId: appt.id,
      type: appt.visitType === "TELE" ? "TELEHEALTH" : "OFFICE",
      status: "IN_PROGRESS",
      chiefComplaint: appt.reason,
      // From the booking, else the site of service's own code, else office (or telehealth).
      placeOfService: appt.placeOfService ?? appt.location.placeOfService ?? (appt.visitType === "TELE" ? "02" : "11"),
      clinicalStaffId: appt.clinicalStaffId,
      supervisingProviderId:
        appt.supervisingProviderId ?? (rendering?.requiresSupervision ? rendering.supervisingProviderId : null),
      events: { create: { userId: user.id, toStatus: "IN_PROGRESS", note: "Visit started" } },
    },
  });

  await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: "IN_ROOM" },
  });
  if (appt.status !== "IN_ROOM") await recordFlow(appointmentId, "IN_ROOM", user.id, appt.room);

  revalidatePath("/schedule");
  redirect(`/encounters/${encounter.id}`);
}

// Chart steps post only their own fields, so only what's on the form is updated.
const NOTE_FIELDS = ["chiefComplaint", "subjective", "objective", "assessment", "plan"] as const;

function nextStepRedirect(encounterId: string, formData: FormData) {
  // "templateKey" or "templateKey.woundId" (per-wound documents).
  const m = String(formData.get("next") ?? "").match(/^([a-z0-9_]+)(?:\.([a-z0-9]+))?$/);
  if (m) redirect(`/encounters/${encounterId}?step=${m[1]}${m[2] ? `&wound=${m[2]}` : ""}`);
}

export async function saveEncounter(id: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  await assertChartEditable(id, user, "clinical");
  const encounter = await prisma.encounter.findFirstOrThrow({ where: { id, practiceId: user.practiceId } });

  const data: Partial<Record<(typeof NOTE_FIELDS)[number], string | null>> = {};
  for (const f of NOTE_FIELDS) {
    if (formData.has(f)) data[f] = String(formData.get(f) ?? "").trim() || null;
  }
  await prisma.encounter.update({ where: { id: encounter.id }, data });

  revalidatePath(`/encounters/${id}`, "layout");
  revalidatePath("/encounters");
  revalidatePath("/schedule");
  nextStepRedirect(id, formData);
}

export async function addCharge(encounterId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "CODER"]);
  await assertChartEditable(encounterId, user, "coding");
  const encounter = await prisma.encounter.findFirstOrThrow({
    where: { id: encounterId, practiceId: user.practiceId },
  });

  const cptCode = required(formData, "cptCode");
  const description = required(formData, "description");
  const amount = Number(required(formData, "amount"));

  const modifiers = formData
    .getAll("modifiers")
    .map((m) => String(m).trim())
    .filter(Boolean)
    .join(",");

  const diagnosisPointers = formData
    .getAll("diagnosisPointers")
    .map((d) => String(d).trim())
    .filter(Boolean)
    .join(",");

  await prisma.charge.create({
    data: {
      practiceId: user.practiceId,
      encounterId: encounter.id,
      cptCode,
      description,
      units: Number(formData.get("units") ?? 1) || 1,
      amountCents: Math.round(amount * 100),
      modifiers: modifiers || null,
      diagnosisPointers: diagnosisPointers || null,
      placeOfService: String(formData.get("placeOfService") ?? "11") || "11",
    },
  });

  revalidatePath(`/encounters/${encounterId}`, "layout");
  revalidatePath("/billing");
}

// ---- Superbill: bulk selection from the code lists ----

const MAX_VISIT_DX = 12;

export async function addDiagnosesBulk(encounterId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "CODER"]);
  await assertChartEditable(encounterId, user, "coding");
  const encounter = await prisma.encounter.findFirstOrThrow({
    where: { id: encounterId, practiceId: user.practiceId },
    include: { diagnoses: true },
  });
  const existing = new Set(encounter.diagnoses.map((d) => d.icd10));
  let priority = encounter.diagnoses.reduce((m, d) => Math.max(m, d.priority), 0);
  const picked = formData
    .getAll("dx")
    .map((v) => String(v))
    .map((v) => {
      const [code, ...rest] = v.split("|");
      return { code: code.trim().toUpperCase(), description: rest.join("|").trim() };
    })
    .filter((d) => /^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/.test(d.code) && !existing.has(d.code));
  const room = MAX_VISIT_DX - encounter.diagnoses.length;
  for (const d of picked.slice(0, Math.max(room, 0))) {
    priority += 1;
    existing.add(d.code);
    await prisma.encounterDiagnosis.create({
      data: { encounterId, icd10: d.code, description: d.description || d.code, priority },
    });
  }
  revalidatePath(`/encounters/${encounterId}`, "layout");
  redirect(`/encounters/${encounterId}/superbill${picked.length > room ? "?warn=dx12" : ""}#dx`);
}

// Letters (A–L by visit priority) -> the diagnosis ids stored on the charge.
async function pointerIdsFromLetters(encounterId: string, letters: string[]) {
  const dxs = await prisma.encounterDiagnosis.findMany({ where: { encounterId }, orderBy: [{ priority: "asc" }, { id: "asc" }] });
  return letters
    .map((l) => dxs["ABCDEFGHIJKL".indexOf(l.toUpperCase())]?.id)
    .filter((id): id is string => Boolean(id))
    .slice(0, 4)
    .join(",");
}

function lettersFrom(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .toUpperCase()
    .split(/[\s,]+/)
    .flatMap((p) => (/^[A-L]+$/.test(p) ? p.split("") : []));
}

function modifiersFrom(values: FormDataEntryValue[]) {
  return values
    .flatMap((v) => String(v).toUpperCase().split(/[\s,]+/))
    .filter((m) => /^[A-Z0-9]{2}$/.test(m))
    .slice(0, 4)
    .join(",");
}

export async function addChargesBulk(encounterId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "CODER"]);
  await assertChartEditable(encounterId, user, "coding");
  await prisma.encounter.findFirstOrThrow({ where: { id: encounterId, practiceId: user.practiceId } });
  const encounter = await prisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
  for (const raw of new Set(formData.getAll("cpt").map(String))) {
    const code = String(raw).trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) continue;
    const units = Math.max(1, Math.min(99, Math.round(Number(formData.get(`units_${code}`) ?? 1) || 1)));
    const fee = Number(String(formData.get(`fee_${code}`) ?? "0").replace(/[$,\s]/g, "")) || 0;
    await prisma.charge.create({
      data: {
        practiceId: user.practiceId,
        encounterId,
        cptCode: code,
        description: String(formData.get(`desc_${code}`) ?? code).slice(0, 200),
        units,
        amountCents: Math.round(fee * 100) * units,
        modifiers: modifiersFrom(formData.getAll(`mod_${code}`)) || null,
        diagnosisPointers: (await pointerIdsFromLetters(encounterId, lettersFrom(formData.get(`ptr_${code}`) ?? "A"))) || null,
        placeOfService: encounter.placeOfService ?? "11",
      },
    });
  }
  revalidatePath(`/encounters/${encounterId}`, "layout");
  revalidatePath("/billing");
  redirect(`/encounters/${encounterId}/superbill#charges`);
}

export async function updateCharge(chargeId: string, encounterId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "CODER"]);
  await assertChartEditable(encounterId, user, "coding");
  const charge = await prisma.charge.findFirst({
    where: { id: chargeId, encounterId, practiceId: user.practiceId },
    include: { claimLines: { select: { id: true } } },
  });
  if (!charge) throw new Error("Charge not found");
  if (charge.claimLines.length) throw new Error("This charge is already on a claim — correct it on the claim.");
  const units = Math.max(1, Math.min(99, Math.round(Number(formData.get("units") ?? 1) || 1)));
  const fee = Number(String(formData.get("fee") ?? "0").replace(/[$,\s]/g, "")) || 0;
  await prisma.charge.update({
    where: { id: charge.id },
    data: {
      units,
      amountCents: Math.round(fee * 100) * units,
      modifiers: modifiersFrom(formData.getAll("modifiers")) || null,
      diagnosisPointers: (await pointerIdsFromLetters(encounterId, formData.getAll("ptr").map(String))) || null,
      placeOfService: String(formData.get("placeOfService") ?? charge.placeOfService),
    },
  });
  revalidatePath(`/encounters/${encounterId}`, "layout");
  redirect(`/encounters/${encounterId}/superbill#charges`);
}

export async function removeCharge(chargeId: string, encounterId: string) {
  const user = await requireUser(["ADMIN", "CODER"]);
  await assertChartEditable(encounterId, user, "coding");
  // Charges already on a claim stay; correct them on the claim instead.
  await prisma.charge.deleteMany({ where: { id: chargeId, encounterId, practiceId: user.practiceId, claimLines: { none: {} } } });
  revalidatePath(`/encounters/${encounterId}`, "layout");
  revalidatePath("/billing");
}

export async function addDiagnosis(encounterId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "CODER"]);
  await assertChartEditable(encounterId, user, "coding");
  const encounter = await prisma.encounter.findFirstOrThrow({
    where: { id: encounterId, practiceId: user.practiceId },
  });

  const icd10 = required(formData, "icd10");
  const description = required(formData, "description");

  const count = await prisma.encounterDiagnosis.count({ where: { encounterId: encounter.id } });

  await prisma.encounterDiagnosis.create({
    data: { encounterId: encounter.id, icd10, description, priority: count + 1 },
  });

  revalidatePath(`/encounters/${encounterId}`, "layout");
}

// Brings the provider's problem list onto the superbill: active, confirmed problems marked "send to superbill"
// that are not on it yet, in problem-list order after the diagnoses already there.
export async function importProblemDiagnoses(encounterId: string) {
  const user = await requireUser(["ADMIN", "CODER"]);
  await assertChartEditable(encounterId, user, "coding");
  const encounter = await prisma.encounter.findFirstOrThrow({
    where: { id: encounterId, practiceId: user.practiceId },
    include: { diagnoses: true, patient: { select: { problems: { where: { status: "ACTIVE", sendToSuperbill: true, verificationStatus: "CONFIRMED" }, orderBy: { icd10: "asc" } } } } },
  });
  const have = new Set(encounter.diagnoses.map((d) => d.icd10.toUpperCase()));
  const fresh = encounter.patient.problems.filter((p) => !have.has(p.icd10.toUpperCase()));
  let priority = encounter.diagnoses.length;
  for (const p of fresh) {
    await prisma.encounterDiagnosis.create({ data: { encounterId: encounter.id, icd10: p.icd10, description: p.description, priority: ++priority } });
  }
  revalidatePath(`/encounters/${encounterId}`, "layout");
}

export async function removeDiagnosis(diagnosisId: string, encounterId: string) {
  const user = await requireUser(["ADMIN", "CODER"]);
  await assertChartEditable(encounterId, user, "coding");
  await prisma.encounter.findFirstOrThrow({ where: { id: encounterId, practiceId: user.practiceId } });
  await prisma.encounterDiagnosis.deleteMany({ where: { id: diagnosisId, encounterId } });
  revalidatePath(`/encounters/${encounterId}`, "layout");
}

export async function moveDiagnosis(diagnosisId: string, encounterId: string, direction: "up" | "down") {
  const user = await requireUser(["ADMIN", "CODER"]);
  await assertChartEditable(encounterId, user, "coding");
  await prisma.encounter.findFirstOrThrow({ where: { id: encounterId, practiceId: user.practiceId } });

  const diagnoses = await prisma.encounterDiagnosis.findMany({
    where: { encounterId },
    orderBy: { priority: "asc" },
  });
  const index = diagnoses.findIndex((d) => d.id === diagnosisId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapIndex < 0 || swapIndex >= diagnoses.length) return;

  const current = diagnoses[index];
  const swap = diagnoses[swapIndex];

  await prisma.$transaction([
    prisma.encounterDiagnosis.update({ where: { id: current.id }, data: { priority: swap.priority } }),
    prisma.encounterDiagnosis.update({ where: { id: swap.id }, data: { priority: current.priority } }),
  ]);

  revalidatePath(`/encounters/${encounterId}`, "layout");
}

export async function updateEncounterBilling(encounterId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "CODER"]);
  await assertChartEditable(encounterId, user, "coding");
  const encounter = await prisma.encounter.findFirstOrThrow({
    where: { id: encounterId, practiceId: user.practiceId },
  });

  const billingProviderId = String(formData.get("billingProviderId") ?? "") || null;
  if (billingProviderId) {
    await prisma.billingProvider.findFirstOrThrow({
      where: { id: billingProviderId, practiceId: user.practiceId },
    });
  }

  await prisma.encounter.update({
    where: { id: encounter.id },
    data: {
      patientStatus: String(formData.get("patientStatus") ?? "") || null,
      mdmLevel: String(formData.get("mdmLevel") ?? "") || null,
      hospice: formData.get("hospice") === "on",
      billingProviderId,
    },
  });

  revalidatePath(`/encounters/${encounterId}`, "layout");
}

export async function createDeposit(formData: FormData) {
  const user = await requireUser(["ADMIN", "BILLER"]);
  const payerType = String(formData.get("payerType") ?? "INSURANCE") === "PATIENT" ? "PATIENT" : "INSURANCE";
  const payerName = required(formData, "payerName");
  const paymentMethod = required(formData, "paymentMethod");
  const checkNumber = String(formData.get("checkNumber") ?? "").trim() || null;
  const amount = Number(required(formData, "amount"));
  const note = String(formData.get("note") ?? "").trim() || null;
  const totalCents = Math.round(amount * 100);
  // Posted date: today unless the biller backdates it; never into a closed accounting period.
  const postedText = String(formData.get("postedAt") ?? "").trim();
  const postedAt = /^\d{4}-\d{2}-\d{2}$/.test(postedText) ? new Date(`${postedText}T12:00:00`) : new Date();
  if (Number.isNaN(postedAt.getTime()) || postedAt > new Date()) redirect(`/billing?tab=deposits&error=${encodeURIComponent("The posted date must be today or earlier.")}`);
  const settings = await prisma.practiceSettings.findUnique({ where: { practiceId: user.practiceId }, select: { closedThrough: true } });
  if (settings?.closedThrough && postedAt <= settings.closedThrough) {
    redirect(`/billing?tab=deposits&error=${encodeURIComponent(`The accounting period is closed through ${settings.closedThrough.toISOString().slice(0, 10)} — post the deposit with a later date, or reopen the period in Practice setup.`)}`);
  }

  const deposit = await prisma.deposit.create({
    data: {
      practiceId: user.practiceId,
      payerType,
      payerName,
      paymentMethod,
      checkNumber,
      totalCents,
      unappliedCents: totalCents,
      note,
      postedAt,
    },
  });

  await logAudit(user.practiceId, user.id, "CREATE_DEPOSIT", "Deposit", deposit.id, formatMoneyCentsForAudit(totalCents));

  revalidatePath("/billing");
}

function formatMoneyCentsForAudit(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function optionalNumber(formData: FormData, key: string) {
  const raw = formData.get(key);
  if (raw === null || String(raw).trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export async function saveVitals(encounterId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  await assertChartEditable(encounterId, user, "clinical");
  await prisma.encounter.findFirstOrThrow({ where: { id: encounterId, practiceId: user.practiceId } });

  const data = {
    heightCm: optionalNumber(formData, "heightCm"),
    weightKg: optionalNumber(formData, "weightKg"),
    tempC: optionalNumber(formData, "tempC"),
    heartRate: optionalNumber(formData, "heartRate"),
    respRate: optionalNumber(formData, "respRate"),
    bpSystolic: optionalNumber(formData, "bpSystolic"),
    bpDiastolic: optionalNumber(formData, "bpDiastolic"),
    spo2: optionalNumber(formData, "spo2"),
  };

  await prisma.vitals.upsert({
    where: { encounterId },
    create: { encounterId, ...data },
    update: { ...data, recordedAt: new Date() },
  });

  revalidatePath(`/encounters/${encounterId}`, "layout");
  nextStepRedirect(encounterId, formData);
}

export async function prescribeMedication(patientId: string, encounterId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  await assertChartEditable(encounterId, user, "clinical");
  await prisma.encounter.findFirstOrThrow({
    where: { id: encounterId, patientId, practiceId: user.practiceId },
  });

  const name = required(formData, "name");
  const sig = required(formData, "sig");

  const medication = await prisma.medication.create({
    data: {
      patientId,
      encounterId,
      prescriberId: user.id,
      name,
      sig,
      status: "ACTIVE",
    },
  });

  await logAudit(user.practiceId, user.id, "PRESCRIBE", "Medication", medication.id, name);

  revalidatePath(`/encounters/${encounterId}`, "layout");
  revalidatePath(`/patients/${patientId}`);
}

export async function discontinueMedication(medicationId: string, encounterId: string) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  await assertChartEditable(encounterId, user, "clinical");
  const medication = await prisma.medication.findFirstOrThrow({
    where: { id: medicationId, patient: { practiceId: user.practiceId } },
  });

  await prisma.medication.update({
    where: { id: medication.id },
    data: { status: "DISCONTINUED", discontinuedAt: new Date() },
  });

  await logAudit(user.practiceId, user.id, "DISCONTINUE_MEDICATION", "Medication", medication.id, medication.name);

  revalidatePath(`/encounters/${encounterId}`, "layout");
  revalidatePath(`/patients/${medication.patientId}`);
}

export async function orderLab(patientId: string, encounterId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  await assertChartEditable(encounterId, user, "clinical");
  await prisma.encounter.findFirstOrThrow({
    where: { id: encounterId, patientId, practiceId: user.practiceId },
  });

  const testName = required(formData, "testName");

  await prisma.labOrder.create({
    data: {
      patientId,
      encounterId,
      orderedById: user.id,
      testName,
      status: "ORDERED",
    },
  });

  revalidatePath(`/encounters/${encounterId}`, "layout");
}

export async function resultLab(labOrderId: string, encounterId: string, formData: FormData) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  await assertChartEditable(encounterId, user, "clinical");
  const labOrder = await prisma.labOrder.findFirstOrThrow({
    where: { id: labOrderId, patient: { practiceId: user.practiceId } },
  });

  const value = required(formData, "value");
  const unit = String(formData.get("unit") ?? "").trim() || null;
  const referenceRange = String(formData.get("referenceRange") ?? "").trim() || null;
  const flag = String(formData.get("flag") ?? "NORMAL");

  await prisma.labResult.create({
    data: { labOrderId: labOrder.id, value, unit, referenceRange, flag },
  });

  await prisma.labOrder.update({
    where: { id: labOrder.id },
    data: { status: "RESULTED" },
  });

  revalidatePath(`/encounters/${encounterId}`, "layout");
}

export async function cancelLabOrder(labOrderId: string, encounterId: string) {
  const user = await requireUser(["ADMIN", "CLINICIAN"]);
  await assertChartEditable(encounterId, user, "clinical");
  const labOrder = await prisma.labOrder.findFirstOrThrow({
    where: { id: labOrderId, patient: { practiceId: user.practiceId } },
  });

  await prisma.labOrder.update({
    where: { id: labOrder.id },
    data: { status: "CANCELLED" },
  });
  revalidatePath(`/encounters/${encounterId}`, "layout");
}

export async function generateStatements(formData: FormData) {
  const user = await requireUser(["ADMIN", "BILLER"]);
  const minBalanceCents = Math.round(Number(formData.get("minBalance") ?? 0) * 100) || 0;

  const claims = await prisma.claim.findMany({
    where: { balanceResponsibility: "PATIENT", practiceId: user.practiceId, status: { not: "VOID" } },
    include: { patient: true },
  });

  const eligible = claims.filter((c) => c.billedCents - c.paidCents - c.adjustedCents > 0);
  const byPatient = new Map<string, typeof eligible>();
  for (const claim of eligible) {
    // Combine dependents onto their guarantor's account, so a family gets one statement.
    const billingAccountId = claim.patient.guarantorPatientId ?? claim.patientId;
    const list = byPatient.get(billingAccountId) ?? [];
    list.push(claim);
    byPatient.set(billingAccountId, list);
  }

  let created = 0;
  for (const [patientId, patientClaims] of byPatient) {
    const totalCents = patientClaims.reduce(
      (sum, c) => sum + (c.billedCents - c.paidCents - c.adjustedCents),
      0
    );
    if (totalCents < minBalanceCents) continue;

    await prisma.statement.create({
      data: {
        practiceId: user.practiceId,
        patientId,
        totalCents,
        lines: {
          create: patientClaims.map((c) => ({
            claimId: c.id,
            balanceCents: c.billedCents - c.paidCents - c.adjustedCents,
          })),
        },
      },
    });
    created += 1;
  }

  await logAudit(user.practiceId, user.id, "GENERATE_STATEMENTS", "Statement", undefined, `${created} statement(s)`);
  revalidatePath("/statements");
}
