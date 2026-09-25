export const patientStatusLabel: Record<string, string> = {
  NEW: "New",
  ESTABLISHED: "Established",
};

export const mdmLevelLabel: Record<string, string> = {
  STRAIGHTFORWARD: "Straightforward",
  LOW: "Low complexity",
  MODERATE: "Moderate complexity",
  HIGH: "High complexity",
};

// CMS-1500 box 21 supports up to 12 diagnosis codes (A-L), referenced by
// box 24E as diagnosis pointers.
const POINTER_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

export function diagnosisPointerLetter(index: number) {
  return POINTER_LETTERS[index] ?? String(index + 1);
}

export function parsePointerIds(value: string | null) {
  if (!value) return [];
  return value.split(",").filter(Boolean);
}

// Common CMS Place of Service codes (box 24B).
export const placeOfServiceLabel: Record<string, string> = {
  "11": "11 - Office",
  "02": "02 - Telehealth (patient home)",
  "10": "10 - Telehealth (other)",
  "12": "12 - Home",
  "21": "21 - Inpatient hospital",
  "22": "22 - Outpatient hospital",
  "23": "23 - Emergency room",
  "31": "31 - Skilled nursing facility",
  "32": "32 - Nursing facility",
  "81": "81 - Independent laboratory",
};
