// Patient Connect: standard patient-facing intake forms, packets and automation rules.
// Forms use the same designer as chart documents (audience PATIENT); practices edit them in Settings.
import { slugId, type FieldDef, type FieldType } from "@/lib/chart-forms";
import type { CatalogTemplate } from "@/lib/document-catalog";
import { DOC_FIELDS, FIELD_GROUPS } from "@/lib/patient-docs";

type Spec = Omit<FieldDef, "id">;
type Opt = Partial<Pick<FieldDef, "required" | "help" | "unit" | "width" | "map">>;

const mk = (type: FieldType) => (label: string, o: Opt = {}): Spec => ({ label, type, ...o });
const t = mk("text");
const ta = mk("textarea");
const d = mk("date");
const yn = mk("yesno");
const h = mk("heading");
const note = mk("note");
const file = mk("file");
const sig = mk("signature");
const sel = (label: string, options: string[], o: Opt = {}): Spec => ({ label, type: "select", options, ...o });
const cbs = (label: string, options: string[], o: Opt = {}): Spec => ({ label, type: "checkboxes", options, ...o });
const consent = (label: string, text: string, map?: string): Spec => ({ label, type: "consent", help: text, required: true, map });
const req = { required: true };
const half = { width: "half" as const };

function withIds(specs: Spec[]): FieldDef[] {
  const taken = new Set<string>();
  return specs.map((s) => ({ ...s, id: slugId(s.label, taken) }));
}

const form = (key: string, name: string, specs: Spec[], description?: string): CatalogTemplate => ({
  key,
  name,
  section: "ADDITIONAL",
  kind: "FORM",
  audience: "PATIENT",
  description,
  fields: withIds(specs),
});

const SIGN = [sig("Signature", req), t("Printed name", { ...req, width: "half" }), t("Relationship to patient (if signing for the patient)", half)];

// Consent wording is a starting point; replace it with your practice's approved text in the form designer.
export const PATIENT_TEMPLATES: CatalogTemplate[] = [
  form(
    "pt_demographics",
    "Patient Information",
    [
      h("About you"),
      t("First name", { ...req, width: "half", map: "patient.firstName" }),
      t("Last name", { ...req, width: "half", map: "patient.lastName" }),
      d("Date of birth", { ...req, width: "half", map: "patient.dob" }),
      sel("Sex", ["Female", "Male"], { ...req, width: "half", map: "patient.sex" }),
      t("Mobile phone", { ...req, width: "half", map: "patient.phone" }),
      t("Email", { width: "half", map: "patient.email" }),
      h("Home address"),
      t("Street address", { ...req, map: "patient.addressLine1" }),
      t("City", { ...req, width: "half", map: "patient.city" }),
      t("State", { ...req, width: "half", map: "patient.state" }),
      t("ZIP code", { ...req, width: "half", map: "patient.zip" }),
      sel("Preferred language", ["English", "Spanish", "Chinese", "Haitian Creole", "Portuguese", "Russian", "Other"], { width: "half", map: "patient.preferredLanguage" }),
      sel("Marital status", ["Single", "Married", "Divorced", "Widowed", "Partner"], { width: "half", map: "patient.maritalStatus" }),
      h("Emergency contact"),
      t("Emergency contact name", { width: "half", map: "patient.emergencyContactName" }),
      t("Emergency contact phone", { width: "half", map: "patient.emergencyContactPhone" }),
      t("Relationship to you", { width: "half", map: "patient.emergencyContactRelationship" }),
    ],
    "Demographics, address and emergency contact"
  ),
  form(
    "pt_insurance",
    "Insurance",
    [
      yn("Do you have health insurance?", req),
      h("Primary insurance"),
      t("Insurance company", { width: "half", map: "insurance.payerName" }),
      t("Member ID", { width: "half", map: "insurance.memberId" }),
      t("Group number", { width: "half", map: "insurance.groupNumber" }),
      t("Plan name", { width: "half", map: "insurance.planName" }),
      t("Policy holder name (if not you)", { width: "half", map: "insurance.subscriberName" }),
      file("Insurance card — front", { help: "Take a clear photo of the front of your card." }),
      file("Insurance card — back"),
      h("Secondary insurance (if any)"),
      t("Secondary insurance company", { width: "half", map: "secondary.payerName" }),
      t("Secondary member ID", { width: "half", map: "secondary.memberId" }),
    ],
    "Insurance details and card photos"
  ),
  form("pt_photo_id", "Photo ID", [note("Please upload a photo of your driver's license or other government photo ID."), file("Photo ID — front", req)], "Driver's license or state ID"),
  form(
    "pt_pcp",
    "Primary Care & Referral",
    [
      t("Primary care doctor", { width: "half", map: "pcp.name" }),
      t("Primary care phone", { width: "half", map: "pcp.phone" }),
      t("Who referred you to us?", { width: "half", map: "referral.physicianName" }),
      t("Referring office / facility", { width: "half", map: "referral.sourceName" }),
      t("Preferred pharmacy (name & location)"),
    ],
    "PCP, referring provider and pharmacy"
  ),
  form(
    "pt_medical_history",
    "Medical History",
    [
      cbs("Do you have any of these conditions?", [
        "Diabetes",
        "High blood pressure",
        "Heart disease",
        "Poor circulation / PAD",
        "Varicose veins / venous disease",
        "Kidney disease",
        "Dialysis",
        "Stroke",
        "COPD / lung disease",
        "Cancer",
        "Paralysis / spinal cord injury",
        "Neuropathy",
        "None of these",
      ]),
      sel("Do you smoke or use tobacco?", ["Never", "Former", "Current"], half),
      t("Past surgeries", half),
      ta("Other medical conditions"),
    ],
    "Conditions, surgeries and tobacco use"
  ),
  form(
    "pt_meds_allergies",
    "Medications & Allergies",
    [
      ta("Current medications (name, dose, how often)", { help: "Include prescriptions, over-the-counter medicines and supplements." }),
      yn("Do you have any allergies?", req),
      ta("Allergies and reactions", { help: "e.g. Penicillin — rash; Latex — hives" }),
    ],
    "Medication list and allergies"
  ),
  form(
    "pt_wound_history",
    "Wound History",
    [
      t("Where is the wound?", req),
      sel("How long have you had it?", ["Less than 2 weeks", "2–4 weeks", "1–3 months", "3–6 months", "More than 6 months"], half),
      sel("What caused it?", ["Pressure / lying or sitting", "Injury / fall", "Surgery", "Diabetes / foot", "Poor circulation", "Swelling / veins", "Burn", "Not sure"], half),
      ta("What treatment have you had so far?"),
      sel("Pain level right now (0–10)", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"], half),
      cbs("Do you have any of these?", ["Fever or chills", "Drainage", "Bad odor", "Redness spreading", "Swelling"]),
      file("Photo of the wound (optional)"),
    ],
    "Wound location, cause, treatment and symptoms"
  ),
  form(
    "pt_hipaa",
    "HIPAA Notice of Privacy Practices",
    [
      consent(
        "Acknowledgement of receipt",
        "I acknowledge that I have been offered a copy of this practice's Notice of Privacy Practices, which describes how my health information may be used and disclosed and how I can get access to it.",
        "consent.hipaa"
      ),
      t("People we may talk to about your care (name & relationship)", { help: "Optional" }),
      ...SIGN,
    ],
    "Privacy notice acknowledgement"
  ),
  form(
    "pt_consent_treatment",
    "Consent to Treatment",
    [
      consent(
        "Consent to evaluation and treatment",
        "I consent to evaluation and treatment by this practice's physicians, nurse practitioners and clinical staff, including wound assessment, cleaning, dressing changes, debridement, photographs of my wounds for my medical record, and other procedures that are explained to me. I understand I may ask questions and may refuse any treatment.",
        "consent.treatment"
      ),
      ...SIGN,
    ],
    "General consent to treatment"
  ),
  form(
    "pt_financial",
    "Financial Policy",
    [
      consent(
        "Financial responsibility",
        "I understand that I am responsible for copays, coinsurance, deductibles and any charges my insurance does not cover. I agree to keep my insurance information up to date and to pay balances according to this practice's financial policy.",
        "consent.financial"
      ),
      ...SIGN,
    ],
    "Patient financial responsibility"
  ),
  form(
    "pt_aob",
    "Assignment of Benefits",
    [
      consent(
        "Assignment of benefits and release of information",
        "I authorize payment of medical benefits directly to this practice for services provided, and I authorize the release of any medical information needed to process my insurance claims.",
        "consent.assignment"
      ),
      ...SIGN,
    ],
    "Assignment of benefits and claims release"
  ),
  form(
    "pt_telehealth_consent",
    "Telehealth Consent",
    [
      consent(
        "Consent to telehealth visits",
        "I consent to receive care by video or phone. I understand the benefits and limits of telehealth, that my information is protected, and that I may request an in-person visit instead.",
        "consent.telehealth"
      ),
      t("State you are located in during visits", half),
      ...SIGN,
    ],
    "Consent for video / phone visits"
  ),
];

// Consent forms that tick the Patient Gateway scheduling consents.
export const CONSENT_FLAGS: Record<string, "consentTreatment" | "consentHipaa" | "consentFinancial" | "consentAssignment"> = {
  "consent.treatment": "consentTreatment",
  "consent.hipaa": "consentHipaa",
  "consent.financial": "consentFinancial",
  "consent.assignment": "consentAssignment",
};

// What a patient-form answer can fill in (Documentation designer -> "Fills patient field").
export const MAP_TARGETS: [string, string][] = [
  ...DOC_FIELDS.map((f): [string, string] => [f.key, `${FIELD_GROUPS[f.group]}: ${f.label}`]),
  ["consent.treatment", "Consent: treatment"],
  ["consent.hipaa", "Consent: HIPAA acknowledgement"],
  ["consent.financial", "Consent: financial policy"],
  ["consent.assignment", "Consent: assignment of benefits"],
];

export const DEFAULT_PACKETS: { name: string; description: string; keys: string[] }[] = [
  {
    name: "New Patient Packet",
    description: "Everything we need before a first visit",
    keys: [
      "pt_demographics",
      "pt_insurance",
      "pt_photo_id",
      "pt_pcp",
      "pt_medical_history",
      "pt_meds_allergies",
      "pt_wound_history",
      "pt_hipaa",
      "pt_consent_treatment",
      "pt_financial",
      "pt_aob",
    ],
  },
  { name: "Returning Patient Update", description: "Confirm details before a follow-up", keys: ["pt_demographics", "pt_insurance", "pt_meds_allergies"] },
  { name: "Telehealth Visit Packet", description: "Consent and updates for a video visit", keys: ["pt_telehealth_consent", "pt_meds_allergies", "pt_wound_history"] },
  { name: "Consents Only", description: "The four signed consents", keys: ["pt_hipaa", "pt_consent_treatment", "pt_financial", "pt_aob"] },
];

export const DEFAULT_RULES: { name: string; kind: string; offsetHours: number; channel: string; packet?: string; onlyNewPatients?: boolean }[] = [
  { name: "New patient packet — 3 days before first visit", kind: "INTAKE_PACKET", offsetHours: 72, channel: "BOTH", packet: "New Patient Packet", onlyNewPatients: true },
  { name: "Appointment reminder — 1 day before", kind: "REMINDER", offsetHours: 24, channel: "BOTH" },
  { name: "Same-day reminder — 2 hours before", kind: "REMINDER", offsetHours: 2, channel: "SMS" },
  { name: "Visit survey — 2 hours after the visit", kind: "SURVEY", offsetHours: 2, channel: "SMS" },
];
