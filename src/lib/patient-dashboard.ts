// Patient dashboard widgets: what exists, how wide each one is (the dashboard is three columns), and the default layout.

export type WidgetKey = keyof typeof WIDGETS;

export const WIDGETS = {
  insurance: { title: "Insurance", span: 2, about: "Active coverages with eligibility check" },
  scans: { title: "Scans", span: 1, about: "Latest scanned documents by group" },
  admissions: { title: "Admissions", span: 1, about: "Admission date, site of service and status" },
  communications: { title: "Communication log", span: 2, about: "Calls, texts, emails and intake notes" },
  diagnosis: { title: "Diagnosis list", span: 2, about: "Active problems with codes" },
  orders: { title: "Physician orders", span: 1, about: "Lab and imaging orders" },
  medications: { title: "Medications", span: 2, about: "Medication list and allergies" },
  tasks: { title: "Tasks", span: 2, about: "Open tasks and messages about this patient" },
  results: { title: "Test results", span: 2, about: "Lab results and vitals trend" },
  encounters: { title: "Encounters and interactions", span: 2, about: "Appointments and visits" },
  wounds: { title: "Wound healing graph", span: 3, about: "Wound area over time for each active wound" },
  authorizations: { title: "Authorizations", span: 1, about: "Visit and procedure authorizations on file" },
  caregaps: { title: "Care gaps", span: 1, about: "Preventive care and reminders due" },
  gateway: { title: "Patient Gateway", span: 1, about: "Intake stage, eligibility and prior auth" },
  forms: { title: "Patient forms", span: 1, about: "Intake forms sent and completed" },
  prescriptions: { title: "Prescriptions", span: 2, about: "Write, print and fax prescriptions" },
  immunizations: { title: "Immunizations", span: 1, about: "Vaccines given, and the forecast of what is due" },
  growth: { title: "Growth chart", span: 1, about: "Weight, height, head circumference and BMI percentiles (under 20)" },
  referrals: { title: "Referrals", span: 1, about: "Outgoing referrals and consult notes" },
  recalls: { title: "Recalls", span: 1, about: "Follow-up visits due" },
  balance: { title: "Balance", span: 1, about: "What the patient owes, payments and receipts" },
  records: { title: "Records exchange", span: 1, about: "Care summaries received and sent" },
  account: { title: "Family / guarantor account", span: 1, about: "Who the account is billed under" },
} as const satisfies Record<string, { title: string; span: 1 | 2 | 3; about: string }>;

// What a user sees before they customize: coverage and scans first, then the clinical and front-desk panels.
export const DEFAULT_WIDGETS: WidgetKey[] = ["insurance", "scans", "admissions", "communications", "diagnosis", "orders", "medications", "encounters", "tasks", "gateway", "balance"];

const isKey = (k: unknown): k is WidgetKey => typeof k === "string" && k in WIDGETS;

export function parseWidgets(json: string | null | undefined): WidgetKey[] {
  if (!json) return DEFAULT_WIDGETS;
  try {
    const v: unknown = JSON.parse(json);
    if (!Array.isArray(v)) return DEFAULT_WIDGETS;
    return [...new Set(v.filter(isKey))];
  } catch {
    return DEFAULT_WIDGETS;
  }
}

export function cleanWidgets(input: unknown): WidgetKey[] {
  return Array.isArray(input) ? [...new Set(input.filter(isKey))] : [];
}
