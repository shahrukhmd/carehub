// Scheduler admin: defaults and labels shared by the schedule, booking and Settings -> Scheduling.

export type VisitTypeSeed = { code: string; name: string; durationMin: number | null; billable?: boolean };

// Wound-care encounter types (as configured in WoundExpert) plus CareHub's general types.
export const DEFAULT_VISIT_TYPES: VisitTypeSeed[] = [
  { code: "INIT_WOUND", name: "Initial Wound Care", durationMin: 60 },
  { code: "EST_WOUND", name: "Established Wound Care", durationMin: 30 },
  { code: "WOUND_CARE", name: "Wound care visit", durationMin: 30 },
  { code: "ACTIGRAFT", name: "Actigraft Application", durationMin: 45 },
  { code: "ABI", name: "Ankle Brachial Index Assessment", durationMin: 30 },
  { code: "PROV_MIST", name: "Provider Ultrasound Mist Therapy", durationMin: 30 },
  { code: "NPWCN_MIST", name: "NP/WCN Ultrasound Mist Therapy", durationMin: 30 },
  { code: "NON_PROVIDER", name: "Non-Provider Ultrasound Mist Therapy", durationMin: 30 },
  { code: "SNF_EST", name: "SNF Established Visit", durationMin: 30 },
  { code: "SURVEILLANCE", name: "Surveillance Visit", durationMin: 20 },
  { code: "PCM", name: "Principal Care Management", durationMin: 30 },
  { code: "TELE_INIT", name: "Telehealth Initial Wound Care", durationMin: 40 },
  { code: "TELE_EST", name: "Telehealth Established Wound Care", durationMin: 20 },
  { code: "TELE", name: "Telehealth", durationMin: 20 },
  { code: "NEW", name: "New patient", durationMin: 45 },
  { code: "FOLLOW_UP", name: "Follow-up", durationMin: 30 },
  { code: "SICK", name: "Sick visit", durationMin: 30 },
  { code: "WELL", name: "Wellness", durationMin: 30 },
  { code: "RECORDS", name: "Medical Records Entry", durationMin: 15 },
  // Non-billable interactions
  { code: "COMM_LOG", name: "Communication Log", durationMin: 15, billable: false },
  { code: "DATA_ENTRY", name: "Data Entry", durationMin: 15, billable: false },
  { code: "PROVIDER_ORDERS", name: "Provider Orders", durationMin: 15, billable: false },
];

export const DEFAULT_CANCELLATION_REASONS = [
  "Admitted",
  "Dr. out",
  "Equipment Failure",
  "Hospital",
  "Left Without Being Seen",
  "No show/No call",
  "Orders Changed",
  "Other",
  "Patient Request",
  "Provider unavailable",
  "Refusal",
  "Sick",
  "Transportation",
  "Unable to Confirm",
  "Weather",
];

export type ColorPair = { text: string; bg: string };

// The status a visit shows on the calendar: the chart's workflow status once started, else the appointment's.
export const CALENDAR_STATUSES: [string, string, ColorPair][] = [
  ["REQUESTED", "Requested online (needs approval)", { text: "#000000", bg: "#fde68a" }],
  ["SCHEDULED", "Scheduled", { text: "#000000", bg: "#3cc39a" }],
  ["CONFIRMED", "Confirmed", { text: "#000000", bg: "#d77ba5" }],
  ["CHECKED_IN", "Check-In", { text: "#000000", bg: "#fcd8ae" }],
  ["IN_ROOM", "In room", { text: "#000000", bg: "#f6e38c" }],
  ["IN_PROGRESS", "Documentation in progress", { text: "#000000", bg: "#9fd8f5" }],
  ["READY_FOR_CDS", "Ready for CDS", { text: "#000000", bg: "#18954a" }],
  ["CDS_QUERY", "Incomplete Documentation HOLD (CDS)", { text: "#ffffff", bg: "#0b5cb8" }],
  ["READY_FOR_SIGNATURE", "Ready for Signature", { text: "#000000", bg: "#f7931e" }],
  ["READY_FOR_BILLING", "Ready for Billing", { text: "#000000", bg: "#c56fd1" }],
  ["BILLED", "Billing Completed", { text: "#000000", bg: "#ee8b8f" }],
  ["COMPLETED", "Completed", { text: "#000000", bg: "#b9e3b0" }],
  ["NO_SHOW", "No Show", { text: "#000000", bg: "#c9ccc9" }],
  ["CANCELLED", "Cancelled Visit", { text: "#000000", bg: "#c1c238" }],
  ["IN_HOSPITAL", "In Hospital", { text: "#000000", bg: "#a4e3a4" }],
  ["HOLD_FOR_AUDIT", "Hold for Audit", { text: "#ffffff", bg: "#0b5cb8" }],
  ["DO_NOT_BILL", "Do Not Bill", { text: "#000000", bg: "#e8323c" }],
  ["BILLING_HOLD", "Billing-HOLD", { text: "#ffffff", bg: "#0b5cb8" }],
];

export const COLOR_MODES: Record<string, string> = {
  NONE: "None",
  TYPE: "Encounter type",
  STATUS: "Encounter status",
  PHYSICIAN: "Physician",
};

// Optional details shown when a visit on the schedule is expanded (Visit info admin).
export const PREVIEW_FIELDS: Record<string, string> = {
  createdBy: "Visit created by",
  dob: "Patient DOB",
  phone: "Patient phone",
  accountNumber: "Account number",
  mrn: "MRN",
  emergencyName: "Emerg. contact name",
  emergencyPhone: "Emerg. contact phone",
  primaryInsurance: "Primary insurance name",
  policyNumber: "Policy number",
  authCount: "Number of authorizations (visits approved)",
  authRemaining: "Remaining authorizations",
  authStart: "Auth start date",
  authEnd: "Auth end date",
  copay: "Copay amount",
  visitStatus: "Visit status",
  preferredLanguage: "Preferred language",
  clinician: "Clinician",
  supervisor: "Supervising / collaborating physician",
  room: "Room",
  resource: "Resource",
};

export type DayHours = { day: number; closed: boolean; start: string; end: string };

export const DEFAULT_OFFICE_HOURS: DayHours[] = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
  day,
  closed: day === 0 || day === 6,
  start: "08:00",
  end: "19:00",
}));

export function parseOfficeHours(json: string | null | undefined): DayHours[] {
  try {
    const v = JSON.parse(json || "null");
    if (Array.isArray(v) && v.length === 7) return v as DayHours[];
  } catch {
    // fall through to defaults
  }
  return DEFAULT_OFFICE_HOURS;
}

export function parseJson<T>(json: string | null | undefined, fallback: T): T {
  try {
    const v = JSON.parse(json || "");
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

// Half-hour options for office-hours pickers.
export const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 ? "30" : "00";
  const label = `${((h + 11) % 12) + 1}:${m} ${h < 12 ? "AM" : "PM"}`;
  return [`${String(h).padStart(2, "0")}:${m}`, label] as const;
});

export function timeLabel(hhmm: string) {
  return TIME_OPTIONS.find(([v]) => v === hhmm)?.[1] ?? hhmm;
}
