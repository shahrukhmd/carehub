import { rolesFor } from "@/lib/permissions";
// Visit workflow after scheduling: the provider and clinical team document the visit, CDS reviews the
// documentation, the coding team builds the superbill (asking CDS when something needs correcting), the provider
// (and supervising physician) sign, then billing.

export const visitStatusLabel: Record<string, string> = {
  IN_PROGRESS: "Documentation in progress",
  READY_FOR_CDS: "Ready for CDS",
  CDS_QUERY: "Incomplete documentation HOLD (CDS)",
  READY_FOR_CODING: "Ready for coding",
  CODING_QUERY: "Coding query (with CDS)",
  READY_FOR_SIGNATURE: "Ready for signature",
  READY_FOR_BILLING: "Ready for billing",
  BILLED: "Billing completed",
  BILLING_HOLD: "Billing HOLD",
  HOLD_FOR_AUDIT: "Hold for audit",
  DO_NOT_BILL: "Do not bill",
};

export const HOLD_STATUSES = ["BILLING_HOLD", "HOLD_FOR_AUDIT", "DO_NOT_BILL"];
export const SIGNED_STATUSES = ["READY_FOR_BILLING", "BILLED"];

// Before an encounter is started the visit status comes from the appointment.
export const appointmentVisitStatusLabel: Record<string, string> = {
  SCHEDULED: "Scheduled",
  CONFIRMED: "Confirmed",
  CHECKED_IN: "Check-in",
  IN_ROOM: "In room",
  IN_HOSPITAL: "In hospital",
  NO_SHOW: "No show",
  CANCELLED: "Cancelled visit",
  COMPLETED: "Completed",
};

export type VisitTone = "ok" | "warn" | "bad" | "info" | "muted";

export function visitStatusTone(status: string): VisitTone {
  if (SIGNED_STATUSES.includes(status) || status === "COMPLETED") return "ok";
  if (["CDS_QUERY", "CODING_QUERY", "BILLING_HOLD", "HOLD_FOR_AUDIT", "NO_SHOW", "CANCELLED"].includes(status)) return "bad";
  if (["READY_FOR_CDS", "READY_FOR_CODING", "READY_FOR_SIGNATURE"].includes(status)) return "warn";
  if (status === "DO_NOT_BILL") return "muted";
  return "info";
}

// Who works each stage.
export const VISIT_VIEW_ROLES = rolesFor("chart.worklist");
export const ENCOUNTER_VIEW_ROLES = rolesFor("chart.view");
const CLINICAL_ROLES = ["ADMIN", "CLINICIAN"];
// CDS reviews the documentation; the coding team owns the superbill. They are separate teams.
export const CDS_ROLES = rolesFor("chart.cds");
export const CODING_ROLES = rolesFor("chart.code");
const HOLD_ROLES = ["ADMIN", "CDS", "CODER", "BILLER"];
// The stages with CDS: a first review, and a coding query to answer.
export const CDS_STAGES = ["READY_FOR_CDS", "CODING_QUERY"];

// The provider and clinical team own the chart until it goes to CDS, and again if CDS queries it.
export function canEditClinical(status: string, role: string) {
  return CLINICAL_ROLES.includes(role) && ["IN_PROGRESS", "CDS_QUERY"].includes(status);
}

// The superbill belongs to the coding team alone, and only while the chart is with them: after CDS has reviewed
// the documentation and before the provider signs.
export function canEditCoding(status: string, role: string) {
  return status === "READY_FOR_CODING" && CODING_ROLES.includes(role);
}

export function canHold(role: string) {
  return HOLD_ROLES.includes(role);
}

export function isCdsRole(role: string) {
  return CDS_ROLES.includes(role);
}

export function isCoderRole(role: string) {
  return CODING_ROLES.includes(role);
}

type ChartParts = {
  chiefComplaint: string | null;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  vitals: unknown | null;
  woundCount: number;
  woundAssessedCount: number;
  diagnosisCount: number;
  chargeCount: number;
  chargesMissingPointers: number;
  billingProviderId: string | null;
  mdmLevel: string | null;
  signatureCount: number;
  signaturesRequired: number;
};

export type ChecklistItem = { key: string; label: string; done: boolean; required: "provider" | "cds" | "sign" | null };

// The "document workflow" rail: what's been documented, and what each hand-off needs.
export function chartChecklist(c: ChartParts): ChecklistItem[] {
  return [
    { key: "cc", label: "Chief complaint / HPI", done: Boolean(c.chiefComplaint && c.subjective), required: "provider" },
    { key: "vitals", label: "Vital signs", done: Boolean(c.vitals), required: null },
    {
      key: "wounds",
      label: c.woundCount ? `Wound assessments (${c.woundAssessedCount}/${c.woundCount})` : "Wound assessments",
      done: c.woundCount === 0 || c.woundAssessedCount >= c.woundCount,
      required: null,
    },
    { key: "exam", label: "Objective / physical exam", done: Boolean(c.objective), required: "provider" },
    { key: "assessment", label: "Assessment & plan of care", done: Boolean(c.assessment && c.plan), required: "provider" },
    { key: "meds", label: "Medications & orders", done: true, required: null },
    { key: "dx", label: "Diagnosis coding (ICD-10)", done: c.diagnosisCount > 0, required: "cds" },
    {
      key: "superbill",
      label: "Superbill (CPT, E/M, pointers)",
      done: c.chargeCount > 0 && c.chargesMissingPointers === 0 && Boolean(c.billingProviderId),
      required: "cds",
    },
    {
      key: "signatures",
      label: `Attestation & signatures (${c.signatureCount}/${c.signaturesRequired})`,
      done: c.signatureCount >= c.signaturesRequired,
      required: "sign",
    },
  ];
}

export function gapsFor(checklist: ChecklistItem[], stage: "provider" | "cds") {
  return checklist.filter((i) => i.required === stage && !i.done).map((i) => i.label);
}

export const VISIT_STEPS = [
  { key: "SCHEDULED", label: "Scheduled", owner: "Scheduler" },
  { key: "IN_PROGRESS", label: "Documentation", owner: "Provider & clinical team" },
  { key: "READY_FOR_CDS", label: "CDS review & superbill", owner: "CDS" },
  { key: "READY_FOR_SIGNATURE", label: "Signatures", owner: "Provider" },
  { key: "READY_FOR_BILLING", label: "Billing", owner: "Billing" },
];

export function stepIndex(status: string) {
  if (status === "CDS_QUERY") return 1;
  if (status === "BILLED") return 5;
  const i = VISIT_STEPS.findIndex((s) => s.key === status);
  return i === -1 ? 4 : i;
}

export const PROVIDER_ATTESTATION =
  "I attest that I personally performed the services documented in this note, that the documentation, " +
  "diagnoses and plan of care reflect my medical decision-making, and that the superbill accurately reflects the services provided.";

export const SUPERVISOR_ATTESTATION =
  "I have personally reviewed and established the assessment and plan of care for this visit. The visit was " +
  "conducted under my supervision and I was immediately available to provide direct supervision throughout.";

// Whether each built-in chart section is complete (drives the document workflow rail and the finalize gate).
export function builtinDoneMap(checklist: ChecklistItem[], problemCount: number): Record<string, boolean> {
  const done = new Map(checklist.map((c) => [c.key, c.done]));
  return {
    cc: Boolean(done.get("cc")),
    vitals: Boolean(done.get("vitals")),
    wounds: Boolean(done.get("wounds")),
    exam: Boolean(done.get("exam")),
    assessment: Boolean(done.get("assessment")),
    meds: true,
    problems: problemCount > 0,
    multiwound: true,
    inactivewounds: true,
    progress: true,
    superbill: Boolean(done.get("dx") && done.get("superbill")),
    signatures: Boolean(done.get("signatures")),
  };
}
