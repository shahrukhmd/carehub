// Designable chart forms: field definitions, value collection, scoring, and workflow evaluation.
// Shared by the chart, the template designer and print views (no server-only imports).

export const FIELD_TYPES = {
  heading: "Section heading",
  note: "Instructions (read-only text)",
  text: "Short text",
  textarea: "Long text",
  number: "Number",
  date: "Date",
  yesno: "Yes / No",
  select: "Dropdown (one choice)",
  radio: "Buttons (one choice)",
  checkboxes: "Checkboxes (several choices)",
  checkbox: "Single checkbox",
  score: "Score total (calculated)",
  // Patient Connect (patient-facing forms)
  consent: "Consent (patient agrees to the help text)",
  signature: "Signature (drawn by the patient)",
  file: "Photo / file upload (patient)",
} as const;

export type FieldType = keyof typeof FIELD_TYPES;

export type FieldDef = {
  id: string;
  label: string;
  type: FieldType;
  // For choice fields "Label" or "Label|score"; for score fields "max|interpretation" bands.
  options?: string[];
  required?: boolean;
  help?: string;
  unit?: string;
  width?: "full" | "half";
  // Patient forms: chart field this answer fills (a patient-docs field key, or "consent.<name>").
  map?: string;
};

export const CHOICE_TYPES: FieldType[] = ["select", "radio", "checkboxes"];
export const INPUT_TYPES: FieldType[] = ["text", "textarea", "number", "date", "yesno", "select", "radio", "checkboxes", "checkbox", "consent", "signature"];

export const DOCUMENT_SECTIONS = {
  DOCUMENTATION: "Documentation",
  PROCEDURE: "Procedure & treatment",
  PROGRESS: "Progress note",
  BILLING: "Billing",
  ADDITIONAL: "Additional documents",
} as const;

export type DocumentSection = keyof typeof DOCUMENT_SECTIONS;
export const WORKFLOW_SECTIONS: DocumentSection[] = ["DOCUMENTATION", "PROCEDURE", "PROGRESS", "BILLING"];

// Built-in chart sections that templates of kind BUILTIN render.
export const BUILTIN_SECTIONS: Record<string, { label: string; description: string }> = {
  cc: { label: "Chief Complaint / HPI", description: "Chief complaint and history of present illness" },
  vitals: { label: "Vital Signs", description: "Height, weight, temperature, pulse, respirations, BP, SpO2" },
  wounds: { label: "Active Wounds", description: "Wound assessments for each open wound (measurements, tissue, PUSH/BWAT)" },
  problems: { label: "Problem List", description: "The patient's active problems" },
  exam: { label: "Physical Exam", description: "Objective findings / physical exam" },
  assessment: { label: "Assessment & Plan of Care", description: "Assessment and plan" },
  meds: { label: "Medications, Orders & Labs", description: "Allergies, medications, prescriptions and lab orders" },
  multiwound: { label: "Multi Wound Chart", description: "All wounds side by side with this visit's measurements" },
  inactivewounds: { label: "Inactive Wounds", description: "Healed and inactive wounds" },
  progress: { label: "Progress Note", description: "Preview of the compiled progress note" },
  superbill: { label: "SuperBill", description: "Diagnosis (ICD-10) and procedure (CPT) coding" },
  signatures: { label: "Attestation & Signatures", description: "Provider and supervising physician signatures" },
};

export function slugId(label: string, taken: Set<string>) {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "field";
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}_${i}`;
  taken.add(id);
  return id;
}

export function parseFields(json: string | null | undefined): FieldDef[] {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? (v.filter((f) => f && typeof f.id === "string" && typeof f.label === "string" && f.type in FIELD_TYPES) as FieldDef[]) : [];
  } catch {
    return [];
  }
}

export type DocValues = Record<string, string | string[]>;

export function parseData(json: string | null | undefined): DocValues {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as DocValues) : {};
  } catch {
    return {};
  }
}

export function optionLabel(opt: string) {
  const i = opt.lastIndexOf("|");
  return i > 0 && /^-?\d+$/.test(opt.slice(i + 1).trim()) ? opt.slice(0, i).trim() : opt.trim();
}

export function optionScore(opt: string): number | null {
  const i = opt.lastIndexOf("|");
  if (i <= 0) return null;
  const n = opt.slice(i + 1).trim();
  return /^-?\d+$/.test(n) ? Number(n) : null;
}

export function isScored(fields: FieldDef[]) {
  return fields.some((f) => CHOICE_TYPES.includes(f.type) && (f.options ?? []).some((o) => optionScore(o) !== null));
}

export function computeScore(fields: FieldDef[], values: DocValues): number | null {
  if (!isScored(fields)) return null;
  let total = 0;
  for (const f of fields) {
    if (!CHOICE_TYPES.includes(f.type)) continue;
    const chosen = ([] as string[]).concat(values[f.id] ?? []);
    for (const c of chosen) {
      const opt = (f.options ?? []).find((o) => optionLabel(o) === c);
      total += (opt && optionScore(opt)) || 0;
    }
  }
  return total;
}

// Score bands are "max|interpretation", checked in order: "9|Very high risk", "12|High risk"...
export function scoreBand(field: FieldDef, score: number | null) {
  if (score === null) return null;
  for (const band of field.options ?? []) {
    const i = band.indexOf("|");
    if (i <= 0) continue;
    const max = Number(band.slice(0, i));
    if (Number.isFinite(max) && score <= max) return band.slice(i + 1).trim();
  }
  return null;
}

const hasValue = (v: string | string[] | undefined) => (Array.isArray(v) ? v.length > 0 : Boolean(v && v.trim()));

// Reads a submitted form (inputs are named f_<fieldId>) into stored values.
export function collectValues(fields: FieldDef[], fd: FormData) {
  const values: DocValues = {};
  for (const f of fields) {
    if (!INPUT_TYPES.includes(f.type)) continue;
    const key = `f_${f.id}`;
    if (f.type === "checkboxes") {
      const allowed = new Set((f.options ?? []).map(optionLabel));
      const picked = fd.getAll(key).map(String).filter((v) => allowed.has(v));
      if (picked.length) values[f.id] = picked;
    } else if (f.type === "checkbox") {
      if (fd.get(key)) values[f.id] = "Yes";
    } else if (f.type === "consent") {
      if (fd.get(key)) values[f.id] = `Agreed ${new Date().toISOString()}`;
    } else if (f.type === "signature") {
      const v = String(fd.get(key) ?? "");
      if (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 400_000) values[f.id] = v;
    } else {
      let v = String(fd.get(key) ?? "").trim().slice(0, 8000);
      if (f.type === "number" && v && !Number.isFinite(Number(v))) v = "";
      if (f.type === "date" && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) v = "";
      if ((f.type === "select" || f.type === "radio") && v && !(f.options ?? []).some((o) => optionLabel(o) === v)) v = "";
      if (f.type === "yesno" && v && !["Yes", "No"].includes(v)) v = "";
      if (v) values[f.id] = v;
    }
  }
  const missing = fields.filter((f) => f.required && INPUT_TYPES.includes(f.type) && !hasValue(values[f.id])).map((f) => f.label);
  const answered = fields.some((f) => hasValue(values[f.id]));
  return { values, missing, answered, score: computeScore(fields, values) };
}

export function displayValue(field: FieldDef, value: string | string[] | undefined) {
  if (!hasValue(value)) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (field.type === "signature") return "Signed";
  if (field.type === "consent") return `Agreed${value!.length > 7 ? ` (${new Date(value!.slice(7)).toLocaleString()})` : ""}`;
  if (field.type === "file") return "File uploaded";
  if (field.type === "date") {
    const [y, m, d] = value!.split("-");
    return `${m}/${d}/${y}`;
  }
  return field.unit ? `${value} ${field.unit}` : value!;
}

// ---- Workflow evaluation ----

export type StepInput = {
  key: string;
  name: string;
  perWound: boolean;
  kind: string;
  signatureRequired: boolean;
  critical: boolean;
  required: boolean;
};

export type DocState = { templateKey: string; woundKey: string; status: string; signedAt: Date | null };

export type StepStatus = {
  done: boolean;
  started: boolean;
  // Per-wound forms: which open wounds are done.
  woundsDone: Set<string>;
  needsSignature: boolean;
};

export function stepStatus(
  step: StepInput,
  docs: DocState[],
  builtinDone: Record<string, boolean>,
  openWoundIds: string[]
): StepStatus {
  if (step.kind === "BUILTIN") {
    const done = builtinDone[step.key] ?? true;
    return { done, started: done, woundsDone: new Set(), needsSignature: false };
  }
  const mine = docs.filter((d) => d.templateKey === step.key);
  const complete = (d: DocState) => d.status === "COMPLETE" && (!step.signatureRequired || Boolean(d.signedAt));
  if (step.perWound) {
    const woundsDone = new Set(mine.filter(complete).map((d) => d.woundKey));
    const done = openWoundIds.length > 0 && openWoundIds.every((w) => woundsDone.has(w));
    const needsSignature = step.signatureRequired && mine.some((d) => d.status === "COMPLETE" && !d.signedAt);
    return { done, started: mine.length > 0, woundsDone, needsSignature };
  }
  const doc = mine.find((d) => d.woundKey === "");
  return {
    done: Boolean(doc && complete(doc)),
    started: Boolean(doc),
    woundsDone: new Set(),
    needsSignature: Boolean(step.signatureRequired && doc?.status === "COMPLETE" && !doc.signedAt),
  };
}

// What blocks "Finalize visit": required or critical documents that aren't complete (and signed, if required).
export function finalizeGaps(steps: StepInput[], docs: DocState[], builtinDone: Record<string, boolean>, openWoundIds: string[]) {
  const gaps: string[] = [];
  for (const s of steps) {
    const st = stepStatus(s, docs, builtinDone, openWoundIds);
    if (st.needsSignature) gaps.push(`${s.name} (signature)`);
    else if ((s.required || s.critical) && !st.done && !(s.perWound && openWoundIds.length === 0)) gaps.push(s.name);
  }
  return gaps;
}
