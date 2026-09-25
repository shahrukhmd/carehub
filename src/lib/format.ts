export function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
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
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age -= 1;
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
};

export const appointmentStatusLabel: Record<string, string> = {
  SCHEDULED: "Scheduled",
  CONFIRMED: "Confirmed",
  CHECKED_IN: "Checked in",
  IN_ROOM: "In room",
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
};
