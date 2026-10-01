// Date-only values (dates of birth, "YYYY-MM-DD" inputs) are stored as UTC midnight; show them as that
// calendar date rather than shifting to the previous day in US time zones.
function isDateOnly(d: Date) {
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
}

export function formatDate(value: Date | string) {
  const d = new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(isDateOnly(d) ? { timeZone: "UTC" } : {}),
  }).format(d);
}

export function formatTime(value: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function ageFromDob(dob: Date | string) {
  const d = new Date(dob);
  const utc = isDateOnly(d);
  const [by, bm, bd] = utc ? [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()] : [d.getFullYear(), d.getMonth(), d.getDate()];
  const today = new Date();
  let age = today.getFullYear() - by;
  const m = today.getMonth() - bm;
  if (m < 0 || (m === 0 && today.getDate() < bd)) age -= 1;
  return age;
}

export function patientName(patient: { firstName: string; lastName: string }) {
  return `${patient.lastName}, ${patient.firstName}`;
}

export const visitTypeLabel: Record<string, string> = {
  NEW: "New patient",
  FOLLOW_UP: "Follow-up",
  SICK: "Sick visit",
  WELL: "Wellness",
  TELE: "Telehealth",
  WOUND_CARE: "Wound care visit",
  NON_PROVIDER: "Non-Provider Ultrasound Mist Therapy",
  INIT_WOUND: "Initial Wound Care",
  EST_WOUND: "Established Wound Care",
  ACTIGRAFT: "Actigraft Application",
  ABI: "Ankle Brachial Index Assessment",
  PROV_MIST: "Provider Ultrasound Mist Therapy",
  NPWCN_MIST: "NP/WCN Ultrasound Mist Therapy",
  SNF_EST: "SNF Established Visit",
  SURVEILLANCE: "Surveillance Visit",
  PCM: "Principal Care Management",
  TELE_INIT: "Telehealth Initial Wound Care",
  TELE_EST: "Telehealth Established Wound Care",
  RECORDS: "Medical Records Entry",
  COMM_LOG: "Communication Log",
  DATA_ENTRY: "Data Entry",
  PROVIDER_ORDERS: "Provider Orders",
};

export const appointmentStatusLabel: Record<string, string> = {
  REQUESTED: "Requested online",
  SCHEDULED: "Scheduled",
  CONFIRMED: "Confirmed",
  CHECKED_IN: "Checked in",
  IN_ROOM: "In room",
  IN_HOSPITAL: "In hospital",
  COMPLETED: "Completed",
  NO_SHOW: "No-show",
  CANCELLED: "Cancelled",
};

export const claimStatusLabel: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  ACCEPTED: "Accepted",
  DENIED: "Denied",
  PARTIAL: "Partially paid",
  PAID: "Paid",
  EDI_REJECTED: "EDI rejected",
  DELINQUENT: "Delinquent",
  IN_COLLECTION: "In collection",
  APPEAL: "Under appeal",
};

export const balanceResponsibilityLabel: Record<string, string> = {
  INSURANCE: "Insurance",
  PATIENT: "Patient",
};

export const depositPayerTypeLabel: Record<string, string> = {
  INSURANCE: "Insurance",
  PATIENT: "Patient",
};

export const raceLabel: Record<string, string> = {
  AMERICAN_INDIAN: "American Indian / Alaska Native",
  ASIAN: "Asian",
  BLACK: "Black / African American",
  PACIFIC_ISLANDER: "Native Hawaiian / Pacific Islander",
  WHITE: "White",
  OTHER: "Other",
  DECLINED: "Declined to disclose",
};

export const ethnicityLabel: Record<string, string> = {
  HISPANIC: "Hispanic or Latino",
  NOT_HISPANIC: "Not Hispanic or Latino",
  DECLINED: "Declined to disclose",
};

export const smokingStatusLabel: Record<string, string> = {
  CURRENT_EVERY_DAY: "Current every-day smoker",
  CURRENT_SOME_DAY: "Current some-day smoker",
  FORMER: "Former smoker",
  NEVER: "Never smoked",
  UNKNOWN: "Unknown",
};

export const maritalStatusLabel: Record<string, string> = {
  SINGLE: "Single",
  MARRIED: "Married",
  DIVORCED: "Divorced",
  WIDOWED: "Widowed",
  SEPARATED: "Separated",
  DOMESTIC_PARTNER: "Domestic partner",
  UNKNOWN: "Unknown",
};

export const employmentStatusLabel: Record<string, string> = {
  FULL_TIME: "Full time employed",
  PART_TIME: "Part time employed",
  SELF_EMPLOYED: "Self-employed",
  UNEMPLOYED: "Unemployed",
  RETIRED: "Retired",
  STUDENT: "Student",
  UNKNOWN: "Unknown",
};

export const patientAccountStatusLabel: Record<string, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  NOT_STARTED: "Not started",
  PAYMENT_ARRANGEMENT: "Payment arrangement",
  IN_COLLECTION: "In collection",
  BAD_DEBT: "Bad debt",
  DECEASED: "Deceased",
};

export const eligibilityStatusLabel: Record<string, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  UNKNOWN: "Unknown",
  ERROR: "Check failed",
};

export function agingBucket(days: number) {
  if (days <= 30) return "0-30 days";
  if (days <= 60) return "31-60 days";
  if (days <= 90) return "61-90 days";
  return "90+ days";
}

export function calcBmi(heightCm: number | null, weightKg: number | null) {
  if (!heightCm || !weightKg) return null;
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}

export const labFlagLabel: Record<string, string> = {
  NORMAL: "Normal",
  ABNORMAL: "Abnormal",
  CRITICAL: "Critical",
};

export const labStatusLabel: Record<string, string> = {
  ORDERED: "Ordered",
  RESULTED: "Resulted",
  CANCELLED: "Cancelled",
};

export const roleLabel: Record<string, string> = {
  ADMIN: "Administrator",
  FRONT_DESK: "Front desk",
  CLINICIAN: "Clinician",
  BILLER: "Billing",
  CREDENTIALING: "Credentialing",
  INTAKE: "Gateway · Data entry",
  VERIFICATION: "Gateway · Verification",
  SCHEDULER: "Gateway · Scheduling",
  CDS: "CDS / Coding",
};

export const credentialingStatusLabel: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROCESS: "In process",
  APPROVED: "Approved",
  PANEL_CLOSED: "Panel closed",
  FOLLOWS_MEDICARE: "Follows Medicare",
  REMARKS: "Remarks",
  DENIED: "Denied",
};

export const connectionStatusLabel: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROCESS: "In process",
  APPROVED: "Approved",
  NOT_ALLOWED: "Not allowed",
};

// Provider-level enrollment lifecycle (workboard columns follow this order).
export const enrollmentStatusLabel: Record<string, string> = {
  NOT_STARTED: "Not started",
  DOCUMENTS_PENDING: "Documents pending",
  SUBMITTED: "Submitted / in process",
  PAYER_FOLLOW_UP: "Payer follow-up",
  BLOCKED: "Blocked",
  APPROVED: "Approved",
  FOLLOWS_PARENT: "Follows parent payer",
  REVALIDATION_DUE: "Revalidation / recred due",
  PANEL_CLOSED: "Panel closed / not offered",
  DENIED: "Denied",
  TERMED: "Termed",
  NOT_APPLICABLE: "Not applicable",
};

// Plan segments (lines of business) as used in the credentialing master sheet.
export const planSegmentLabel: Record<string, string> = {
  MEDICARE: "Medicare",
  MEDICARE_ADVANTAGE: "Medicare Advantage",
  MEDICARE_SUPPLEMENTAL: "Medicare Supplemental",
  MEDICAID: "Medicaid",
  MEDICAID_MCO: "Medicaid MCO",
  COMMERCIAL: "Commercial",
  FEDERAL: "Federal Program",
};

// Broad families for the grid's segment filter.
export const planSegmentFamily: Record<string, "MEDICARE" | "MEDICAID" | "COMMERCIAL"> = {
  MEDICARE: "MEDICARE",
  MEDICARE_ADVANTAGE: "MEDICARE",
  MEDICARE_SUPPLEMENTAL: "MEDICARE",
  MEDICAID: "MEDICAID",
  MEDICAID_MCO: "MEDICAID",
  COMMERCIAL: "COMMERCIAL",
  FEDERAL: "COMMERCIAL",
};

// Compact codes for the dense status grid.
export const statusShortCode: Record<string, string> = {
  NOT_STARTED: "NS",
  DOCUMENTS_PENDING: "DOC",
  SUBMITTED: "SUB",
  IN_PROCESS: "IP",
  PAYER_FOLLOW_UP: "F/U",
  BLOCKED: "BLK",
  APPROVED: "APR",
  FOLLOWS_PARENT: "FOL",
  FOLLOWS_MEDICARE: "FM",
  REVALIDATION_DUE: "REV",
  PANEL_CLOSED: "PC",
  DENIED: "DEN",
  TERMED: "TRM",
  NOT_APPLICABLE: "N/A",
  REMARKS: "RMK",
  NOT_ALLOWED: "NA",
};

export const OPEN_ENROLLMENT_STATUSES = [
  "NOT_STARTED",
  "DOCUMENTS_PENDING",
  "SUBMITTED",
  "PAYER_FOLLOW_UP",
  "BLOCKED",
  "REVALIDATION_DUE",
];

export const ACTIVE_ENROLLMENT_STATUSES = ["APPROVED", "FOLLOWS_PARENT", "REVALIDATION_DUE"];

export const providerCredentialLabel: Record<string, string> = {
  MD: "MD",
  DO: "DO",
  DPM: "DPM",
  NP: "NP",
  FNP: "FNP",
  APRN: "APRN",
  PA: "PA",
  CRNA: "CRNA",
  RN: "RN",
};

export const providerRoleLabel = {
  isReferring: "Referring",
  isClinician: "Clinician",
  isRendering: "Rendering",
  isSupervising: "Supervising",
} as const;

export const providerTitleLabel: Record<string, string> = {
  DR: "Dr.",
  MR: "Mr.",
  MS: "Ms.",
  MRS: "Mrs.",
  MX: "Mx.",
};

// CMS-1500 box 1 insurance types.
export const insuranceTypeLabel: Record<string, string> = {
  MEDICARE: "Medicare",
  MEDICAID: "Medicaid",
  TRICARE: "TRICARE / CHAMPUS",
  CHAMPVA: "CHAMPVA",
  GROUP_HEALTH: "Group health plan (commercial)",
  FECA: "FECA / Black Lung",
  WORKERS_COMP: "Workers' compensation",
  AUTO: "Auto / liability",
  OTHER: "Other",
};

export const timelyFilingUnitLabel: Record<string, string> = {
  DAYS: "Days",
  MONTHS: "Months",
  YEARS: "Years",
};

export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
  "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC",
  "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

export const providerDocumentTypeLabel: Record<string, string> = {
  STATE_LICENSE: "State license",
  DEA: "DEA certificate",
  BOARD_CERT: "Board certification",
  MALPRACTICE_COI: "Malpractice / COI",
  W9: "W-9",
  CAQH_ATTESTATION: "CAQH attestation",
  SUPERVISION_AGREEMENT: "Supervising / collaborating agreement",
  SSN_CARD: "SSN card",
  CV: "CV / work history",
  OTHER: "Other",
};

export const activityChannelLabel: Record<string, string> = {
  PORTAL: "Payer portal",
  PHONE: "Phone call",
  CHAT: "Chat",
  EMAIL: "Email",
  FAX: "Fax",
  MAIL: "Mail",
  INTERNAL: "Internal note",
};

export const verificationSourceLabel: Record<string, string> = {
  NPPES: "NPPES NPI Registry",
  OIG_LEIE: "OIG exclusion list (LEIE)",
  SAM: "SAM.gov exclusions",
  STATE_MEDICAID: "State Medicaid exclusion list",
  STATE_LICENSE: "State licensing board",
  DEA: "DEA registration",
  BOARD: "Specialty board",
  CAQH: "CAQH ProView",
};

// Sources NCQA expects re-screened at least every 30 days.
export const MONTHLY_SCREENING_SOURCES = ["OIG_LEIE", "SAM"];

export const verificationResultLabel: Record<string, string> = {
  CLEAR: "Clear / verified",
  MISMATCH: "Mismatch",
  FLAGGED: "Flagged",
};

export const credentialingPriorityLabel: Record<string, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};
