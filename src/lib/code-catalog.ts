// Built-in code catalog for the superbill quick reference. ICD-10-CM wound families are generated
// from their site / stage / severity patterns so every code follows the official structure;
// practices add their own codes and fees on top (PracticeCode).

export type CatalogCode = { code: string; description: string; category: string };

const SIDE = { R: "right", L: "left" } as const;

// ---- Pressure injuries (L89) ----
const PRESSURE_STAGES: [string, string][] = [
  ["0", "unstageable"],
  ["1", "stage 1"],
  ["2", "stage 2"],
  ["3", "stage 3"],
  ["4", "stage 4"],
  ["6", "pressure-induced deep tissue damage"],
  ["9", "unspecified stage"],
];
const PRESSURE_SITES: [string, string][] = [
  ["L89.01", "right elbow"],
  ["L89.02", "left elbow"],
  ["L89.11", "right upper back"],
  ["L89.12", "left upper back"],
  ["L89.13", "right lower back"],
  ["L89.14", "left lower back"],
  ["L89.15", "sacral region"],
  ["L89.21", "right hip"],
  ["L89.22", "left hip"],
  ["L89.31", "right buttock"],
  ["L89.32", "left buttock"],
  ["L89.51", "right ankle"],
  ["L89.52", "left ankle"],
  ["L89.61", "right heel"],
  ["L89.62", "left heel"],
  ["L89.81", "head"],
  ["L89.89", "other site"],
];

// ---- Non-pressure chronic ulcers (L97 lower limb, L98.4 other sites) ----
const ULCER_SEVERITY: [string, string][] = [
  ["1", "limited to breakdown of skin"],
  ["2", "with fat layer exposed"],
  ["3", "with necrosis of muscle"],
  ["4", "with necrosis of bone"],
  ["5", "with muscle involvement without evidence of necrosis"],
  ["6", "with bone involvement without evidence of necrosis"],
  ["8", "with other specified severity"],
  ["9", "with unspecified severity"],
];
const LOWER_LIMB_SITES: [string, string][] = [
  ["L97.11", "right thigh"],
  ["L97.12", "left thigh"],
  ["L97.21", "right calf"],
  ["L97.22", "left calf"],
  ["L97.31", "right ankle"],
  ["L97.32", "left ankle"],
  ["L97.41", "right heel and midfoot"],
  ["L97.42", "left heel and midfoot"],
  ["L97.51", "other part of right foot"],
  ["L97.52", "other part of left foot"],
  ["L97.81", "other part of right lower leg"],
  ["L97.82", "other part of left lower leg"],
];
const OTHER_ULCER_SITES: [string, string][] = [
  ["L98.41", "buttock"],
  ["L98.42", "back"],
  ["L98.49", "skin of other sites"],
];

// ---- Varicose veins with ulcer (I83.0) and arterial disease with ulceration (I70.2) ----
const VENOUS_SITES: [string, string][] = [
  ["1", "thigh"],
  ["2", "calf"],
  ["3", "ankle"],
  ["4", "heel and midfoot"],
  ["5", "other part of foot"],
  ["8", "other part of lower leg"],
  ["9", "unspecified site"],
];
const ARTERIAL_SITES: [string, string][] = [
  ["1", "thigh"],
  ["2", "calf"],
  ["3", "ankle"],
  ["4", "heel and midfoot"],
  ["5", "other part of foot"],
  ["8", "other part of lower leg"],
];

function generated(): CatalogCode[] {
  const out: CatalogCode[] = [];
  for (const [prefix, site] of PRESSURE_SITES) {
    for (const [s, stage] of PRESSURE_STAGES) {
      out.push({ code: `${prefix}${s}`, description: `Pressure ulcer of ${site}, ${stage}`, category: "Pressure injury (L89)" });
    }
  }
  for (const [prefix, site] of LOWER_LIMB_SITES) {
    for (const [s, sev] of ULCER_SEVERITY) {
      out.push({ code: `${prefix}${s}`, description: `Non-pressure chronic ulcer of ${site} ${sev}`, category: "Non-pressure chronic ulcer, lower limb (L97)" });
    }
  }
  for (const [prefix, site] of OTHER_ULCER_SITES) {
    for (const [s, sev] of ULCER_SEVERITY) {
      out.push({ code: `${prefix}${s}`, description: `Non-pressure chronic ulcer of ${site} ${sev}`, category: "Non-pressure chronic ulcer, other sites (L98.4)" });
    }
  }
  for (const [legDigit, leg] of [
    ["1", SIDE.R],
    ["2", SIDE.L],
  ] as const) {
    for (const [s, site] of VENOUS_SITES) {
      out.push({
        code: `I83.0${legDigit}${s}`,
        description: `Varicose veins of ${leg} lower extremity with ulcer ${site === "unspecified site" ? "of unspecified site" : `of ${site}`}`,
        category: "Venous ulcer (I83 / I87)",
      });
    }
  }
  for (const [legDigit, leg] of [
    ["3", SIDE.R],
    ["4", SIDE.L],
  ] as const) {
    for (const [s, site] of ARTERIAL_SITES) {
      out.push({
        code: `I70.2${legDigit}${s}`,
        description: `Atherosclerosis of native arteries of ${leg} leg with ulceration of ${site}`,
        category: "Arterial ulcer (I70)",
      });
    }
  }
  return out;
}

const LISTED: CatalogCode[] = [
  // Diabetic
  { code: "E11.621", description: "Type 2 diabetes mellitus with foot ulcer", category: "Diabetic (E10/E11)" },
  { code: "E11.622", description: "Type 2 diabetes mellitus with other skin ulcer", category: "Diabetic (E10/E11)" },
  { code: "E11.51", description: "Type 2 diabetes mellitus with diabetic peripheral angiopathy without gangrene", category: "Diabetic (E10/E11)" },
  { code: "E11.52", description: "Type 2 diabetes mellitus with diabetic peripheral angiopathy with gangrene", category: "Diabetic (E10/E11)" },
  { code: "E11.40", description: "Type 2 diabetes mellitus with diabetic neuropathy, unspecified", category: "Diabetic (E10/E11)" },
  { code: "E11.42", description: "Type 2 diabetes mellitus with diabetic polyneuropathy", category: "Diabetic (E10/E11)" },
  { code: "E11.65", description: "Type 2 diabetes mellitus with hyperglycemia", category: "Diabetic (E10/E11)" },
  { code: "E11.9", description: "Type 2 diabetes mellitus without complications", category: "Diabetic (E10/E11)" },
  { code: "E10.621", description: "Type 1 diabetes mellitus with foot ulcer", category: "Diabetic (E10/E11)" },
  { code: "E10.622", description: "Type 1 diabetes mellitus with other skin ulcer", category: "Diabetic (E10/E11)" },
  { code: "Z79.4", description: "Long term (current) use of insulin", category: "Diabetic (E10/E11)" },
  // Venous / vascular
  { code: "I87.2", description: "Venous insufficiency (chronic) (peripheral)", category: "Venous ulcer (I83 / I87)" },
  { code: "I87.311", description: "Chronic venous hypertension (idiopathic) with ulcer of right lower extremity", category: "Venous ulcer (I83 / I87)" },
  { code: "I87.312", description: "Chronic venous hypertension (idiopathic) with ulcer of left lower extremity", category: "Venous ulcer (I83 / I87)" },
  { code: "I87.313", description: "Chronic venous hypertension (idiopathic) with ulcer of bilateral lower extremity", category: "Venous ulcer (I83 / I87)" },
  { code: "I89.0", description: "Lymphedema, not elsewhere classified", category: "Venous ulcer (I83 / I87)" },
  { code: "I73.9", description: "Peripheral vascular disease, unspecified", category: "Arterial ulcer (I70)" },
  { code: "I70.261", description: "Atherosclerosis of native arteries of extremities with gangrene, right leg", category: "Arterial ulcer (I70)" },
  { code: "I70.262", description: "Atherosclerosis of native arteries of extremities with gangrene, left leg", category: "Arterial ulcer (I70)" },
  { code: "I96", description: "Gangrene, not elsewhere classified", category: "Arterial ulcer (I70)" },
  // Osteomyelitis / infection
  { code: "M86.171", description: "Other acute osteomyelitis, right ankle and foot", category: "Osteomyelitis & infection" },
  { code: "M86.172", description: "Other acute osteomyelitis, left ankle and foot", category: "Osteomyelitis & infection" },
  { code: "M86.671", description: "Other chronic osteomyelitis, right ankle and foot", category: "Osteomyelitis & infection" },
  { code: "M86.672", description: "Other chronic osteomyelitis, left ankle and foot", category: "Osteomyelitis & infection" },
  { code: "M86.9", description: "Osteomyelitis, unspecified", category: "Osteomyelitis & infection" },
  { code: "L03.115", description: "Cellulitis of right lower limb", category: "Osteomyelitis & infection" },
  { code: "L03.116", description: "Cellulitis of left lower limb", category: "Osteomyelitis & infection" },
  { code: "L03.90", description: "Cellulitis, unspecified", category: "Osteomyelitis & infection" },
  { code: "L08.9", description: "Local infection of the skin and subcutaneous tissue, unspecified", category: "Osteomyelitis & infection" },
  // Surgical / aftercare
  { code: "T81.31XA", description: "Disruption of external operation (surgical) wound, NEC, initial encounter", category: "Surgical wound & aftercare" },
  { code: "T81.41XA", description: "Infection following a procedure, superficial incisional surgical site, initial encounter", category: "Surgical wound & aftercare" },
  { code: "T81.42XA", description: "Infection following a procedure, deep incisional surgical site, initial encounter", category: "Surgical wound & aftercare" },
  { code: "T81.49XA", description: "Infection following a procedure, other surgical site, initial encounter", category: "Surgical wound & aftercare" },
  { code: "Z48.00", description: "Encounter for change or removal of nonsurgical wound dressing", category: "Surgical wound & aftercare" },
  { code: "Z48.01", description: "Encounter for change or removal of surgical wound dressing", category: "Surgical wound & aftercare" },
  { code: "Z48.817", description: "Encounter for surgical aftercare following surgery on the skin and subcutaneous tissue", category: "Surgical wound & aftercare" },
  // Co-morbidities
  { code: "E66.01", description: "Morbid (severe) obesity due to excess calories", category: "Co-morbidities" },
  { code: "E66.9", description: "Obesity, unspecified", category: "Co-morbidities" },
  { code: "Z68.41", description: "Body mass index [BMI] 40.0-44.9, adult", category: "Co-morbidities" },
  { code: "E43", description: "Unspecified severe protein-calorie malnutrition", category: "Co-morbidities" },
  { code: "E44.0", description: "Moderate protein-calorie malnutrition", category: "Co-morbidities" },
  { code: "I10", description: "Essential (primary) hypertension", category: "Co-morbidities" },
  { code: "N18.6", description: "End stage renal disease", category: "Co-morbidities" },
  { code: "F17.210", description: "Nicotine dependence, cigarettes, uncomplicated", category: "Co-morbidities" },
  { code: "Z87.891", description: "Personal history of nicotine dependence", category: "Co-morbidities" },
  { code: "Z74.01", description: "Bed confinement status", category: "Co-morbidities" },
  { code: "Z99.3", description: "Dependence on wheelchair", category: "Co-morbidities" },
  { code: "R32", description: "Unspecified urinary incontinence", category: "Co-morbidities" },
  { code: "R15.9", description: "Full incontinence of feces", category: "Co-morbidities" },
  // Common primary care
  { code: "J45.909", description: "Unspecified asthma, uncomplicated", category: "Common primary care" },
  { code: "E78.5", description: "Hyperlipidemia, unspecified", category: "Common primary care" },
  { code: "J06.9", description: "Acute upper respiratory infection, unspecified", category: "Common primary care" },
  { code: "R05.9", description: "Cough, unspecified", category: "Common primary care" },
  { code: "Z00.00", description: "Encounter for general adult medical examination without abnormal findings", category: "Common primary care" },
  { code: "Z00.129", description: "Encounter for routine child health examination without abnormal findings", category: "Common primary care" },
];

export const ICD10_CATALOG: CatalogCode[] = [...LISTED, ...generated()];

export const ICD10_CATEGORIES = [...new Set(ICD10_CATALOG.map((c) => c.category))];

// CPT / HCPCS quick picks. Fees come from the practice's code list or superbill templates.
export const CPT_CATALOG: CatalogCode[] = [
  { code: "99202", description: "Office/outpatient visit, new patient, straightforward MDM", category: "E/M · office" },
  { code: "99203", description: "Office/outpatient visit, new patient, low MDM", category: "E/M · office" },
  { code: "99204", description: "Office/outpatient visit, new patient, moderate MDM", category: "E/M · office" },
  { code: "99205", description: "Office/outpatient visit, new patient, high MDM", category: "E/M · office" },
  { code: "99212", description: "Office/outpatient visit, established patient, straightforward MDM", category: "E/M · office" },
  { code: "99213", description: "Office/outpatient visit, established patient, low MDM", category: "E/M · office" },
  { code: "99214", description: "Office/outpatient visit, established patient, moderate MDM", category: "E/M · office" },
  { code: "99215", description: "Office/outpatient visit, established patient, high MDM", category: "E/M · office" },
  { code: "99304", description: "Initial nursing facility care, straightforward or low MDM", category: "E/M · facility & home" },
  { code: "99305", description: "Initial nursing facility care, moderate MDM", category: "E/M · facility & home" },
  { code: "99306", description: "Initial nursing facility care, high MDM", category: "E/M · facility & home" },
  { code: "99307", description: "Subsequent nursing facility care, straightforward MDM", category: "E/M · facility & home" },
  { code: "99308", description: "Subsequent nursing facility care, low MDM", category: "E/M · facility & home" },
  { code: "99309", description: "Subsequent nursing facility care, moderate MDM", category: "E/M · facility & home" },
  { code: "99310", description: "Subsequent nursing facility care, high MDM", category: "E/M · facility & home" },
  { code: "99347", description: "Home or residence visit, established patient, straightforward MDM", category: "E/M · facility & home" },
  { code: "99348", description: "Home or residence visit, established patient, low MDM", category: "E/M · facility & home" },
  { code: "99349", description: "Home or residence visit, established patient, moderate MDM", category: "E/M · facility & home" },
  { code: "99350", description: "Home or residence visit, established patient, high MDM", category: "E/M · facility & home" },
  { code: "97597", description: "Debridement, open wound, selective; first 20 sq cm or less", category: "Debridement" },
  { code: "97598", description: "Debridement, open wound, selective; each additional 20 sq cm", category: "Debridement" },
  { code: "97602", description: "Removal of devitalized tissue, non-selective debridement", category: "Debridement" },
  { code: "11042", description: "Debridement, subcutaneous tissue; first 20 sq cm or less", category: "Debridement" },
  { code: "11045", description: "Debridement, subcutaneous tissue; each additional 20 sq cm", category: "Debridement" },
  { code: "11043", description: "Debridement, muscle and/or fascia; first 20 sq cm or less", category: "Debridement" },
  { code: "11046", description: "Debridement, muscle and/or fascia; each additional 20 sq cm", category: "Debridement" },
  { code: "11044", description: "Debridement, bone; first 20 sq cm or less", category: "Debridement" },
  { code: "11047", description: "Debridement, bone; each additional 20 sq cm", category: "Debridement" },
  { code: "15271", description: "Skin substitute graft, trunk/arms/legs; first 25 sq cm or less", category: "Skin substitutes" },
  { code: "15272", description: "Skin substitute graft, trunk/arms/legs; each additional 25 sq cm", category: "Skin substitutes" },
  { code: "15275", description: "Skin substitute graft, face/scalp/hands/feet; first 25 sq cm or less", category: "Skin substitutes" },
  { code: "15276", description: "Skin substitute graft, face/scalp/hands/feet; each additional 25 sq cm", category: "Skin substitutes" },
  { code: "97605", description: "Negative pressure wound therapy (DME), total wound surface area 50 sq cm or less", category: "NPWT, compression & therapy" },
  { code: "97606", description: "Negative pressure wound therapy (DME), total wound surface area greater than 50 sq cm", category: "NPWT, compression & therapy" },
  { code: "97607", description: "Negative pressure wound therapy (disposable), 50 sq cm or less", category: "NPWT, compression & therapy" },
  { code: "97608", description: "Negative pressure wound therapy (disposable), greater than 50 sq cm", category: "NPWT, compression & therapy" },
  { code: "97610", description: "Low frequency, non-contact, non-thermal ultrasound (MIST), per day", category: "NPWT, compression & therapy" },
  { code: "29580", description: "Strapping; Unna boot", category: "NPWT, compression & therapy" },
  { code: "29581", description: "Application of multi-layer compression system; leg (below knee)", category: "NPWT, compression & therapy" },
  { code: "11055", description: "Paring or cutting of benign hyperkeratotic lesion; single lesion", category: "Minor procedures" },
  { code: "11720", description: "Debridement of nail(s) by any method; 1 to 5", category: "Minor procedures" },
  { code: "10060", description: "Incision and drainage of abscess; simple or single", category: "Minor procedures" },
  { code: "11102", description: "Tangential biopsy of skin; single lesion", category: "Minor procedures" },
  { code: "99490", description: "Chronic care management, first 20 minutes of clinical staff time per month", category: "Care management" },
  { code: "99439", description: "Chronic care management, each additional 20 minutes", category: "Care management" },
  { code: "99424", description: "Principal care management, first 30 minutes by physician/QHP per month", category: "Care management" },
  { code: "99495", description: "Transitional care management, moderate complexity, contact within 2 business days", category: "Care management" },
];

export const CPT_CATEGORIES = [...new Set(CPT_CATALOG.map((c) => c.category))];

export function searchCatalog(list: CatalogCode[], q: string) {
  const needle = q.trim().toLowerCase();
  if (!needle) return list;
  const words = needle.split(/\s+/);
  return list.filter((c) => {
    const hay = `${c.code} ${c.description}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
