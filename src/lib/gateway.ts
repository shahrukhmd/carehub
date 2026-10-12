// Patient Gateway: the pre-scheduling console shared by the data entry (DSS), VOB (verification of benefits) and
// PCC (patient care) teams.
import type { IntakeCase } from "@prisma/client";
import { rolesFor } from "@/lib/permissions";

export const intakeStageLabel: Record<string, string> = {
  DATA_ENTRY: "Data entry",
  VERIFICATION: "VOB review",
  AUTH_PENDING: "Auth pending",
  PCC_REFERRAL: "Referral with PCC",
  SCHEDULING: "Ready to schedule",
  SCHEDULED: "Scheduled / in care",
  // Shared by the VOB and PCC boards: the patient can't be taken (VOB denied) or couldn't be seen.
  UNABLE_TO_SEE: "Unable to see",
  CLOSED: "Closed",
};

export const INTAKE_STAGES = Object.keys(intakeStageLabel);
export const OPEN_INTAKE_STAGES = ["DATA_ENTRY", "VERIFICATION", "AUTH_PENDING", "PCC_REFERRAL", "SCHEDULING"];

export type GatewayTeam = "DATA_ENTRY" | "VERIFICATION" | "SCHEDULING";

export const teamLabel: Record<GatewayTeam, string> = {
  DATA_ENTRY: "Data entry",
  VERIFICATION: "VOB",
  SCHEDULING: "Patient care",
};

// The stages each team works (and is answerable for). "Unable to see" belongs to both VOB and PCC.
export const teamStages: Record<GatewayTeam, string[]> = {
  DATA_ENTRY: ["DATA_ENTRY"],
  VERIFICATION: ["VERIFICATION", "AUTH_PENDING", "PCC_REFERRAL"],
  SCHEDULING: ["SCHEDULING", "SCHEDULED"],
};

// The stages each team's view shows: its own, plus the shared hand-off columns (VOB sees Ready to schedule, where
// its cases go next; both VOB and PCC see Unable to see).
export const teamVisibleStages: Record<GatewayTeam, string[]> = {
  DATA_ENTRY: ["DATA_ENTRY"],
  VERIFICATION: ["VERIFICATION", "AUTH_PENDING", "PCC_REFERRAL", "SCHEDULING", "UNABLE_TO_SEE"],
  SCHEDULING: ["SCHEDULING", "SCHEDULED", "UNABLE_TO_SEE"],
};

export function teamForStage(stage: string): GatewayTeam | null {
  for (const [team, stages] of Object.entries(teamStages)) {
    if (stages.includes(stage)) return team as GatewayTeam;
  }
  return null;
}

// The teams that may act on a case at this stage: its owning team, or VOB and PCC both for "Unable to see".
export function teamsForStage(stage: string): GatewayTeam[] {
  if (stage === "UNABLE_TO_SEE") return ["VERIFICATION", "SCHEDULING"];
  const team = teamForStage(stage);
  return team ? [team] : [];
}

// The columns of the VOB and Patient care boards. A column is a stage, or (for scheduled patients) a stage and a
// patient care status. "Ready to schedule" and "Unable to see" appear on both.
export type BoardColumn = { key: string; label: string; stage: string; careStatus?: string; tone: string };

export const VOB_BOARD: BoardColumn[] = [
  { key: "vob-review", label: "VOB review", stage: "VERIFICATION", tone: "#2b8fd6" },
  { key: "auth-pending", label: "Auth pending", stage: "AUTH_PENDING", tone: "#d99a1e" },
  { key: "referral-pcc", label: "Referral with PCC", stage: "PCC_REFERRAL", tone: "#e07b2c" },
  { key: "ready", label: "Ready to schedule", stage: "SCHEDULING", tone: "#2bb7b3" },
  { key: "unable", label: "Unable to see", stage: "UNABLE_TO_SEE", tone: "#38bdf8" },
];

export const CARE_BOARD: BoardColumn[] = [
  { key: "ready", label: "Ready to schedule", stage: "SCHEDULING", tone: "#2bb7b3" },
  { key: "confirmed", label: "Confirmed", stage: "SCHEDULED", careStatus: "CONFIRMED", tone: "#8b5cf6" },
  { key: "rescheduled", label: "Rescheduled", stage: "SCHEDULED", careStatus: "RESCHEDULED", tone: "#84cc16" },
  { key: "active", label: "Active", stage: "SCHEDULED", careStatus: "ACTIVE", tone: "#10b981" },
  { key: "active-hosp", label: "Active Pt Hospitalized", stage: "SCHEDULED", careStatus: "ACTIVE_HOSPITALIZED", tone: "#6b7280" },
  { key: "pending-discharge", label: "Pending Discharge & Clinical Review", stage: "SCHEDULED", careStatus: "PENDING_DISCHARGE", tone: "#f97316" },
  { key: "discharged", label: "Discharged", stage: "SCHEDULED", careStatus: "DISCHARGED", tone: "#e11d48" },
  { key: "unable", label: "Unable to see", stage: "UNABLE_TO_SEE", tone: "#38bdf8" },
  { key: "unseen-hosp", label: "Unseen Pt Hospitalized", stage: "SCHEDULED", careStatus: "UNSEEN_HOSPITALIZED", tone: "#fb923c" },
];

// Who can see the gateway, and who can work each team's section.
export const GATEWAY_ROLES = rolesFor("gateway.work");
// Every team that works a patient can open the chart and search; the gateway itself stays with the front teams.
export const PATIENT_VIEW_ROLES = rolesFor("patients.view");
export const PATIENT_EDIT_ROLES = rolesFor("patients.edit");

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

// Strict team scope: a gateway team role (data entry / DSS, VOB, PCC) sees only its own team — its view, its
// stages and the cases currently in them. Admins, front desk and clinicians work across teams and see everything.
// The screens, the case page and every case action check this.
export function gatewayTeamScope(role: string): GatewayTeam | null {
  return defaultTeamForRole(role);
}

// The case stages this role may see; null means every stage.
export function visibleGatewayStages(role: string): string[] | null {
  const team = gatewayTeamScope(role);
  return team ? teamVisibleStages[team] : null;
}

// May this role act on a case at this stage (owning team, or VOB / PCC for "Unable to see")?
export function canActOnStage(role: string, stage: string) {
  return teamsForStage(stage).some((team) => canWorkTeam(role, team));
}

export function canSeeGatewayCase(role: string, stage: string) {
  const stages = visibleGatewayStages(role);
  return !stages || stages.includes(stage);
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

// Patient care status: where a scheduled patient is with the PCC (patient care) team. A case marked scheduled
// starts at Confirmed. Discharged makes the patient inactive; every other status keeps them active.
export const careStatusLabel: Record<string, string> = {
  CONFIRMED: "Confirmed",
  RESCHEDULED: "Rescheduled",
  ACTIVE: "Active",
  ACTIVE_HOSPITALIZED: "Active Pt Hospitalized",
  PENDING_DISCHARGE: "Pending Discharge & Clinical Review",
  DISCHARGED: "Discharged",
  UNSEEN_HOSPITALIZED: "Unseen Pt Hospitalized",
};

export const DEFAULT_CARE_STATUS = "CONFIRMED";

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
