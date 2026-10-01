// Patient Connect: standard patient-facing intake forms, packets and automation rules.
// Forms use the same designer as chart documents (audience PATIENT); practices edit them in Settings.
import { slugId, type FieldDef, type FieldType } from "@/lib/chart-forms";
import type { CatalogTemplate } from "@/lib/document-catalog";
import { DOC_FIELDS, FIELD_GROUPS } from "@/lib/patient-docs";
import { CONSENT_TEXT as T } from "@/lib/connect/consent-library";

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

// The patient signs by agreeing and typing their full legal name; no separate printed-name line is needed.
const SIGNED = [sig("Signature of patient or representative", req), t("Relationship to patient (if signing for the patient)", half)];
const SIGNED_ES = [sig("Firma del paciente o su representante", req), t("Relación con el paciente (si firma un representante)", half)];

const ROI_INTRO =
  "The form authorizes release of information in accordance with the Health Insurance Portability and Accountability Act, 45 CFR Parts 160 and 164. Only information specified herein may be released as part of this authorization. Your request to disclose and release this information is voluntary. I authorize the organization below to disclose my healthcare treatment information as specified for Personic Advanced Wound Care.";

const PATIENT_RIGHTS =
  "I hereby acknowledge that I have received a copy of Whiterock Medical Center's Notice of Privacy Practices. I understand that I may address any questions or concerns I may have about the Notice to Whiterock Medical Center's Privacy Officer.\n\nFailure to sign this form will not result in a denial of services.";

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
  // ---- The practice's own consent forms and notices (wording in consent-library.ts) ----
  form(
    "pc_hipaa",
    "HIPAA Notice of Privacy Practices",
    [consent("Notice of Privacy Practices and HIPAA authorization — acknowledgment of receipt", T.hipaa, "consent.hipaa"), ...SIGNED],
    "Notice of Privacy Practices, patient authorization and acknowledgment of receipt"
  ),
  form(
    "pc_debridement",
    "Debridement Consent",
    [consent("Wound debridement — informed consent", T.debridement, "consent.treatment"), ...SIGNED],
    "Informed consent for wound debridement"
  ),
  form(
    "pc_financial",
    "Financial Policy and Consent",
    [consent("Financial agreement / guarantee of payment", `Clinic: {clinic}\n\n${T.financial}`, "consent.financial+assignment"), ...SIGNED],
    "Financial agreement, assignment of benefits and electronic invoices"
  ),
  form(
    "pc_arbitration",
    "Arbitration Agreement",
    [consent("Arbitration agreement for claims arising out of or related to medical care and treatment", `${T.arbitration}\n\nClinic: {clinic}`), ...SIGNED],
    "Binding arbitration agreement"
  ),
  form(
    "pc_telehealth",
    "Telehealth Consent",
    [
      consent("Telehealth / telemedicine consent", `${T.telehealth}\n\nClinic: {clinic}`, "consent.telehealth"),
      ...SIGNED,
      t("Interpreter name (if an interpreter was used)", { help: "The interpreter certifies they are fluent in the signer's language and interpreted this form accurately and completely." }),
    ],
    "Consent for video / phone visits"
  ),
  form(
    "pc_skin_substitute",
    "Skin Substitute Consent",
    [consent("Bioengineered skin substitute (amniotic membrane graft) — informed consent", T.skin_substitute), ...SIGNED],
    "Informed consent for skin substitute application"
  ),
  form(
    "pc_actigraft",
    "ActiGraft Informed Consent",
    [
      consent("ActiGraft wound treatment — sections 1 to 13", T.actigraft_1),
      t("Patient initials", { ...req, width: "half", help: "Your initials confirm you have read sections 1 to 13." }),
      consent("Use of health information, acknowledgment and release, and consent", T.actigraft_2),
      sel("I received the above information, and it has been explained to", ["Me, the patient", "The patient's designated decision maker"], req),
      consent("Acknowledgment of receipt of Notice of Privacy Practices & HIPAA agreement", T.actigraft_npp),
      ...SIGNED,
    ],
    "Informed consent for ActiGraft wound treatment"
  ),
  form("pc_abi", "ABI Consent", [consent("Lower extremity ankle brachial index evaluation — informed consent", T.abi), ...SIGNED], "Informed consent for the ankle brachial index (ABI) test"),
  form(
    "pc_roi",
    "Release of Information (Medical Record Request)",
    [
      note(ROI_INTRO),
      h("Organization that holds the records"),
      t("Organization name", req),
      t("Contact name", half),
      t("Phone", half),
      t("Address"),
      t("City", half),
      t("State", half),
      t("Zip code", half),
      h("Information to be released"),
      cbs(
        "I authorize the release of the following information",
        ["Medical Reports", "Medications", "Psychological Reports", "Treatment Goals/Progress", "Drug or Alcohol Use", "Court Proceedings", "Diagnostic Test Results", "Assessments", "Diagnoses", "Other"],
        req
      ),
      t("Other — specify"),
      { label: "Emailing my medical records (optional) — tick only if you want your records sent by email", type: "consent", help: T.roi_email },
      consent("Authorization", `${ROI_INTRO}\n\n${T.roi_auth}`),
      ...SIGNED,
    ],
    "Authorization for another organization to release records to us"
  ),
  form(
    "pc_white_rock",
    "White Rock Consent Form",
    [
      consent("White Rock Medical Center — consent for treatment and conditions of admission", T.white_rock),
      cbs("The following facility-specific addendums have been offered to me (item 11)", [
        "Patient Rights and Responsibilities",
        "Important Message from Medicare",
        "Information regarding Advance Directives",
        "Patient has not executed Advance Directives",
        "Important Message from Champus",
        "Notice of Privacy Practices",
      ]),
      t("Other specific items"),
      yn("Have you executed Advance Directives?"),
      yn("Would you like your name to be part of the Patient Directory?", req),
      consent("Acknowledgement of receipt of White Rock Medical Center Notice of Health Information Practices", T.white_rock_ack),
      ...SIGNED,
      t("Translator name (if a translator was used)"),
    ],
    "White Rock Medical Center general consent and privacy acknowledgment"
  ),
  form(
    "pc_patient_rights",
    "Patient Rights and Privacy Notice",
    [consent("Acknowledgment of receipt of Notice of Privacy Practices", PATIENT_RIGHTS), ...SIGNED],
    "Whiterock Medical Center privacy notice acknowledgment"
  ),
  form("pc_imfm", "Important Message from Medicare", [consent("An Important Message from Medicare about your rights", T.imfm), ...SIGNED], "IMFM 2025 (CMS-10065), English"),
  form("pc_imfm_es", "Important Message from Medicare (Spanish)", [consent("Un mensaje importante de Medicare", T.imfm_es), ...SIGNED_ES], "IMFM 2025 (CMS-10065), Spanish"),
  form("pc_moon", "Medicare Outpatient Observation Notice", [consent("Medicare Outpatient Observation Notice", T.moon), ...SIGNED], "MOON (CMS-10611), English"),
  form(
    "pc_moon_es",
    "Medicare Outpatient Observation Notice (Spanish)",
    [consent("Aviso para los pacientes ambulatorios de Medicare sobre servicios de observación", T.moon_es), ...SIGNED_ES],
    "MOON (CMS-10611), Spanish"
  ),
];

type ConsentFlag = "consentTreatment" | "consentHipaa" | "consentFinancial" | "consentAssignment";

// Consent forms that tick the Patient Gateway scheduling consents. The practice's financial policy carries the
// assignment of benefits too, so signing it ticks both.
export const CONSENT_FLAGS: Record<string, ConsentFlag[]> = {
  "consent.treatment": ["consentTreatment"],
  "consent.hipaa": ["consentHipaa"],
  "consent.financial": ["consentFinancial"],
  "consent.assignment": ["consentAssignment"],
  "consent.financial+assignment": ["consentFinancial", "consentAssignment"],
};

// Stock consent forms from before the practice's own were loaded, and what replaced each (null: folded into another).
export const RETIRED_TEMPLATES: Record<string, string | null> = {
  pt_hipaa: "pc_hipaa",
  pt_consent_treatment: "pc_debridement",
  pt_financial: "pc_financial",
  pt_aob: null,
  pt_telehealth_consent: "pc_telehealth",
};

// What a patient-form answer can fill in (Documentation designer -> "Fills patient field").
export const MAP_TARGETS: [string, string][] = [
  ...DOC_FIELDS.map((f): [string, string] => [f.key, `${FIELD_GROUPS[f.group]}: ${f.label}`]),
  ["consent.treatment", "Consent: treatment"],
  ["consent.hipaa", "Consent: HIPAA acknowledgement"],
  ["consent.financial", "Consent: financial policy"],
  ["consent.assignment", "Consent: assignment of benefits"],
  ["consent.financial+assignment", "Consent: financial policy and assignment of benefits"],
];

// The consents sent from the Patient Gateway hand-off, in the order the patient signs them.
export const CONSENT_PACKET_NAME = "Initial Encounter Packet";

export const DEFAULT_PACKETS: { name: string; description: string; keys: string[] }[] = [
  {
    name: "New Patient Packet",
    description: "Everything we need before a first visit",
    keys: ["pt_demographics", "pt_insurance", "pt_photo_id", "pt_pcp", "pt_medical_history", "pt_meds_allergies", "pt_wound_history", "pc_hipaa", "pc_debridement", "pc_financial"],
  },
  { name: "Returning Patient Update", description: "Confirm details before a follow-up", keys: ["pt_demographics", "pt_insurance", "pt_meds_allergies"] },
  { name: "Telehealth Visit Packet", description: "Consent and updates for a video visit", keys: ["pc_telehealth", "pt_meds_allergies", "pt_wound_history"] },
  { name: "Consents Only", description: "HIPAA, debridement consent and financial policy", keys: ["pc_hipaa", "pc_debridement", "pc_financial"] },
  {
    name: CONSENT_PACKET_NAME,
    description: "HIPAA notice, debridement consent, financial policy, arbitration agreement and telehealth consent",
    keys: ["pc_hipaa", "pc_debridement", "pc_financial", "pc_arbitration", "pc_telehealth"],
  },
  { name: "Skin Substitute Consent", description: "Informed consent before a skin substitute application", keys: ["pc_skin_substitute"] },
  { name: "ActiGraft Consent", description: "Informed consent before ActiGraft treatment", keys: ["pc_actigraft"] },
  { name: "ABI Consent", description: "Informed consent before an ankle brachial index test", keys: ["pc_abi"] },
  { name: "Debridement Consent", description: "Debridement consent on its own (expires 30 days after signing)", keys: ["pc_debridement"] },
  { name: "Arbitration Agreement", description: "Arbitration agreement on its own", keys: ["pc_arbitration"] },
  { name: "Release of Information", description: "Medical record request from another organization", keys: ["pc_roi"] },
  { name: "White Rock Consent Packet", description: "White Rock Medical Center consent and privacy notice acknowledgment", keys: ["pc_white_rock", "pc_patient_rights"] },
  { name: "Important Message from Medicare", description: "IMFM 2025, English", keys: ["pc_imfm"] },
  { name: "Important Message from Medicare (Spanish)", description: "IMFM 2025, Spanish", keys: ["pc_imfm_es"] },
  { name: "Medicare Outpatient Observation Notice", description: "MOON, English", keys: ["pc_moon"] },
  { name: "Medicare Outpatient Observation Notice (Spanish)", description: "MOON, Spanish", keys: ["pc_moon_es"] },
];

export const DEFAULT_RULES: { name: string; kind: string; offsetHours: number; channel: string; packet?: string; onlyNewPatients?: boolean }[] = [
  { name: "New patient packet — 3 days before first visit", kind: "INTAKE_PACKET", offsetHours: 72, channel: "BOTH", packet: "New Patient Packet", onlyNewPatients: true },
  { name: "Appointment reminder — 1 day before", kind: "REMINDER", offsetHours: 24, channel: "BOTH" },
  { name: "Same-day reminder — 2 hours before", kind: "REMINDER", offsetHours: 2, channel: "SMS" },
  { name: "Visit survey — 2 hours after the visit", kind: "SURVEY", offsetHours: 2, channel: "SMS" },
];
