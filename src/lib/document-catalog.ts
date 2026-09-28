// Standard chart documents, workflows and documentation views every practice starts with.
// Practices customise them in Settings → Documentation settings (the designer), or add their own.
import { slugId, type DocumentSection, type FieldDef, type FieldType } from "./chart-forms";

type Spec = Omit<FieldDef, "id">;
type Opt = Partial<Pick<FieldDef, "required" | "help" | "unit" | "width">>;

const mk = (type: FieldType) => (label: string, o: Opt = {}): Spec => ({ label, type, ...o });
const t = mk("text");
const ta = mk("textarea");
const d = mk("date");
const yn = mk("yesno");
const cb1 = mk("checkbox");
const h = mk("heading");
const note = mk("note");
const n = (label: string, unit?: string, o: Opt = {}): Spec => ({ label, type: "number", unit, ...o });
const sel = (label: string, options: string[], o: Opt = {}): Spec => ({ label, type: "select", options, ...o });
const rad = (label: string, options: string[], o: Opt = {}): Spec => ({ label, type: "radio", options, ...o });
const cbs = (label: string, options: string[], o: Opt = {}): Spec => ({ label, type: "checkboxes", options, ...o });
const score = (label: string, bands: string[]): Spec => ({ label, type: "score", options: bands });
const req: Opt = { required: true };
const half: Opt = { width: "half" };

function withIds(specs: Spec[]): FieldDef[] {
  const taken = new Set<string>();
  return specs.map((s) => ({ ...s, id: slugId(s.label, taken) }));
}

export type CatalogTemplate = {
  key: string;
  name: string;
  section: DocumentSection;
  kind: "BUILTIN" | "FORM";
  description?: string;
  perWound?: boolean;
  signatureRequired?: boolean;
  critical?: boolean;
  inProgressNote?: boolean;
  fields?: FieldDef[];
};

const builtin = (key: string, name: string, section: DocumentSection, description?: string): CatalogTemplate => ({
  key,
  name,
  section,
  kind: "BUILTIN",
  description,
});
const form = (key: string, name: string, section: DocumentSection, specs: Spec[], extra: Partial<CatalogTemplate> = {}): CatalogTemplate => ({
  key,
  name,
  section,
  kind: "FORM",
  fields: withIds(specs),
  ...extra,
});

const WOUND_PRODUCTS = [
  "Alginate",
  "Collagen",
  "Foam",
  "Hydrocolloid",
  "Hydrogel",
  "Silver antimicrobial",
  "Honey",
  "Cadexomer iodine",
  "Enzymatic debrider (collagenase)",
  "Gauze / ABD",
  "Transparent film",
  "Compression wrap",
  "Skin substitute / CTP",
  "NPWT",
];

export const STANDARD_TEMPLATES: CatalogTemplate[] = [
  // ---- Documentation ----
  builtin("cc", "Chief Complaint / HPI", "DOCUMENTATION"),
  builtin("vitals", "Vital Signs", "DOCUMENTATION"),
  builtin("wounds", "Active Wounds", "DOCUMENTATION"),
  builtin("problems", "Problem List", "DOCUMENTATION"),
  form(
    "physician_orders",
    "Physician Orders",
    "DOCUMENTATION",
    [
      h("Wound care"),
      ta("Wound care orders", { ...req, help: "Cleanse, primary / secondary dressing, frequency, for each wound" }),
      sel("Dressing change frequency", ["Daily", "Twice daily", "Every other day", "3x per week", "2x per week", "Weekly", "PRN"], half),
      n("Duration", "weeks", half),
      h("Other orders"),
      cbs("Orders", [
        "Offloading / pressure redistribution",
        "Compression therapy",
        "Nutrition consult",
        "Labs",
        "Imaging",
        "Vascular studies (ABI / TBI)",
        "Home health",
        "Physical therapy",
        "Debridement",
        "Culture / biopsy",
      ]),
      ta("Additional orders"),
      t("Home health agency / facility", half),
      d("Next visit", half),
    ],
    { signatureRequired: true }
  ),
  builtin("exam", "Physical Exam", "DOCUMENTATION"),
  builtin("assessment", "Assessment & Plan of Care", "DOCUMENTATION"),
  builtin("meds", "Medications, Orders & Labs", "DOCUMENTATION"),

  // ---- Procedure & treatment ----
  form("procedures", "Procedures", "PROCEDURE", [
    sel("Procedure", [
      "Selective debridement",
      "Excisional debridement (subcutaneous)",
      "Excisional debridement (muscle / fascia)",
      "Excisional debridement (bone)",
      "Skin substitute application",
      "Negative pressure wound therapy",
      "Multi-layer compression",
      "Total contact cast",
      "Unna boot",
      "Low-frequency ultrasound (MIST)",
      "Biopsy",
      "Other",
    ], req),
    t("Wound / site", half),
    t("Performed by", half),
    cbs("Consent & time-out", ["Consent obtained", "Time-out performed", "Patient identified x2", "Site marked"]),
    sel("Anesthesia", ["None", "Topical lidocaine", "Local injection", "Other"], half),
    sel("Instrument", ["Curette", "Scalpel", "Forceps & scissors", "Other"], half),
    sel("Tissue removed", ["Slough", "Eschar", "Biofilm", "Fibrin", "Subcutaneous tissue", "Muscle / fascia", "Bone"], half),
    sel("Depth of debridement", ["Epidermis / dermis", "Subcutaneous", "Muscle / fascia", "Bone"], half),
    n("Area debrided", "cm²", half),
    sel("Bleeding", ["None", "Minimal", "Moderate", "Heavy"], half),
    sel("Hemostasis", ["Pressure", "Silver nitrate", "Electrocautery", "Not required"], half),
    rad("Patient tolerance", ["Well", "Fair", "Poor"], half),
    ta("Procedure note", req),
  ]),
  form(
    "treatment_notes",
    "Treatment Notes",
    "PROCEDURE",
    [
      sel("Treatment", ["Dressing change", "Low-frequency ultrasound (MIST)", "Compression", "NPWT change", "Skin substitute", "Offloading", "Other"], req),
      cbs("Cleansed with", ["Normal saline", "Wound cleanser", "Hypochlorous acid", "Dakin's", "Povidone iodine"]),
      cbs("Primary dressing", WOUND_PRODUCTS),
      cbs("Secondary dressing", ["Bordered foam", "ABD pad", "Gauze", "Kerlix / roll gauze", "Tape", "Compression"]),
      n("Treatment time", "minutes", half),
      rad("Patient tolerance", ["Well", "Fair", "Poor"], half),
      ta("Treatment note", req),
    ],
    { perWound: true }
  ),
  builtin("multiwound", "Multi Wound Chart", "PROCEDURE"),

  // ---- Progress note / billing ----
  builtin("progress", "Progress Note", "PROGRESS"),
  builtin("superbill", "SuperBill", "BILLING"),
  builtin("signatures", "Attestation & Signatures", "BILLING"),

  // ---- Additional documents ----
  form("prescriptions", "Prescriptions", "ADDITIONAL", [
    t("Medication", req),
    t("Strength / form", half),
    t("Quantity", half),
    t("Sig (directions)", req),
    n("Refills", undefined, half),
    cb1("Dispense as written", half),
    t("Pharmacy"),
    ta("Notes"),
  ]),
  form("abuse_screening", "Abuse Screening Assessment", "ADDITIONAL", [
    yn("Does anyone at home hurt, hit or threaten you?", req),
    yn("Are you afraid of anyone close to you?", req),
    yn("Has anyone taken your money or belongings without permission?"),
    yn("Has anyone failed to help you with care you need?"),
    yn("Signs of neglect or unexplained injuries observed?"),
    sel("Outcome", ["Negative screen", "Positive screen — referred", "Patient declined"], req),
    ta("Referral / action taken"),
  ]),
  form("advance_directives", "Advanced Directives", "ADDITIONAL", [
    yn("Does the patient have an advance directive?", req),
    cbs("Documents on file", ["Living will", "Healthcare power of attorney", "POLST / MOLST", "DNR order"]),
    sel("Code status", ["Full code", "DNR", "DNR / DNI", "Comfort care only"], req),
    t("Healthcare agent", half),
    t("Agent phone", half),
    yn("Information provided on advance directives?"),
    ta("Notes"),
  ]),
  form("allergy_list", "Allergy List", "ADDITIONAL", [
    yn("No known drug allergies (NKDA)", half),
    yn("Latex allergy", half),
    ta("Allergies & reactions", { help: "Allergen — reaction — severity, one per line" }),
    yn("Allergies reviewed with patient", req),
  ]),
  form(
    "attestation_statements",
    "Attestation Statements",
    "ADDITIONAL",
    [
      cbs("Attestations", [
        "I personally performed the services documented",
        "Services were medically necessary",
        "Scribe documented in my presence; I reviewed and agree",
        "Incident-to requirements met (direct supervision)",
        "Teaching physician present for key portions",
      ], req),
      ta("Additional statement"),
    ],
    { signatureRequired: true }
  ),
  form(
    "ctp",
    "Cell and Tissue Based Products",
    "ADDITIONAL",
    [
      t("Product name", req),
      t("Lot number", half),
      t("Serial number", half),
      d("Expiration date", half),
      n("Application number", undefined, half),
      n("Wound size", "cm²", half),
      n("Product size applied", "cm²", half),
      n("Product wasted", "cm²", half),
      t("Wastage reason", half),
      cbs("Conservative care failed (≥4 weeks)", ["Offloading", "Compression", "Moist wound care", "Debridement", "Infection control", "Glycemic control"]),
      ta("Application note", req),
    ],
    { perWound: true, signatureRequired: true }
  ),
  form("diabetic_foot_exam", "Diabetic Foot Exam", "ADDITIONAL", [
    h("Monofilament (10 g)"),
    rad("Right foot sensation", ["Intact", "Diminished", "Absent"], half),
    rad("Left foot sensation", ["Intact", "Diminished", "Absent"], half),
    h("Pulses"),
    sel("Right dorsalis pedis", ["2+ normal", "1+ diminished", "Absent", "Doppler only"], half),
    sel("Left dorsalis pedis", ["2+ normal", "1+ diminished", "Absent", "Doppler only"], half),
    sel("Right posterior tibial", ["2+ normal", "1+ diminished", "Absent", "Doppler only"], half),
    sel("Left posterior tibial", ["2+ normal", "1+ diminished", "Absent", "Doppler only"], half),
    cbs("Findings", ["Callus", "Deformity", "Charcot foot", "Nail dystrophy", "Fissures", "Dry skin", "Tinea", "Amputation"]),
    sel("Risk category (IWGDF)", ["0 — very low", "1 — low", "2 — moderate", "3 — high"], req),
    ta("Footwear / education"),
  ]),
  form("discharge_instructions", "Discharge Instructions", "ADDITIONAL", [
    ta("Wound care at home", req),
    cbs("Call us if", ["Fever over 100.4°F", "Increased redness or swelling", "Foul odor", "Increased drainage", "Increased pain", "Bleeding that won't stop"]),
    ta("Activity / diet"),
    d("Follow-up date", half),
    yn("Patient / caregiver verbalized understanding", { ...req, width: "half" }),
  ]),
  form("em_time", "E&M Time Statements", "ADDITIONAL", [
    n("Total time on date of service", "minutes", req),
    cbs("Activities included", [
      "Reviewing records / tests",
      "History & exam",
      "Counseling patient / family",
      "Ordering tests / procedures",
      "Care coordination",
      "Documenting in the record",
    ]),
    ta("Time statement", { help: "e.g. I spent 35 minutes on the date of service, excluding separately billed procedures." }),
  ]),
  form("education_goals", "Education Goals", "ADDITIONAL", [
    cbs("Topics", ["Wound care", "Nutrition", "Offloading", "Compression", "Glycemic control", "Smoking cessation", "Infection signs", "Medication"]),
    ta("Goals", req),
    rad("Goal status", ["Met", "Progressing", "Not met"]),
  ]),
  form("educational_needs", "Educational Needs Assessment / Barriers to Learning", "ADDITIONAL", [
    cbs("Barriers to learning", ["None", "Language", "Hearing", "Vision", "Cognitive", "Literacy", "Emotional", "Cultural / religious", "Physical"]),
    sel("Preferred learning method", ["Verbal", "Written", "Demonstration", "Video"], half),
    yn("Interpreter needed", half),
    t("Primary learner (patient / caregiver)"),
    ta("Notes"),
  ]),
  form("fall_risk", "Fall Risk Assessment (Morse)", "ADDITIONAL", [
    rad("History of falling (3 months)", ["No|0", "Yes|25"], req),
    rad("Secondary diagnosis", ["No|0", "Yes|15"], req),
    rad("Ambulatory aid", ["None / bed rest / nurse assist|0", "Crutches / cane / walker|15", "Furniture|30"], req),
    rad("IV / heparin lock", ["No|0", "Yes|20"], req),
    rad("Gait", ["Normal / bed rest / wheelchair|0", "Weak|10", "Impaired|20"], req),
    rad("Mental status", ["Oriented to own ability|0", "Forgets limitations|15"], req),
    score("Morse fall score", ["24|No risk", "44|Low risk", "125|High risk"]),
    ta("Fall precautions"),
  ]),
  form("family_history", "Family History", "ADDITIONAL", [
    cbs("Conditions in family", ["Diabetes", "Heart disease", "Hypertension", "Stroke", "Cancer", "Peripheral vascular disease", "Kidney disease", "Clotting disorder"]),
    ta("Details (relative — condition)"),
  ]),
  form("immunizations", "Immunizations", "ADDITIONAL", [
    d("Tetanus (Td / Tdap)", half),
    d("Influenza", half),
    d("Pneumococcal", half),
    d("COVID-19", half),
    d("Hepatitis B", half),
    yn("Immunizations reviewed", half),
    ta("Notes"),
  ]),
  builtin("inactivewounds", "Inactive Wounds", "ADDITIONAL"),
  form("lower_extremity", "Lower Extremity Assessment", "ADDITIONAL", [
    h("Ankle-brachial index"),
    n("Right ABI", undefined, half),
    n("Left ABI", undefined, half),
    h("Edema"),
    sel("Right edema", ["None", "1+", "2+", "3+", "4+"], half),
    sel("Left edema", ["None", "1+", "2+", "3+", "4+"], half),
    cbs("Skin", ["Hemosiderin staining", "Lipodermatosclerosis", "Atrophie blanche", "Varicosities", "Hair loss", "Shiny skin", "Dependent rubor"]),
    sel("Capillary refill", ["< 3 seconds", "> 3 seconds"], half),
    sel("Temperature", ["Warm", "Cool", "Cold"], half),
    n("Right calf circumference", "cm", half),
    n("Left calf circumference", "cm", half),
    ta("Notes"),
  ]),
  form("lymphedema", "Lymphedema", "ADDITIONAL", [
    sel("Affected limb", ["Right leg", "Left leg", "Both legs", "Right arm", "Left arm"], req),
    sel("Stage", ["0 — latent", "I — reversible", "II — spontaneously irreversible", "III — elephantiasis"], half),
    yn("Stemmer sign positive", half),
    n("Circumference — ankle", "cm", half),
    n("Circumference — calf", "cm", half),
    cbs("Treatment", ["Compression garment", "Multi-layer wrapping", "Manual lymph drainage", "Pneumatic compression", "Elevation", "Exercise"]),
    ta("Notes"),
  ]),
  form("medical_history", "Medical History", "ADDITIONAL", [
    cbs("Conditions", [
      "Diabetes type 1",
      "Diabetes type 2",
      "Hypertension",
      "CAD",
      "CHF",
      "PVD / PAD",
      "Venous insufficiency",
      "COPD",
      "CKD",
      "Dialysis",
      "Stroke",
      "Paralysis / SCI",
      "Obesity",
      "Malnutrition",
      "Dementia",
      "Immunosuppression",
      "Cancer",
    ]),
    n("Last HbA1c", "%", half),
    t("Smoking status", half),
    ta("Other history"),
  ]),
  form("narrative_notes", "Narrative Notes", "ADDITIONAL", [ta("Narrative note", req)]),
  form(
    "npwt",
    "Negative Pressure Wound Therapy",
    "ADDITIONAL",
    [
      t("Device", half),
      sel("Mode", ["Continuous", "Intermittent", "Variable"], half),
      n("Pressure", "mmHg", half),
      sel("Foam / filler", ["Black (GranuFoam)", "White (VersaFoam)", "Silver", "Gauze"], half),
      n("Pieces of foam removed", undefined, half),
      n("Pieces of foam placed", undefined, half),
      n("Canister output", "mL", half),
      sel("Seal", ["Intact", "Leak repaired", "Leak — changed"], half),
      ta("Notes"),
    ],
    { perWound: true }
  ),
  form("nutrition_risk", "Nutrition Risk Assessment (MNA-SF)", "ADDITIONAL", [
    rad("Food intake declined over past 3 months", ["Severe decrease|0", "Moderate decrease|1", "No decrease|2"], req),
    rad("Weight loss in past 3 months", ["More than 3 kg|0", "Does not know|1", "1–3 kg|2", "No weight loss|3"], req),
    rad("Mobility", ["Bed or chair bound|0", "Gets out of bed / chair but does not go out|1", "Goes out|2"], req),
    rad("Psychological stress or acute disease (3 months)", ["Yes|0", "No|2"], req),
    rad("Neuropsychological problems", ["Severe dementia or depression|0", "Mild dementia|1", "None|2"], req),
    rad("BMI", ["Less than 19|0", "19 to less than 21|1", "21 to less than 23|2", "23 or more|3"], req),
    score("Screening score", ["7|Malnourished", "11|At risk of malnutrition", "14|Normal nutritional status"]),
    cbs("Interventions", ["Dietitian referral", "Protein supplement", "Multivitamin", "Weekly weights"]),
  ]),
  form("offloading", "Offloading and Support Surface Surveillance", "ADDITIONAL", [
    cbs("Offloading devices", ["Heel boots", "Wedges / pillows", "Total contact cast", "Walking boot", "Post-op shoe", "Felt padding", "Wheelchair cushion"]),
    sel("Support surface", ["Standard mattress", "Pressure-redistribution foam", "Alternating pressure", "Low air loss", "Air-fluidized"], half),
    sel("Turning schedule", ["Every 2 hours", "Every 3 hours", "Every 4 hours", "Independent"], half),
    yn("Device in use and appropriate", req),
    ta("Notes"),
  ]),
  form("pain_assessment", "Pain Assessment", "ADDITIONAL", [
    sel("Pain scale", ["0 — no pain", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10 — worst pain"], req),
    t("Location", half),
    cbs("Quality", ["Aching", "Burning", "Sharp", "Stabbing", "Throbbing", "Shooting"]),
    sel("Frequency", ["Constant", "Intermittent", "With dressing changes only"], half),
    t("Relieved by", half),
    ta("Pain management plan"),
  ]),
  form("caregiver_education", "Patient Care Giver Education", "ADDITIONAL", [
    cbs("Education provided", ["Dressing change technique", "Signs of infection", "Offloading", "Nutrition", "Hand hygiene", "Medication", "When to call"]),
    t("Taught to", half),
    sel("Method", ["Verbal", "Demonstration", "Written", "Teach-back"], half),
    rad("Understanding", ["Verbalized", "Demonstrated", "Needs reinforcement"], req),
  ]),
  form("communication_log", "Patient Communication Log", "ADDITIONAL", [
    sel("Contact type", ["Phone — outgoing", "Phone — incoming", "Portal message", "In person", "Fax", "Email"], req),
    t("Contact with", half),
    t("Regarding", half),
    ta("Communication", req),
    yn("Follow-up needed", half),
  ]),
  form("physical_exam_systems", "Physical Exam (by system)", "ADDITIONAL", [
    sel("General", ["Well appearing", "Ill appearing", "In distress"], half),
    sel("Skin", ["Warm and dry", "Diaphoretic", "Pale", "Jaundiced"], half),
    t("HEENT", half),
    t("Cardiovascular", half),
    t("Respiratory", half),
    t("Abdomen", half),
    t("Musculoskeletal", half),
    t("Neurologic", half),
    t("Psychiatric", half),
    ta("Other findings"),
  ]),
  form("plan_of_care", "Plan Of Care", "ADDITIONAL", [
    ta("Problems / wound diagnoses", req),
    ta("Goals", req),
    ta("Interventions", req),
    sel("Frequency of visits", ["Weekly", "Twice weekly", "Every 2 weeks", "Monthly"], half),
    n("Expected duration", "weeks", half),
    rad("Prognosis", ["Good", "Fair", "Guarded", "Poor"]),
  ]),
  form("pneumatic_compression", "Pneumatic Compression Module", "ADDITIONAL", [
    t("Device", half),
    sel("Limb", ["Right leg", "Left leg", "Both legs", "Right arm", "Left arm"], half),
    n("Pressure", "mmHg", half),
    n("Session length", "minutes", half),
    sel("Frequency", ["Once daily", "Twice daily", "3x per week"], half),
    cbs("Qualifying criteria", ["4 weeks conservative therapy failed", "Chronic venous insufficiency with ulcers", "Lymphedema"]),
    ta("Notes"),
  ]),
  form("braden", "Pressure Ulcer Risk Assessment (Braden)", "ADDITIONAL", [
    rad("Sensory perception", ["Completely limited|1", "Very limited|2", "Slightly limited|3", "No impairment|4"], req),
    rad("Moisture", ["Constantly moist|1", "Very moist|2", "Occasionally moist|3", "Rarely moist|4"], req),
    rad("Activity", ["Bedfast|1", "Chairfast|2", "Walks occasionally|3", "Walks frequently|4"], req),
    rad("Mobility", ["Completely immobile|1", "Very limited|2", "Slightly limited|3", "No limitation|4"], req),
    rad("Nutrition", ["Very poor|1", "Probably inadequate|2", "Adequate|3", "Excellent|4"], req),
    rad("Friction & shear", ["Problem|1", "Potential problem|2", "No apparent problem|3"], req),
    score("Braden score", ["9|Very high risk", "12|High risk", "14|Moderate risk", "18|Mild risk", "23|No risk"]),
    ta("Prevention plan"),
  ]),
  form("pcm", "Principal Care Management", "ADDITIONAL", [
    t("Principal chronic condition", req),
    n("Time this month", "minutes", half),
    sel("Performed by", ["Physician / QHP", "Clinical staff"], half),
    cbs("Activities", ["Care plan review", "Medication management", "Care coordination", "Patient education", "Test follow-up"]),
    yn("Verbal consent documented", half),
    ta("Notes"),
  ]),
  form("recap", "RECAP Documentation", "ADDITIONAL", [
    ta("Reason for visit", req),
    ta("Evaluation"),
    ta("Care provided"),
    ta("Assessment of progress"),
    ta("Plan / next steps"),
  ]),
  form("ros", "Review of Systems", "ADDITIONAL", [
    cbs("Positive findings", [
      "Fever / chills",
      "Weight change",
      "Chest pain",
      "Shortness of breath",
      "Leg swelling",
      "Claudication",
      "Numbness / tingling",
      "Nausea / vomiting",
      "Rash / itching",
      "Depression / anxiety",
    ]),
    cb1("All other systems reviewed and negative"),
    ta("Notes"),
  ]),
  form("social_history", "Social History", "ADDITIONAL", [
    sel("Tobacco", ["Never", "Former", "Current every day", "Current some days"], half),
    sel("Alcohol", ["None", "Social", "Daily"], half),
    sel("Living situation", ["Home alone", "Home with family", "Assisted living", "Skilled nursing facility", "Homeless"], half),
    sel("Ambulation", ["Independent", "Cane / walker", "Wheelchair", "Bedbound"], half),
    ta("Notes"),
  ]),
  form("surgical_history", "Surgical History", "ADDITIONAL", [ta("Surgeries (procedure — year)", req), yn("Prior amputation", half), yn("Prior vascular surgery", half)]),
  form("telehealth_plans", "Telehealth Treatment Plans", "ADDITIONAL", [ta("Treatment plan", req), sel("Telehealth frequency", ["Weekly", "Every 2 weeks", "Monthly"], half), yn("In-person visit needed", half)]),
  form(
    "telemedicine_consent",
    "Telemedicine Consent",
    "ADDITIONAL",
    [
      note("The patient was informed of the nature of telemedicine, its benefits and limits, privacy protections, and the right to refuse or request an in-person visit."),
      rad("Consent", ["Consent given", "Consent declined"], req),
      sel("Consent obtained by", ["Verbal", "Written", "Portal"], half),
      t("Patient location (state)", half),
    ],
    { critical: true }
  ),
  form("telemedicine_visit", "Telemedicine Visit", "ADDITIONAL", [
    sel("Modality", ["Audio & video", "Audio only"], req),
    t("Platform", half),
    t("Patient location", half),
    t("Provider location", half),
    n("Visit length", "minutes", half),
    t("Others present", half),
    ta("Visit note"),
  ]),
  form("visit_discharge_info", "Visit Discharge Information", "ADDITIONAL", [
    sel("Discharged to", ["Home", "Home with home health", "Skilled nursing facility", "Hospital", "Hospice"], req),
    sel("Condition", ["Stable", "Improved", "Unchanged", "Declined"], half),
    t("Accompanied by", half),
    ta("Notes"),
  ]),
  form(
    "wound_management_plan",
    "Wound Management Plan",
    "ADDITIONAL",
    [
      ta("Goals for this wound", req),
      cbs("Plan", ["Continue current treatment", "Change dressing", "Debridement", "Advanced modality", "Refer to vascular", "Refer to podiatry", "Refer to infectious disease"]),
      sel("Healing trajectory", ["Improving", "Stalled", "Deteriorating", "Healed"], half),
      d("Target heal date", half),
    ],
    { perWound: true }
  ),
  form("wound_product_supplier", "Wound Product Supplier", "ADDITIONAL", [
    t("Supplier", req),
    t("Supplier phone", half),
    t("Order number", half),
    cbs("Products ordered", WOUND_PRODUCTS),
    n("Quantity (days supply)", "days", half),
    d("Order date", half),
    ta("Notes"),
  ]),
];

export type CatalogWorkflow = { name: string; description: string; visitTypes: string[]; isDefault?: boolean; steps: [string, boolean][] };

// [template key, required to finalize]
export const STANDARD_WORKFLOWS: CatalogWorkflow[] = [
  {
    name: "Wound Care Visit",
    description: "Provider wound care visit — documentation, procedures, progress note and superbill.",
    visitTypes: ["NEW", "FOLLOW_UP", "SICK", "WELL", "WOUND_CARE"],
    isDefault: true,
    steps: [
      ["cc", true],
      ["vitals", false],
      ["wounds", true],
      ["problems", false],
      ["physician_orders", false],
      ["exam", true],
      ["assessment", true],
      ["meds", false],
      ["procedures", false],
      ["treatment_notes", false],
      ["multiwound", false],
      ["progress", false],
      ["superbill", false],
      ["signatures", false],
    ],
  },
  {
    name: "Non-Provider Treatment Visit",
    description: "Clinical staff treatment visit (e.g. ultrasound MIST therapy, dressing change).",
    visitTypes: ["NON_PROVIDER"],
    steps: [
      ["cc", true],
      ["vitals", false],
      ["wounds", true],
      ["treatment_notes", true],
      ["multiwound", false],
      ["progress", false],
      ["superbill", false],
      ["signatures", false],
    ],
  },
  {
    name: "Telehealth Visit",
    description: "Audio/video visit with telemedicine consent.",
    visitTypes: ["TELE"],
    steps: [
      ["telemedicine_consent", true],
      ["cc", true],
      ["telemedicine_visit", true],
      ["wounds", false],
      ["assessment", true],
      ["progress", false],
      ["superbill", false],
      ["signatures", false],
    ],
  },
];

// Documentation view parts: facesheet, note, problems, meds, wounds, documents, superbill, signatures, attachments, doc:<key>.
export const VIEW_PARTS: Record<string, string> = {
  facesheet: "Face sheet (demographics & insurance)",
  note: "Progress note (SOAP)",
  problems: "Problem list, allergies & medications",
  wounds: "Wound assessments",
  documents: "All completed documents",
  superbill: "Superbill (diagnoses & procedures)",
  signatures: "Signatures",
  attachments: "Scans & test result files (list)",
};

export const STANDARD_VIEWS: { name: string; description: string; parts: string[] }[] = [
  { name: "Progress Note", description: "The signed progress note", parts: ["note", "signatures"] },
  { name: "Progress Note + Physician Orders", description: "Progress note with this visit's orders", parts: ["note", "doc:physician_orders", "signatures"] },
  { name: "All Documentation", description: "Everything documented on this visit", parts: ["facesheet", "note", "wounds", "documents", "superbill", "signatures", "attachments"] },
  { name: "Facility Documentation", description: "For the facility chart (SNF / ALF)", parts: ["note", "wounds", "doc:treatment_notes", "doc:wound_management_plan", "doc:physician_orders", "signatures"] },
  { name: "Physician Orders + Facesheet", description: "Orders with patient demographics", parts: ["facesheet", "doc:physician_orders", "signatures"] },
  { name: "Patient Referral Sheet", description: "Referral packet", parts: ["facesheet", "problems", "wounds", "doc:plan_of_care"] },
  { name: "Home Health Agency", description: "Orders and plan for the home health agency", parts: ["facesheet", "doc:physician_orders", "doc:wound_management_plan", "wounds"] },
  { name: "Ancillary Service Order", description: "Ancillary orders with coding", parts: ["facesheet", "doc:physician_orders", "superbill"] },
  { name: "Wound PCR", description: "Wound progress and care record", parts: ["wounds", "doc:treatment_notes", "doc:procedures"] },
];
