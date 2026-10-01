// Patient Gateway: the pre-scheduling console shared by the data entry, VOB (verification of benefits) and scheduling teams.
import type { IntakeCase } from "@prisma/client";

export const intakeStageLabel: Record<string, string> = {
  DATA_ENTRY: "Data entry",
  VERIFICATION: "VOB review",
  AUTH_PENDING: "Auth pending",
  PCC_REFERRAL: "Referral with PCC",
  SCHEDULING: "Ready to schedule",
  SCHEDULED: "Scheduled / in care",
  CLOSED: "Closed",
};

export const INTAKE_STAGES = Object.keys(intakeStageLabel);
export const OPEN_INTAKE_STAGES = ["DATA_ENTRY", "VERIFICATION", "AUTH_PENDING", "PCC_REFERRAL", "SCHEDULING"];

export type GatewayTeam = "DATA_ENTRY" | "VERIFICATION" | "SCHEDULING";

export const teamLabel: Record<GatewayTeam, string> = {
  DATA_ENTRY: "Team 1 · Data entry",
  VERIFICATION: "Team 2 · VOB",
  SCHEDULING: "Team 3 · Scheduling",
};

export const teamStages: Record<GatewayTeam, string[]> = {
  DATA_ENTRY: ["DATA_ENTRY"],
  VERIFICATION: ["VERIFICATION", "AUTH_PENDING", "PCC_REFERRAL"],
  SCHEDULING: ["SCHEDULING", "SCHEDULED"],
};

export function teamForStage(stage: string): GatewayTeam | null {
  for (const [team, stages] of Object.entries(teamStages)) {
    if (stages.includes(stage)) return team as GatewayTeam;
  }
  return null;
}

// Who can see the gateway, and who can work each team's section.
export const GATEWAY_ROLES = ["ADMIN", "FRONT_DESK", "CLINICIAN", "INTAKE", "VERIFICATION", "SCHEDULER"];
export const PATIENT_VIEW_ROLES = GATEWAY_ROLES;
export const PATIENT_EDIT_ROLES = ["ADMIN", "FRONT_DESK", "INTAKE", "VERIFICATION"];

const TEAM_ROLES: Record<GatewayTeam, string[]> = {
  DATA_ENTRY: ["ADMIN", "FRONT_DESK", "INTAKE"],
  VERIFICATION: ["ADMIN", "FRONT_DESK", "VERIFICATION"],
  SCHEDULING: ["ADMIN", "FRONT_DESK", "SCHEDULER"],
};

export function canWorkTeam(role: string, team: GatewayTeam) {
  return TEAM_ROLES[team].includes(role);
}

export function defaultTeamForRole(role: string): GatewayTeam | null {
  if (role === "INTAKE") return "DATA_ENTRY";
  if (role === "VERIFICATION") return "VERIFICATION";
  if (role === "SCHEDULER") return "SCHEDULING";
  return null;
}

export const referralSourceTypeLabel: Record<string, string> = {
  PHYSICIAN: "Physician office",
  HOSPITAL: "Hospital / discharge",
  SNF: "Skilled nursing / ALF",
  HOME_HEALTH: "Home health agency",
  PAYER: "Health plan / case manager",
  SELF: "Self / family",
  OTHER: "Other",
};

export const eligibilityStatusLabel: Record<string, string> = {
  PENDING: "Not verified",
  ACTIVE: "Active coverage",
  INACTIVE: "Inactive / termed",
  NOT_FOUND: "Member not found",
  SELF_PAY: "Self-pay",
};

export const yesNoUnknownLabel: Record<string, string> = {
  UNKNOWN: "Not determined",
  YES: "Yes",
  NO: "No",
};

export const authStatusLabel: Record<string, string> = {
  NOT_REQUIRED: "Not required",
  TO_SUBMIT: "To submit",
  SUBMITTED: "Submitted",
  PENDED: "Pended / info requested",
  APPROVED: "Auth approved",
  DENIED: "Denied",
};

export const referralStatusLabel: Record<string, string> = {
  NOT_REQUIRED: "Not required",
  TO_SEND: "To send to PCC",
  SENT_TO_PCC: "With PCC team",
  RECEIVED: "Referral received",
};

export const referralAppStatusLabel: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress with PCP",
  COMPLETE: "Complete",
  NOT_NEEDED: "Not needed",
};

export const careStatusLabel: Record<string, string> = {
  FOLLOW_UP: "Follow-up scheduling",
  ACTIVE: "Active patient",
  INACTIVE: "Inactive patient",
  LIMITED: "Limited services only",
};

export const CONSENTS = [
  { key: "consentTreatment", label: "Consent to treat" },
  { key: "consentHipaa", label: "HIPAA / privacy acknowledgment" },
  { key: "consentFinancial", label: "Financial responsibility" },
  { key: "consentAssignment", label: "Assignment of benefits" },
] as const;

export function consentsSigned(c: Pick<IntakeCase, (typeof CONSENTS)[number]["key"]>) {
  return CONSENTS.filter((x) => c[x.key]).length;
}

// What still stands between a case and the next team, shown on the worklist and enforced on hand-off.
export function dataEntryGaps(
  patient: { phone: string | null; addressLine1: string | null; city: string | null; zip: string | null },
  c: Pick<IntakeCase, "referralSourceName" | "referralSourceType" | "payerId" | "eligibilityStatus" | "eligibilityCheckedAt">
) {
  const gaps: string[] = [];
  if (!patient.phone) gaps.push("phone");
  if (!patient.addressLine1 || !patient.city || !patient.zip) gaps.push("address");
  if (!c.referralSourceType || !c.referralSourceName) gaps.push("referral source");
  if (!c.payerId && c.eligibilityStatus !== "SELF_PAY") gaps.push("insurance");
  else if (c.payerId && c.eligibilityStatus === "PENDING" && !c.eligibilityCheckedAt) gaps.push("eligibility check");
  return gaps;
}

export function verificationGaps(
  c: Pick<
    IntakeCase,
    "eligibilityStatus" | "authRequired" | "authStatus" | "referralRequired" | "referralStatus" | "assignedProviderId"
  >
) {
  const gaps: string[] = [];
  if (!["ACTIVE", "SELF_PAY"].includes(c.eligibilityStatus)) gaps.push("eligibility not active");
  if (c.authRequired === "UNKNOWN") gaps.push("auth requirement not determined");
  if (c.authRequired === "YES" && c.authStatus !== "APPROVED") gaps.push("auth not approved");
  if (c.referralRequired === "UNKNOWN") gaps.push("referral requirement not determined");
  if (c.referralRequired === "YES" && c.referralStatus !== "RECEIVED") gaps.push("referral not received");
  if (!c.assignedProviderId) gaps.push("no rendering provider");
  return gaps;
}

export function schedulingGaps(c: Pick<IntakeCase, (typeof CONSENTS)[number]["key"] | "referralAppStatus">) {
  const gaps: string[] = [];
  const signed = consentsSigned(c);
  if (signed < CONSENTS.length) gaps.push(`${CONSENTS.length - signed} consent(s) unsigned`);
  if (!["COMPLETE", "NOT_NEEDED"].includes(c.referralAppStatus)) gaps.push("referral application open");
  return gaps;
}

// ---- VOB decision ----

export const vobDecisionLabel: Record<string, string> = {
  APPROVED_ALL: "Approved for all services",
  APPROVED_LIMITED: "Approved for E&M and debridements only",
  DENIED: "Denied — do not take the patient",
  HOLD: "On hold — authorization / referral needed",
};

export const vobDecisionShort: Record<string, string> = {
  APPROVED_ALL: "All services",
  APPROVED_LIMITED: "E&M + debridement only",
  DENIED: "Denied",
  HOLD: "On hold",
};

export const vobDenyReasonLabel: Record<string, string> = {
  OUT_OF_NETWORK: "Out of network / not credentialed",
  INACTIVE: "Coverage inactive or termed",
  NOT_COVERED: "Wound care not a covered benefit",
  AUTH_DENIED: "Authorization denied",
  REFERRAL_DENIED: "Referral not obtained",
  OTHER: "Other",
};

export function vobDecisionTone(decision: string | null) {
  return decision === "APPROVED_ALL" ? "ok" : decision === "APPROVED_LIMITED" ? "info" : decision === "DENIED" ? "bad" : decision === "HOLD" ? "warn" : "muted";
}

// Where a case sits while the VOB team works it: waiting on the payer's auth, waiting on the PCC referral, or with VOB.
// A case put on hold waits from the moment the requirement is recorded; otherwise only once the request is out.
export function verificationStage(
  c: Pick<IntakeCase, "authRequired" | "authStatus" | "referralRequired" | "referralStatus" | "vobDecision">
): "AUTH_PENDING" | "PCC_REFERRAL" | "VERIFICATION" {
  const hold = c.vobDecision === "HOLD";
  const authWait = c.authRequired === "YES" && (["SUBMITTED", "PENDED"].includes(c.authStatus) || (hold && c.authStatus === "TO_SUBMIT"));
  const referralWait = c.referralRequired === "YES" && (c.referralStatus === "SENT_TO_PCC" || (hold && c.referralStatus === "TO_SEND"));
  return authWait ? "AUTH_PENDING" : referralWait ? "PCC_REFERRAL" : "VERIFICATION";
}

export const patientSearchByLabel: Record<string, string> = {
  lastName: "Last name",
  firstName: "First name",
  mrn: "MRN",
  dob: "Date of birth",
  phone: "Phone",
  memberId: "Member / policy ID",
};
