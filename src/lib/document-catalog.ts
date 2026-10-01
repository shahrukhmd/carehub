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
  audience?: "STAFF" | "PATIENT";
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

const YES_NO_NA = ["Yes", "No", "N/A"];
const PULSE = ["Palpable", "Diminished", "Doppler only", "Absent", "Not assessed"];
const PAIN_0_10 = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
const TREATMENT_RESPONSE = ["Procedure was tolerated well", "Procedure was tolerated with difficulty", "Procedure was stopped — patient unable to tolerate"];
const COMPRESSION_DEVICES = ["Unna's or Duke Boot", "Multi-layer compression wrap", "Compression stockings", "Tubular bandage (Tubigrip)", "Short-stretch bandage", "Pneumatic compression pump", "Other"];
const OFFLOADING_DEVICES = ["Felt and Foam", "Static Overlay", "Multipodus / heel protector boots", "Total contact cast", "CAM / walking boot", "Post-op / healing shoe", "Wheelchair cushion", "Pillows", "Other"];
// One Review of Systems block: what the patient complains of (+) and what they deny (-).
const rosSystem = (system: string, symptoms: string[]): Spec[] => [h(system), cbs(`${system} — patient complains of (+)`, symptoms, half), cbs(`${system} — patient denies (-)`, symptoms, half)];
// Left / right pair of the same finding.
const leftRight = (label: string, options: string[]): Spec[] => [sel(`Left — ${label}`, options, half), sel(`Right — ${label}`, options, half)];

// Templates whose standard layout changed to follow the practice's visit report (Review of Systems, Physician Orders...).
// A practice that never edited or used the old layout gets the new one in place; otherwise it is added beside the old.
export const REVISED_TEMPLATES = ["physician_orders", "allergy_list", "ctp", "lower_extremity", "physical_exam_systems", "plan_of_care", "ros"];

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
      h("Wound orders"),
      t("Wound(s) these orders are for", { help: "e.g. Wound #1 Left Lower Leg" }),
      ta("Wound cleansing"),
      ta("Topical", { help: "e.g. Apply Gentamicin ointment to wound bed — which days" }),
      ta("Wound dressing choice", { ...req, help: "Primary and secondary dressing, when to change the outer dressing, what to leave in place" }),
      sel("Dressing change frequency", ["Daily", "Twice daily", "Every other day", "3x per week", "2x per week", "Weekly", "As ordered above", "PRN"], half),
      n("Duration", "weeks", half),
      h("Compression therapy"),
      cbs("Compression", ["Left Leg", "Right Leg", "Apply Unna Boot and cover with rolled gauze and coban or comparable", "Multi-layer compression wrap", "Compression stockings", "Elevate legs whenever possible"]),
      t("Compression instructions"),
      h("Offloading"),
      cbs("Offloading orders", OFFLOADING_DEVICES),
      h("Home health"),
      cbs("Home health", [
        "Patient is eligible for home health and meets the criteria for home health services based on patient's homebound status and inability to leave the home or requires considerable and taxing effort to leave the home",
        "Skilled Nursing is required for wound care",
      ]),
      sel("Patient to be seen by home health prior to next wound care visit", ["1x per week", "2x per week", "3x per week", "Daily", "Not applicable"], half),
      t("Home health agency / facility", half),
      ta("Home health instructions", { help: "Include the number to call if unsure" }),
      h("Other orders"),
      cbs("Orders", ["Nutrition consult", "Labs", "Imaging", "Vascular studies (ABI / TBI)", "Physical therapy", "Culture / biopsy", "Referral"]),
      ta("Additional orders"),
      h("Follow up"),
      sel("Patient follow up visit in", ["One week", "Two weeks", "Three weeks", "One month", "PRN"], half),
      d("Provider is scheduled to see patient on", half),
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
    ta("Active allergies", { help: "One per line: allergen — reaction — severity" }),
    ta("Allergy notes"),
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
    "Cell and Tissue Based Product Application",
    "ADDITIONAL",
    [
      t("Cell and/or tissue-based product", { ...req, help: "e.g. Membrane wrap" }),
      t("Performed by", half),
      n("Application number", undefined, half),
      yn("Time-out taken", half),
      sel("Location", ["trunk / arms / legs", "face / scalp / eyelids / mouth / neck / ears / orbits / genitalia / hands / feet / multiple digits"], half),
      n("Application area", "sq cm", half),
      n("Product applied", "sq cm", half),
      n("Product waste", "sq cm", half),
      sel("Waste reason", ["Excess", "Product size larger than wound", "Contaminated", "Other"], half),
      h("Lot / order numbers"),
      t("Lot #", half),
      t("Order #", half),
      d("Expiration date", half),
      t("Lot 2 #", half),
      t("Order 2 #", half),
      d("Expiration date 2", half),
      t("Lot 3 #", half),
      t("Order 3 #", half),
      d("Expiration date 3", half),
      t("Lot 4 #", half),
      t("Order 4 #", half),
      d("Expiration date 4", half),
      h("Application"),
      t("Time of application", { ...half, help: "e.g. 1:30 PM" }),
      yn("Fenestrated", half),
      yn("Secured", half),
      t("Secured with", half),
      yn("Dressing applied", half),
      t("Dressing applied — which", { ...half, help: "e.g. Collagen / Vaseline gauze / Unna boot" }),
      sel("Procedural pain", PAIN_0_10, half),
      sel("Post procedural pain", PAIN_0_10, half),
      sel("Response to treatment", TREATMENT_RESPONSE),
      h("Medical necessity statements"),
      cbs("Statements that apply", [
        "Subsequent application: The ulcer has been responding to the treatment with improvement to both tissue and measurements. Treatment will continue with standard wound care in conjunction with continued assessment, treatment and reapplication of the cellular tissue product if appropriate in accordance to the FDA approved product indication for use, as it is medically necessity as a wound covering and barrier.",
        "Vascular assessment: Based on vascular assessment and testing, patient's vascular status falls within the standard requirement for healing.",
        "Debridement & infection: Patient has been undergoing serial debridement. Ulcer remains clean and moist with appropriate dressings. Ulcer is free of infection.",
        "Nutrition: Patient's nutrition, which is being optimized, has been discussed and education provided. Patient's blood glucose is well controlled as evidence by an optimal A1C. Patient encouraged to continue to be compliant with diet recommendations and proper monitoring.",
        "Non-smoker: Patient is a non-smoker.",
        "Smoking cessation: Patient has been counselled on smoking cessation and its effect on wound healing.",
        "Offloading: Patient continues to be compliant with wound offloading. Patient educated on importance of continued compliance of offloading to promoting wound healing.",
        "Compression: Edema is being controlled with >20mmHg. Patient educated on importance of continued compliance of limb elevation and compression to promote edema control and wound healing.",
        "Plan and medical necessity: Product was applied strictly following the FDA approved instructions found on the product insert. The plan going forward is to use the above cellular tissue product in accordance to the FDA approved product indication for use, as it is medically necessity as a wound covering and barrier. Ulcer will continue to receive standard wound care in conjunction with continued assessment, treatment and reapplication of the CTP if appropriate.",
      ]),
      cbs("Conservative care failed (≥4 weeks) — first application", ["Offloading", "Compression", "Moist wound care", "Debridement", "Infection control", "Glycemic control"]),
      ta("Additional notes"),
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
    h("Edema assessment"),
    ...leftRight("Edema", ["No", "Yes — 1+", "Yes — 2+", "Yes — 3+", "Yes — 4+"]),
    ...leftRight("Compression device in use", ["Yes", "No"]),
    ...leftRight("Compression device used correctly", YES_NO_NA),
    ...leftRight("Compression device used", COMPRESSION_DEVICES),
    h("Vascular assessment — pulses"),
    ...leftRight("Popliteal", PULSE),
    ...leftRight("Posterior tibial", PULSE),
    ...leftRight("Dorsalis pedis", PULSE),
    h("Extremity colors, hair growth, and conditions"),
    ...leftRight("Extremity color", ["Normal", "Pigmented", "Pale", "Red", "Cyanotic", "Mottled"]),
    ...leftRight("Hair growth on extremity", ["Yes", "No"]),
    ...leftRight("Temperature of extremity", ["Warm", "Cool", "Cold", "Hot"]),
    ...leftRight("Capillary refill", ["< 3 seconds", "> 3 seconds"]),
    ...leftRight("Erythema", ["Yes", "No"]),
    ...leftRight("Dependent rubor", ["Yes", "No"]),
    ...leftRight("Hyperpigmentation", ["Yes", "No"]),
    ...leftRight("Lipodermatosclerosis", ["Yes", "No"]),
    h("Off-loading"),
    ...leftRight("Off-loading device in use", ["Yes", "No"]),
    ...leftRight("Off-loading device used correctly", YES_NO_NA),
    ...leftRight("Off-loading device used", OFFLOADING_DEVICES),
    h("Measurements"),
    n("Left ABI", undefined, half),
    n("Right ABI", undefined, half),
    n("Left calf circumference", "cm", half),
    n("Right calf circumference", "cm", half),
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
    cb1("Patient not eligible for Lower Extremity Neurological Exam"),
    ta("Constitutional", {
      help: "Normal: Vital Signs reviewed and within normal limits. The pulse has a regular rate and rhythm. The patient is normotensive. The respiratory rate is regular and non labored. The patient is afebrile. The patient is clean, well groomed and no signs of distress.",
    }),
    ta("Eyes"),
    ta("Ears, Nose, Mouth and Throat"),
    ta("Respiratory"),
    ta("Cardiovascular"),
    ta("Gastrointestinal (GI)"),
    ta("Integumentary (Hair, Skin)", { help: "Wound locations and types, discoloration, induration" }),
    ta("Musculoskeletal"),
    ta("Neurological"),
    ta("Lower Extremity Neurological Exam"),
    ta("Psychiatric"),
    ta("Other findings"),
  ]),
  form("plan_of_care", "Plan Of Care", "ADDITIONAL", [
    cbs("Cellular Tissue Product Education", [
      "Patient's wound site has been present for greater than 4 weeks without significant improvement or complete healing. We have discussed at length the need to consider advanced biologic modalities in order to obtain the most optimal long term results. Understanding and agreement verbalized by patient.",
      "We will plan to re-apply the cellular tissue product on a weekly basis. Clinical evaluation will be made to determine if future applications are medically necessary as an adjunct therapy to standard wound care for further wound healing progression.",
      "Provided and reviewed educational material concerning the use, risks and benefits of a cellular tissue product.",
    ]),
    cbs("Compliance with Treatment Education", ["Importance of compliance with treatment plan in wound healing discussed at length today. Patient and/or caregiver verbalized understanding."]),
    cbs("Debridement", ["Discussed the importance of debridement in the wound healing process and why it is being used as part of the treatment plan."]),
    cbs("Edema Management", [
      "Patient was educated on edema management and proper skin care. Discussed importance of elevating lower extremities throughout the day when resting at home. Discussed importance of monitoring dietary sodium intake daily.",
      "Time was taken to discuss and demonstrate the importance of compliance with compression and the role it plays in controlling edema.",
    ]),
    cbs("Fall Risk", ["Educate patient to get up slowly from lying to sitting / pause / dangle / pause / ambulate."]),
    cbs("Nutrition Education", ["Importance of a balanced diet in the patient's overall health discussed."]),
    cbs("Smoking/Nicotine Cessation", ["Patient is a non-smoker and does not use nicotine.", "Smoking / nicotine cessation and its effect on wound healing discussed with the patient."]),
    cbs("Offloading / Pressure Relief", ["Importance of offloading and pressure redistribution in wound healing discussed with patient and/or caregiver."]),
    cbs("Wound Care", [
      "Will impliment and follow standard wound care to include: appropriate serial debridement, offloading when needed, edema control, mitigating and resolving potential and/or current infections, vascular status assessment when needed, product use to promote a wound healing environment, monitoring of patient's nutrition status and coordination with other health care providers who are managing other aspects of the patient's overall health, which contributes to the wound healing process.",
      "Patient's wound plan of care reviewed today. We discussed current regimen and recommendations in order to obtain the most optimal long term results. Understanding and agreement verbalized by patient and/or family / caregiver.",
      "Current wound(s) status documented in the EHR. Reassessment performed today and updated orders discussed.",
    ]),
    sel("Status", ["Initiated", "Continued", "Completed", "Discontinued"], { ...req, width: "half" }),
    sel("Frequency of visits", ["Weekly", "Twice weekly", "Every 2 weeks", "Monthly"], half),
    ta("General notes"),
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
    cbs("Information obtained from", ["Patient", "Chart", "Family", "Caregiver", "Facility staff"], req),
    ...rosSystem("Constitutional Symptoms (General Health)", ["Weakness", "Chills", "Fatigue", "Fever", "Loss of appetite", "Weight change"]),
    ...rosSystem("Eyes", ["Vision changes", "Glasses / contacts"]),
    ...rosSystem("Ear / Nose / Mouth / Throat", ["Hearing loss", "Difficulty swallowing"]),
    ...rosSystem("Respiratory", ["Shortness of breath", "Cough", "Oxygen use"]),
    ...rosSystem("Cardiovascular (Central/Peripheral)", ["Edema", "Lower extremity (leg) swelling", "Chest Pain", "Claudication"]),
    ...rosSystem("Gastrointestinal (GI)", ["Acid Reflux", "Constipation", "Nausea / Vomiting / Diarrhea (N/V/D)", "Bowel incontinence"]),
    ...rosSystem("Genitourinary (GU)", ["Urinary Incontinence", "Urinary frequency / burning", "Catheter"]),
    ...rosSystem("Endocrine", ["Diabetes — blood sugar not controlled", "Excessive thirst"]),
    ...rosSystem("Hematologic / Lymphatic", ["Bleeding / bruising easily", "On blood thinners"]),
    ...rosSystem("Integumentary (Hair/Skin/Nails)", ["Change: Hair, Nails, Skin", "Ulcers", "Rash / itching"]),
    ...rosSystem("Musculoskeletal", ["Assistive Devices", "Muscle Weakness", "Joint pain"]),
    ...rosSystem("Neurological", ["Memory Loss", "One-sided weakness", "Pain from Neuropathy", "Numbness / tingling"]),
    ...rosSystem("Psychiatric", ["Anxiety", "Depression"]),
    ta("Details", { help: "Anything to add to a finding, e.g. Urinary Incontinence - urinary incontinent" }),
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
    "debridement",
    "Debridement",
    "PROCEDURE",
    [
      t("Performed by", half),
      sel("Debridement", ["Selective", "Excisional — subcutaneous tissue", "Excisional — muscle / fascia", "Excisional — bone", "Mechanical", "Enzymatic", "Autolytic", "Ultrasound"], { ...req, width: "half" }),
      yn("Time-out taken", half),
      t("Pain control", { ...half, help: "e.g. 5% Lido" }),
      h("Post debridement measurements"),
      n("Length", "cm", half),
      n("Width", "cm", half),
      n("Depth", "cm", half),
      n("Area", "cm²", half),
      n("Percent debrided", "%", half),
      n("Total area debrided", "sq cm", half),
      n("Volume", "cm³", half),
      h("Procedure"),
      cbs("Devitalized tissue debrided", ["Biofilm", "Exudate", "Slough", "Eschar", "Fibrin", "Callus", "Necrotic tissue", "Subcutaneous tissue", "Muscle / fascia", "Bone"], req),
      cbs("Instrument", ["Curette", "Scalpel", "Forceps", "Scissors", "Other"]),
      sel("Bleeding", ["None", "Minimal", "Moderate", "Heavy"], half),
      sel("Hemostasis achieved", ["Pressure", "Silver nitrate", "Electrocautery", "Not required"], half),
      sel("Procedural pain", PAIN_0_10, half),
      sel("Post procedural pain", PAIN_0_10, half),
      sel("Response to treatment", TREATMENT_RESPONSE),
      cbs("Medical necessity statement", [
        "This wound has necrotic tissue and biofilm present that will impede continued wound healing. The debridement of the nonviable tissue and biofilm creating a clean wound bed is medically necessary to promote wound healing.",
      ]),
      ta("Notes"),
    ],
    { perWound: true, signatureRequired: true }
  ),
  form(
    "unna_boot",
    "Unna Boot Application",
    "PROCEDURE",
    [
      t("Performed by", half),
      sel("Limb", ["Left Leg", "Right Leg", "Both legs"], half),
      sel("Procedural pain", PAIN_0_10, half),
      sel("Post procedural pain", PAIN_0_10, half),
      sel("Response to treatment", TREATMENT_RESPONSE),
      ta("Notes"),
    ],
    { perWound: true }
  ),
  form(
    "wound_assessment_details",
    "Wound Assessment Details",
    "ADDITIONAL",
    [
      h("Wound status"),
      sel("Wound condition", ["Acute", "Chronic"], half),
      sel("Wound status", ["Not Healed", "Healed", "Converted", "Amputated", "Closed surgically"], half),
      yn("Acquired at facility", half),
      t("Unit acquired", half),
      yn("Recurrence of previously resolved wound", half),
      yn("Is the patient's wound a direct result of an accident?", half),
      d("Date of accident", half),
      t("Responsible party", half),
      sel("Avoidable wound", ["Avoidable", "Unavoidable", "Not determined"], half),
      d("Date of resolution", half),
      ta("Wound notes"),
      h("Wound description"),
      sel("Wound encounter", ["Initial", "Subsequent"], half),
      sel("Wound progress", ["Improving", "Not changed", "Deteriorating", "Healed"], half),
      sel("Thickness", ["Partial Thickness", "Full Thickness", "Unstageable", "Deep tissue injury"], half),
      sel("Wound margin", ["Attached to Wound Base", "Not attached", "Rolled (epibole)", "Macerated", "Callused", "Undefined"], half),
      cb1("No measurable depth"),
      cb1("Patient is not eligible for pain assessment"),
      t("Tunneling", half),
      t("Undermining", half),
      t("Sinus tract", half),
      cbs("Granulation color", ["Pale Grey", "Bright Red", "Pink"], half),
      h("Exposed structure"),
      yn("Limited to breakdown of skin", half),
      cbs("Exposed", ["Adipose", "Muscle", "Tendon", "Capsule", "Joint", "Bone"], half),
      cbs("Exposed with necrosis", ["Adipose", "Muscle", "Tendon", "Capsule", "Joint", "Bone"], half),
      yn("Suspected osteomyelitis", half),
      h("Periwound skin appearance"),
      cbs("Texture", ["Brawny Induration", "Edema", "Excoriation", "Induration", "Callus", "Crepitus", "Fluctuance", "Friable", "Rash", "Scar Tissue", "Shiny", "Denuded"], half),
      cbs("Color", ["Atrophe Blanche", "Cyanosis", "Ecchymosis", "Erythema", "Hemosiderin Staining", "Pallor", "Rubor"], half),
      sel("Moisture", ["Normal For Patient", "Dry / Scaly", "Maceration"], half),
      sel("Temperature", ["Warm", "Cool", "Hot", "No Abnormality"], half),
      yn("Signs / symptoms of infection present", half),
      h("Patient adherence"),
      yn("General non-compliance", half),
      cbs("Compliant with", ["Compression", "Diet", "Dressing Changes", "Exercise", "Limb Elevation", "Medication", "Off-Loading / Protection", "Smoking Cessation", "Wound Visits", "HBO Visits"]),
      t("Other adherence notes"),
      h("Offloading compliance"),
      sel("Patient continues to be compliant with offloading with the use of the following offloading device", OFFLOADING_DEVICES),
    ],
    { perWound: true }
  ),
  form("treatment_goals", "Treatment Goals", "ADDITIONAL", [
    h("Wound healing potential and chronic contributing conditions"),
    sel("Assessment", [
      "The patient's wound(s) have a high potential to heal with no complications.",
      "The patient's wound(s) have a moderate potential to heal; contributing conditions are being managed.",
      "The patient's wound(s) have a low potential to heal; goals are palliative / maintenance.",
    ], req),
    h("Education / understanding"),
    cbs("Patient / caregiver understanding", [
      "has understanding of treatment plan and how to care for wound(s).",
      "has skills necessary to maintain the individual plan of care.",
      "has the knowledge to be able to identify potential signs & symptoms that can impede wound healing.",
      "understands the need for continued care when health problems are identified.",
      "has the knowledge of risk factors and interventions to address.",
    ]),
    h("Clinical goals"),
    cbs("Clinical goals", ["Prevention of infection.", "Edema Control.", "Wound Closure.", "Pain control.", "Offloading / pressure relief.", "Maintenance / palliative care."], req),
    h("Wound healing timeline"),
    sel("Complete wound(s) healing is expected to be within", ["4 weeks", "8 weeks", "12 weeks", "16 weeks", "More than 16 weeks", "Not expected to heal"], half),
  ]),
  form("scribe_statement", "Scribe Statement", "ADDITIONAL", [
    t("This encounter was scribed by the following personnel", req),
    t("The scribe listed above scribed for the following provider", req),
  ]),
  form("vitals_additional", "Vital Signs — Blood Glucose & Oxygen", "ADDITIONAL", [
    n("Blood glucose", "mg/dl", half),
    t("Reference range", { ...half, help: "e.g. 60-110 mg/dl" }),
    n("Inhaled oxygen concentration", "L/min", half),
    n("Inhaled oxygen concentration (FiO2)", "%", half),
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
    visitTypes: ["NEW", "FOLLOW_UP", "SICK", "WELL", "WOUND_CARE", "INIT_WOUND", "EST_WOUND", "SNF_EST", "SURVEILLANCE"],
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
    visitTypes: ["TELE", "TELE_INIT", "TELE_EST"],
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
  {
    name: "Visit Report",
    description: "Every document of the visit, in the order of the practice's visit report",
    parts: [
      "doc:ros",
      "doc:vitals_additional",
      "doc:physical_exam_systems",
      "problems",
      "doc:physician_orders",
      "superbill",
      "note",
      "doc:plan_of_care",
      "doc:treatment_goals",
      "doc:scribe_statement",
      "doc:lower_extremity",
      "wounds",
      "doc:wound_assessment_details",
      "doc:debridement",
      "doc:unna_boot",
      "doc:ctp",
      "doc:allergy_list",
      "signatures",
    ],
  },
  { name: "Wound PCR", description: "Wound progress and care record", parts: ["wounds", "doc:treatment_notes", "doc:procedures"] },
];
