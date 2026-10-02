import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

// Privacy and compliance: accounting of disclosures, amendment requests, restricted charts ("break the glass")
// and consent to automated texts and calls.

export const disclosurePurposeLabel: Record<string, string> = {
  PATIENT_REQUEST: "Patient's request (to a third party)",
  AUTHORIZATION: "Signed authorization",
  LEGAL: "Court order / subpoena",
  PUBLIC_HEALTH: "Public health reporting",
  OVERSIGHT: "Health oversight / audit",
  LAW_ENFORCEMENT: "Law enforcement",
  WORKERS_COMP: "Workers' compensation",
  RESEARCH: "Research",
  OTHER: "Other",
};

export const disclosureMethodLabel: Record<string, string> = {
  FAX: "Fax",
  MAIL: "Mail",
  ELECTRONIC: "Secure electronic",
  IN_PERSON: "In person",
  VERBAL: "Verbal",
};

export const amendmentStatusLabel: Record<string, string> = { PENDING: "Pending", ACCEPTED: "Accepted", DENIED: "Denied" };

// The reasons HIPAA allows for denying an amendment.
export const amendmentDenialLabel: Record<string, string> = {
  ACCURATE_AND_COMPLETE: "The record is accurate and complete",
  NOT_CREATED_HERE: "The record was not created by this practice",
  NOT_PART_OF_RECORD: "Not part of the designated record set",
  NOT_AVAILABLE_FOR_INSPECTION: "Not available for the patient to inspect",
};

export const emergencyReasonLabel: Record<string, string> = {
  EMERGENCY: "Emergency treatment",
  COVERING: "Covering for the patient's provider",
  BILLING: "Billing or payment question",
  PATIENT_REQUEST: "The patient asked me to",
  OTHER: "Other (explain)",
};

export const consentLabel: Record<string, string> = { YES: "Consented", NO: "Declined" };
export const consentMethodLabel: Record<string, string> = { VERBAL: "Verbal", WRITTEN: "Written / signed", FORM: "Intake form", PORTAL: "Patient portal" };

// Days a practice has to answer an amendment request, and how long emergency access lasts.
export const AMENDMENT_DAYS = 60;
export const EMERGENCY_ACCESS_HOURS = 4;

type Actor = { id: string; practiceId: string; role: string };

// Whether this user may open the chart. An unrestricted chart is open to everyone whose role lets them in; a
// restricted one only to administrators, the patient's own providers and care team, and anyone with a current
// emergency access.
export async function chartAccess(user: Actor, patientId: string): Promise<"OPEN" | "CARE_TEAM" | "EMERGENCY" | "BLOCKED"> {
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, practiceId: user.practiceId },
    select: { restricted: true, woundCarePhysicianId: true, primaryCarePhysicianId: true, supervisingPhysicianId: true, referringPhysicianId: true },
  });
  if (!patient || !patient.restricted) return "OPEN";
  if (user.role === "ADMIN") return "CARE_TEAM";

  const physicians = [patient.woundCarePhysicianId, patient.primaryCarePhysicianId, patient.supervisingPhysicianId, patient.referringPhysicianId].filter((v): v is string => Boolean(v));
  const [team, physician, visit, appointment, emergency] = await Promise.all([
    prisma.careTeamMember.findFirst({ where: { patientId, userId: user.id, active: true }, select: { id: true } }),
    physicians.length ? prisma.renderingProvider.findFirst({ where: { id: { in: physicians }, userId: user.id }, select: { id: true } }) : null,
    prisma.encounter.findFirst({ where: { patientId, OR: [{ providerId: user.id }, { clinicalStaffId: user.id }] }, select: { id: true } }),
    prisma.appointment.findFirst({ where: { patientId, providerId: user.id }, select: { id: true } }),
    prisma.emergencyAccess.findFirst({ where: { patientId, userId: user.id, expiresAt: { gt: new Date() } }, select: { id: true } }),
  ]);
  if (team || physician || visit || appointment) return "CARE_TEAM";
  return emergency ? "EMERGENCY" : "BLOCKED";
}

// Call at the top of any page that shows a patient's chart. Sends a blocked user to the break-the-glass screen.
export async function requireChartAccess(user: Actor, patientId: string, returnTo?: string) {
  const access = await chartAccess(user, patientId);
  if (access === "BLOCKED") {
    const next = returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? `?next=${encodeURIComponent(returnTo)}` : "";
    redirect(`/patients/${patientId}/break-glass${next}`);
  }
  return access;
}

export async function requireEncounterAccess(user: Actor, encounterId: string) {
  const encounter = await prisma.encounter.findFirst({ where: { id: encounterId, practiceId: user.practiceId }, select: { patientId: true } });
  if (encounter) await requireChartAccess(user, encounter.patientId, `/encounters/${encounterId}`);
}

// Reminder, recall and survey texts need the patient's consent on file. Returns the reason a text can't go, or null.
export async function textBlockedReason(practiceId: string, patientId: string | null | undefined, kind: string): Promise<string | null> {
  if (!patientId || !["REMINDER", "RECALL", "SURVEY"].includes(kind)) return null;
  const [patient, settings] = await Promise.all([
    prisma.patient.findFirst({ where: { id: patientId, practiceId }, select: { textConsent: true } }),
    prisma.connectSettings.findUnique({ where: { practiceId }, select: { requireTextConsent: true } }),
  ]);
  if (patient?.textConsent === "NO") return "The patient declined text messages";
  if ((settings?.requireTextConsent ?? true) && patient?.textConsent !== "YES") return "No consent to text on file — record it on the patient's Privacy page";
  return null;
}
