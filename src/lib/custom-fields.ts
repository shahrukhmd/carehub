// Custom patient fields: extra questions a practice adds to the registration form (Settings → Custom patient fields).
// The answers are stored on the patient as JSON keyed by the field's key.

export const customFieldTypeLabel: Record<string, string> = {
  TEXT: "Text",
  NUMBER: "Number",
  DATE: "Date",
  CHECKBOX: "Yes / no checkbox",
  SELECT: "Dropdown list",
};

export type CustomFieldDef = { id: string; key: string; label: string; type: string; options: string | null; helpText: string | null; required: boolean };

export const customOptions = (options: string | null | undefined) =>
  (options ?? "")
    .split(/\r?\n/)
    .map((o) => o.trim())
    .filter(Boolean);

// "Preferred pharmacy chain" -> "preferred_pharmacy_chain"
export const customFieldKey = (label: string) =>
  label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

export function parseCustomValues(value: string | null | undefined): Record<string, string> {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// How a stored value reads on screen and in exports.
export function showCustomValue(field: { type: string }, value: string | undefined) {
  if (!value) return "";
  if (field.type === "CHECKBOX") return value === "true" ? "Yes" : "";
  if (field.type === "DATE" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${m}/${d}/${y}`;
  }
  return value;
}
