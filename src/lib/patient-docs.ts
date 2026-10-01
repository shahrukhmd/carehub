// Patient document intake: document types, the fields a document can fill, and naming.
// Shared by the reader (server), the review screen and the apply actions.

export const DOC_TYPES: Record<string, string> = {
  REFERRAL: "Referral",
  FACE_SHEET: "Face sheet / demographics",
  INSURANCE_CARD: "Insurance card",
  PHOTO_ID: "Photo ID",
  H_AND_P: "History & physical",
  ORDERS: "Physician orders",
  MEDICATION_LIST: "Medication list",
  LAB_RESULTS: "Lab / test results",
  CONSENT: "Consent form",
  INTAKE_PACKET: "Patient intake packet",
  LETTER: "Letter",
  PRESCRIPTION: "Prescription",
  CCDA: "Care summary (C-CDA)",
  PROGRESS_NOTES: "Progress notes",
  OTHER: "Other",
};

// Groups on the patient's Scans page: the document types, with anything unclassified shown as "Unsorted".
export const SCAN_GROUPS: Record<string, string> = {
  CONSENT: "Consents",
  PROGRESS_NOTES: "Progress notes",
  REFERRAL: "Referrals",
  INSURANCE_CARD: "Insurance cards",
  PHOTO_ID: "Photo ID",
  FACE_SHEET: "Face sheets / demographics",
  H_AND_P: "History & physical",
  ORDERS: "Physician orders",
  MEDICATION_LIST: "Medication lists",
  LAB_RESULTS: "Lab / test results",
  INTAKE_PACKET: "Patient intake packets",
  LETTER: "Letters",
  PRESCRIPTION: "Prescriptions",
  CCDA: "Care summaries (C-CDA)",
  OTHER: "Unsorted",
};

export const DOC_STATUS: Record<string, string> = {
  PROCESSING: "Reading…",
  READ: "Ready to review",
  FAILED: "Couldn't read",
  APPLIED: "Applied",
};

export const READ_METHODS: Record<string, string> = {
  TEXT: "PDF text",
  OCR: "OCR (scanned)",
  CLAUDE: "Claude AI",
  OPENAI: "OpenAI",
  PATIENT: "Entered by the patient",
};

export type FieldGroup = "patient" | "insurance" | "secondary" | "referral" | "pcp" | "pharmacy" | "homeHealth";

export const FIELD_GROUPS: Record<FieldGroup, string> = {
  patient: "Patient demographics",
  insurance: "Primary insurance",
  secondary: "Secondary insurance",
  referral: "Referral",
  pcp: "Primary care physician",
  pharmacy: "Pharmacy",
  homeHealth: "Home health",
};

export type FieldDef = { key: string; group: FieldGroup; label: string; kind?: "date" | "sex" | "state" | "phone" | "zip" | "long" };

// Keys are "<group>.<field>" and map 1:1 onto patient / insurance / intake case columns in the apply action.
export const DOC_FIELDS: FieldDef[] = [
  { key: "patient.firstName", group: "patient", label: "First name" },
  { key: "patient.lastName", group: "patient", label: "Last name" },
  { key: "patient.middleName", group: "patient", label: "Middle name" },
  { key: "patient.dob", group: "patient", label: "Date of birth", kind: "date" },
  { key: "patient.sex", group: "patient", label: "Sex", kind: "sex" },
  { key: "patient.ssnLast4", group: "patient", label: "SSN (last 4 digits)" },
  { key: "patient.phone", group: "patient", label: "Phone", kind: "phone" },
  { key: "patient.phone2", group: "patient", label: "Second phone", kind: "phone" },
  { key: "patient.email", group: "patient", label: "Email" },
  { key: "patient.addressLine1", group: "patient", label: "Street address" },
  { key: "patient.addressLine2", group: "patient", label: "Apartment / unit" },
  { key: "patient.city", group: "patient", label: "City" },
  { key: "patient.state", group: "patient", label: "State", kind: "state" },
  { key: "patient.zip", group: "patient", label: "ZIP", kind: "zip" },
  { key: "patient.county", group: "patient", label: "County" },
  { key: "patient.preferredLanguage", group: "patient", label: "Preferred language" },
  { key: "patient.maritalStatus", group: "patient", label: "Marital status" },
  { key: "patient.race", group: "patient", label: "Race" },
  { key: "patient.ethnicity", group: "patient", label: "Ethnicity" },
  { key: "patient.occupation", group: "patient", label: "Occupation" },
  { key: "patient.emergencyContactName", group: "patient", label: "Emergency contact" },
  { key: "patient.emergencyContactPhone", group: "patient", label: "Emergency contact phone", kind: "phone" },
  { key: "patient.emergencyContactRelationship", group: "patient", label: "Emergency contact relationship" },
  { key: "insurance.payerName", group: "insurance", label: "Payer" },
  { key: "insurance.memberId", group: "insurance", label: "Member ID" },
  { key: "insurance.groupNumber", group: "insurance", label: "Group number" },
  { key: "insurance.planName", group: "insurance", label: "Plan name" },
  { key: "insurance.groupName", group: "insurance", label: "Group name" },
  { key: "insurance.copay", group: "insurance", label: "Copay" },
  { key: "insurance.effectiveDate", group: "insurance", label: "Effective date", kind: "date" },
  { key: "insurance.subscriberName", group: "insurance", label: "Subscriber (if not the patient)" },
  { key: "insurance.subscriberDob", group: "insurance", label: "Subscriber date of birth", kind: "date" },
  { key: "insurance.subscriberRelationship", group: "insurance", label: "Patient relationship to subscriber" },
  { key: "secondary.payerName", group: "secondary", label: "Payer" },
  { key: "secondary.memberId", group: "secondary", label: "Member ID" },
  { key: "secondary.groupNumber", group: "secondary", label: "Group number" },
  { key: "referral.referralDate", group: "referral", label: "Referral date", kind: "date" },
  { key: "referral.sourceName", group: "referral", label: "Referring facility / practice" },
  { key: "referral.physicianName", group: "referral", label: "Referring physician" },
  { key: "referral.physicianNpi", group: "referral", label: "Referring physician NPI" },
  { key: "referral.contactName", group: "referral", label: "Referral contact" },
  { key: "referral.contactPhone", group: "referral", label: "Referral phone", kind: "phone" },
  { key: "referral.contactFax", group: "referral", label: "Referral fax", kind: "phone" },
  { key: "referral.servicesRequested", group: "referral", label: "Services requested", kind: "long" },
  { key: "referral.diagnoses", group: "referral", label: "Diagnoses (ICD-10)", kind: "long" },
  { key: "referral.onsetDate", group: "referral", label: "Onset of symptoms", kind: "date" },
  { key: "pcp.name", group: "pcp", label: "PCP name" },
  { key: "pcp.phone", group: "pcp", label: "PCP phone", kind: "phone" },
  { key: "pcp.fax", group: "pcp", label: "PCP fax", kind: "phone" },
  { key: "pharmacy.name", group: "pharmacy", label: "Pharmacy" },
  { key: "pharmacy.phone", group: "pharmacy", label: "Pharmacy phone", kind: "phone" },
  { key: "pharmacy.fax", group: "pharmacy", label: "Pharmacy fax", kind: "phone" },
  { key: "pharmacy.address", group: "pharmacy", label: "Pharmacy address" },
  { key: "homeHealth.company", group: "homeHealth", label: "Home health company" },
  { key: "homeHealth.nurse", group: "homeHealth", label: "Home health nurse" },
];

export const DOC_FIELD_KEYS = DOC_FIELDS.map((f) => f.key);

export type Confidence = "high" | "medium" | "low";
export type ExtractedField = { value: string; confidence: Confidence; source?: string };
export type Extraction = {
  docType: string;
  fields: Record<string, ExtractedField>;
  notes?: string;
};

export function parseExtraction(json: string | null | undefined): Extraction | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    if (!v || typeof v !== "object" || typeof v.fields !== "object") return null;
    return v as Extraction;
  } catch {
    return null;
  }
}

// Normalised forms used both by the readers and when the reviewer edits a value.
export function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    let y = +m[3];
    if (m[3].length === 2) y += y > (new Date().getFullYear() % 100) + 1 ? 1900 : 2000;
    return valid(y, +m[1], +m[2]);
  }
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && months.includes(m[1].toLowerCase())) return valid(+m[3], months.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  return null;
}

function valid(y: number, mo: number, d: number) {
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (digits.length !== 10) return null;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function normalizeSex(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (["m", "male", "man"].includes(s)) return "M";
  if (["f", "female", "woman"].includes(s)) return "F";
  return null;
}

// "2026-09-25 Referral - Doe, Jane.pdf"
export function suggestedDocumentName(opts: { docType: string; lastName?: string; firstName?: string; date?: string | null; ext: string }) {
  const who = [opts.lastName, opts.firstName].filter(Boolean).join(", ");
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const type = (DOC_TYPES[opts.docType] ?? "Document").replace(/\s*\/.*$/, "");
  return `${date} ${type}${who ? ` - ${titleCase(who)}` : ""}${opts.ext}`.slice(0, 180);
}

export function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|[\s,'-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

export function extensionOf(name: string, mime: string) {
  const m = name.match(/\.[A-Za-z0-9]{2,5}$/);
  if (m) return m[0].toLowerCase();
  return mime === "application/pdf" ? ".pdf" : mime === "image/png" ? ".png" : mime.startsWith("image/") ? ".jpg" : "";
}
