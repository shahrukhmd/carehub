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
  careitems: "Statements, each with a comment, status and date",
  wounds: "The patient's wounds (tick which apply)",
  score: "Score total (calculated)",
  // Patient Connect (patient-facing forms)
  consent: "Consent (patient agrees to the help text)",
  signature: "Signature (patient types their name)",
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
export const INPUT_TYPES: FieldType[] = ["text", "textarea", "number", "date", "yesno", "select", "radio", "checkboxes", "checkbox", "careitems", "wounds", "consent", "signature"];

// Plan-of-care statements: each ticked statement carries a status, the date of that status and a comment.
export const CARE_ITEM_STATUSES = ["Initiated", "Continued", "Completed", "Discontinued"];
const CARE_SEP = "\u001f";

export type CareItem = { statement: string; status: string; date: string; comment: string };

export function parseCareItems(value: string | string[] | undefined): CareItem[] {
  return ([] as string[]).concat(value ?? []).map((v) => {
    const [statement, status = "", date = "", comment = ""] = v.split(CARE_SEP);
    return { statement, status, date, comment };
  });
}

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
    } else if (f.type === "careitems") {
      // Inputs per statement i: f_<id>__on_<i>, __s_<i> (status), __d_<i> (date), __c_<i> (comment).
      const today = new Date().toISOString().slice(0, 10);
      const picked = (f.options ?? []).flatMap((o, i) => {
        if (!fd.get(`${key}__on_${i}`)) return [];
        const status = String(fd.get(`${key}__s_${i}`) ?? "");
        const date = String(fd.get(`${key}__d_${i}`) ?? "");
        const comment = String(fd.get(`${key}__c_${i}`) ?? "").trim().replaceAll(CARE_SEP, " ").slice(0, 2000);
        const st = CARE_ITEM_STATUSES.includes(status) ? status : "";
        // A status with no date takes today's.
        const dt = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : st ? today : "";
        return [[optionLabel(o), st, dt, comment].join(CARE_SEP)];
      });
      if (picked.length) values[f.id] = picked;
    } else if (f.type === "wounds") {
      const picked = [...new Set(fd.getAll(key).map((v) => String(v).trim().slice(0, 160)).filter(Boolean))].slice(0, 40);
      if (picked.length) values[f.id] = picked;
    } else if (f.type === "checkbox") {
      if (fd.get(key)) values[f.id] = "Yes";
    } else if (f.type === "consent") {
      if (fd.get(key)) values[f.id] = `Agreed ${new Date().toISOString()}`;
    } else if (f.type === "signature") {
      const v = String(fd.get(key) ?? "").trim();
      // A drawn signature from before typed signatures is kept as it is; otherwise the typed name is the signature.
      if (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 400_000) values[f.id] = v;
      else if (typedSignature(v)) values[f.id] = v;
      else if (/\p{L}/u.test(v) && v.length >= 2) values[f.id] = `${TYPED_SIGNATURE}${new Date().toISOString()}|${v.replace(/\s+/g, " ").slice(0, 120)}`;
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

// A typed signature is stored as "typed:<ISO time>|<name>": the name the signer typed and when they signed.
const TYPED_SIGNATURE = "typed:";

export function typedSignature(value: string | string[] | undefined | null) {
  if (typeof value !== "string" || !value.startsWith(TYPED_SIGNATURE)) return null;
  const bar = value.indexOf("|");
  const at = new Date(value.slice(TYPED_SIGNATURE.length, bar));
  const name = value.slice(bar + 1).trim();
  return bar > 0 && name && !Number.isNaN(at.getTime()) ? { name, at } : null;
}

// Patient forms can name the clinic the form is signed for: "{clinic}" in a label or help text.
export function withClinic(fields: FieldDef[], clinic: string): FieldDef[] {
  return fields.map((f) => ({ ...f, label: f.label.replaceAll("{clinic}", clinic), help: f.help?.replaceAll("{clinic}", clinic) }));
}

export function displayValue(field: FieldDef, value: string | string[] | undefined) {
  if (!hasValue(value)) return "";
  if (field.type === "careitems") {
    return parseCareItems(value)
      .map((c) => {
        const when = c.date ? c.date.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$2/$3/$1") : "";
        const state = [c.status, when].filter(Boolean).join(" ");
        return `• ${c.statement}${state ? ` [${state}]` : ""}${c.comment ? ` — ${c.comment}` : ""}`;
      })
      .join("\n");
  }
  if (Array.isArray(value)) return value.join(", ");
  if (field.type === "signature") {
    const typed = typedSignature(value);
    return typed ? `Signed electronically by ${typed.name} (${typed.at.toLocaleString()})` : "Signed";
  }
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
