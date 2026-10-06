// Specialty packs. CareHub is a general EHR/PM: the core (patients, scheduler, billing, messaging, privacy) is
// specialty-neutral, and each specialty brings its own visit types, chart documents, workflows, order catalog and
// care-gap rules. A practice turns packs on under Settings → Practice setup; content tagged with a pack that is off
// is hidden from pickers (it stays in the database and in Settings). Untagged content is general and always shown.

export const SPECIALTIES: Record<string, { label: string; description: string }> = {
  WOUND_CARE: { label: "Wound care", description: "Wound visits and assessments, debridement, CTP, compression, offloading, NPWT, vascular and lower-extremity work." },
  PRIMARY_CARE: { label: "Primary care", description: "New, follow-up, sick and wellness visits, preventive care and chronic-condition follow-up." },
};

export const specialtyLabel = (key: string | null | undefined) => (key ? (SPECIALTIES[key]?.label ?? key) : "General");

export function parseSpecialties(value: string | null | undefined) {
  const list = (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s in SPECIALTIES);
  return list.length ? list : ["WOUND_CARE"];
}

// Prisma where-fragment: general rows plus rows tagged with a pack that is on.
export function specialtyWhere(enabled: string[]) {
  return { OR: [{ specialty: null }, { specialty: { in: enabled } }] };
}

// ---- Which standard content belongs to the wound-care pack. Everything else that ships is general. ----

export const WOUND_VISIT_TYPES = new Set(["INIT_WOUND", "EST_WOUND", "WOUND_CARE", "ACTIGRAFT", "ABI", "PROV_MIST", "NPWCN_MIST", "NON_PROVIDER", "SURVEILLANCE", "TELE_INIT", "TELE_EST", "HBO", "TCOM"]);

export const WOUND_TEMPLATE_KEYS = new Set([
  "wounds",
  "physician_orders",
  "treatment_notes",
  "ctp",
  "lower_extremity",
  "lymphedema",
  "npwt",
  "offloading",
  "pneumatic_compression",
  "braden",
  "plan_of_care",
  "debridement",
  "unna_boot",
  "wound_assessment_details",
  "treatment_goals",
  "wound_management_plan",
  "wound_product_supplier",
  "telehealth_plans",
  "hbo_pretreatment",
  "hbo_safety",
  "hbo_treatment",
  "tcom",
]);

export const WOUND_WORKFLOWS = new Set([
  "Wound Care Visit",
  "Non-Provider Treatment Visit",
  "Initial Wound Care",
  "Established Wound Care",
  "Surveillance Visit",
  "Provider Ultrasound Mist Therapy",
  "Actigraft Application",
  "Ankle Brachial Index Assessment",
  "Hyperbaric Oxygen Treatment",
  "Transcutaneous Oximetry (TCOM)",
]);

export const WOUND_RULE_KEYS = new Set(["braden", "nutrition", "vascular_abi"]);

// ---- Primary-care pack ----

export const PCP_VISIT_TYPES = new Set(["AWV", "PHYSICAL", "CHRONIC", "WELL_CHILD"]);

export const PCP_TEMPLATE_KEYS = new Set(["phq9", "gad7", "audit_c", "awv_hra", "preventive_care", "diabetes_flowsheet", "hypertension_flowsheet", "asthma_control", "well_child"]);

export const PCP_WORKFLOWS = new Set(["Primary Care Visit", "Annual Wellness Visit", "Well-Child Visit"]);

export const PCP_RULE_KEYS = new Set([
  "pc_awv",
  "pc_depression",
  "pc_alcohol",
  "pc_lipids",
  "pc_dm_screen",
  "pc_colorectal",
  "pc_breast",
  "pc_cervical",
  "pc_osteoporosis",
  "pc_aaa",
  "pc_hiv",
  "pc_hepc",
  "pc_flu_all",
  "pc_pneumo",
  "pc_zoster",
  "pc_htn_bp",
  "pc_dm_a1c",
  "pc_dm_kidney",
  "pc_dm_lipids",
  "pc_ckd_egfr",
]);

export const PCP_ORDER_CODES = new Set([
  "3016-3", // TSH
  "14959-1", // urine microalbumin/creatinine
  "2160-0", // creatinine / eGFR
  "2857-1", // PSA
  "19762-4", // Pap
  "75622-1", // HIV Ag/Ab
  "13955-0", // hepatitis C antibody
  "29771-3", // FIT
  "24356-8", // urinalysis
  "2132-9", // vitamin B12
  "2345-7", // glucose
  "2951-2", // sodium / BMP
  "77067",
  "77080",
  "71046",
  "71271",
  "76706",
  "93000",
]);

export const WOUND_ORDER_CODES = new Set([
  "1751-7", // albumin
  "14338-8", // prealbumin
  "1988-5", // CRP
  "4537-7", // ESR
  "6462-6", // wound culture aerobic
  "635-3", // wound culture anaerobic
  "22634-0", // tissue biopsy
  "2276-4", // ferritin
  "5763-8", // zinc
  "73630",
  "73610",
  "73590",
  "73718",
  "73720",
  "73700",
  "78315",
  "93922",
  "93925",
  "93970",
]);

// The pack a piece of standard content belongs to, by its key/code/name; null = general.
export function packOf(kind: "visitType" | "template" | "workflow" | "rule" | "order", key: string): string | null {
  const wound = { visitType: WOUND_VISIT_TYPES, template: WOUND_TEMPLATE_KEYS, workflow: WOUND_WORKFLOWS, rule: WOUND_RULE_KEYS, order: WOUND_ORDER_CODES }[kind];
  const pcp = { visitType: PCP_VISIT_TYPES, template: PCP_TEMPLATE_KEYS, workflow: PCP_WORKFLOWS, rule: PCP_RULE_KEYS, order: PCP_ORDER_CODES }[kind];
  return wound.has(key) ? "WOUND_CARE" : pcp.has(key) ? "PRIMARY_CARE" : null;
}
