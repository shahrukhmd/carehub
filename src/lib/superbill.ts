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

const POINTER_LETTERS = ["A", "B", "C", "D", "E", "F"];

export function diagnosisPointerLetter(index: number) {
  return POINTER_LETTERS[index] ?? String(index + 1);
}

export function parsePointerIds(value: string | null) {
  if (!value) return [];
  return value.split(",").filter(Boolean);
}
