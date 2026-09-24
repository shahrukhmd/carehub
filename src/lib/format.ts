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
