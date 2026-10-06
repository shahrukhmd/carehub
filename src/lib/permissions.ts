// The permission map: every kind of work in CareHub, and which roles may do it by default. Pages, actions and the
// side menu read from here, so a role is granted or refused in one place. (No server imports — the menu and
// settings screens use it too.)
//
// Roles: ADMIN, FRONT_DESK, CLINICIAN, BILLER, CREDENTIALING, INTAKE (Gateway data entry), VERIFICATION (Gateway
// eligibility / VOB), SCHEDULER (Gateway scheduling), CDS (documentation review), CODER.

export const ROLES = ["ADMIN", "FRONT_DESK", "CLINICIAN", "BILLER", "CREDENTIALING", "INTAKE", "VERIFICATION", "SCHEDULER", "CDS", "CODER"] as const;
export type Role = (typeof ROLES)[number];

const ALL = [...ROLES];
const FRONT = ["ADMIN", "FRONT_DESK", "INTAKE", "VERIFICATION", "SCHEDULER"];

export type Permission = { label: string; group: string; roles: string[]; about?: string };

export const PERMISSIONS = {
  // ---- Patients
  "patients.view": { label: "Open a patient chart and search patients", group: "Patients", roles: ALL.filter((r) => r !== "CREDENTIALING") },
  "patients.edit": { label: "Register and edit patient demographics", group: "Patients", roles: ["ADMIN", "FRONT_DESK", "INTAKE", "VERIFICATION"] },
  "patients.letters": { label: "Letters and labels", group: "Patients", roles: ["ADMIN", "FRONT_DESK", "CLINICIAN", "BILLER", "INTAKE", "SCHEDULER"] },
  "patients.scans": { label: "View and add scanned documents", group: "Patients", roles: [...FRONT, "CLINICIAN", "BILLER"] },
  "patients.scans.delete": { label: "Remove a scanned document", group: "Patients", roles: ["ADMIN", "FRONT_DESK", "INTAKE", "CLINICIAN"] },
  "patients.thread": { label: "Team communication on a patient", group: "Patients", roles: ALL },
  "records.exchange": { label: "Care summaries (C-CDA) in and out", group: "Patients", roles: ["ADMIN", "CLINICIAN", "FRONT_DESK", "INTAKE", "CDS", "CODER", "BILLER"] },
  // ---- Gateway
  "gateway.work": { label: "Patient Gateway (intake, verification, scheduling cases)", group: "Front office", roles: [...FRONT, "CLINICIAN"] },
  "connect.work": { label: "Patient Connect (forms, reminders, surveys)", group: "Front office", roles: [...FRONT, "CLINICIAN"] },
  "fax.work": { label: "Faxing", group: "Front office", roles: [...FRONT, "CLINICIAN"] },
  "eligibility.run": { label: "Run eligibility checks and the nightly batch", group: "Front office", roles: ["ADMIN", "FRONT_DESK", "SCHEDULER", "VERIFICATION", "BILLER", "INTAKE"] },
  "schedule.view": { label: "Scheduler calendar and booking", group: "Front office", roles: ["ADMIN", "FRONT_DESK", "CLINICIAN", "SCHEDULER"] },
  "schedule.reserve": { label: "Reserved time on the calendar", group: "Front office", roles: ["ADMIN", "FRONT_DESK", "CLINICIAN", "SCHEDULER"] },
  "flow.work": { label: "Patient flow board (check-in, rooming)", group: "Front office", roles: ["ADMIN", "FRONT_DESK", "CLINICIAN", "SCHEDULER", "INTAKE"] },
  "recalls.work": { label: "Recalls", group: "Front office", roles: ["ADMIN", "FRONT_DESK", "SCHEDULER", "CLINICIAN", "INTAKE"] },
  "checkout.work": { label: "Checkout, copays and receipts", group: "Front office", roles: ["ADMIN", "FRONT_DESK", "BILLER", "SCHEDULER"] },
  "tasks.work": { label: "Tasks & messages", group: "Front office", roles: ALL },
  // ---- Clinical
  "chart.view": { label: "Open a visit chart", group: "Clinical", roles: ["ADMIN", "CLINICIAN", "CDS", "CODER", "BILLER", "FRONT_DESK"] },
  "chart.worklist": { label: "Visit worklist", group: "Clinical", roles: ["ADMIN", "CLINICIAN", "CDS", "CODER", "BILLER", "FRONT_DESK", "SCHEDULER"] },
  "chart.start": { label: "Start a visit chart", group: "Clinical", roles: ["ADMIN", "FRONT_DESK", "CLINICIAN"] },
  "chart.edit": { label: "Document a visit (clinical content)", group: "Clinical", roles: ["ADMIN", "CLINICIAN"], about: "Also limited by the visit's status" },
  "chart.cds": { label: "CDS review of a visit", group: "Clinical", roles: ["ADMIN", "CDS"] },
  "chart.code": { label: "Code a visit (superbill)", group: "Clinical", roles: ["ADMIN", "CODER"] },
  "chart.ai": { label: "AI drafting in the chart (plan of care)", group: "Clinical", roles: ["ADMIN", "CLINICIAN"] },
  "orders.manage": { label: "Lab & imaging orders", group: "Clinical", roles: ["ADMIN", "CLINICIAN", "FRONT_DESK", "INTAKE"] },
  "orders.write": { label: "Sign orders", group: "Clinical", roles: ["ADMIN", "CLINICIAN"] },
  "results.enter": { label: "Enter or import results", group: "Clinical", roles: ["ADMIN", "CLINICIAN"] },
  "referrals.work": { label: "Outgoing referrals", group: "Clinical", roles: ["ADMIN", "CLINICIAN", "FRONT_DESK", "INTAKE", "SCHEDULER"] },
  "rx.write": { label: "Write and sign prescriptions", group: "Clinical", roles: ["ADMIN", "CLINICIAN"] },
  "rx.view": { label: "See prescriptions", group: "Clinical", roles: ["ADMIN", "CLINICIAN", "FRONT_DESK", "CDS", "CODER", "INTAKE"] },
  "rx.print": { label: "Print or fax a prescription", group: "Clinical", roles: ["ADMIN", "CLINICIAN", "FRONT_DESK", "INTAKE"] },
  "immunizations.record": { label: "Record immunizations", group: "Clinical", roles: ["ADMIN", "CLINICIAN", "FRONT_DESK", "INTAKE"] },
  "immunizations.delete": { label: "Remove an immunization record", group: "Clinical", roles: ["ADMIN", "CLINICIAN"] },
  "caregaps.view": { label: "Care gaps and clinical reminders", group: "Clinical", roles: ["ADMIN", "CLINICIAN", "FRONT_DESK", "INTAKE", "CDS", "SCHEDULER"] },
  "careplan.edit": { label: "Care plan, goals and care team", group: "Clinical", roles: ["ADMIN", "CLINICIAN", "CDS"] },
  "reports.clinical": { label: "Patient registry and quality measures", group: "Clinical", roles: ["ADMIN", "CLINICIAN", "CDS", "CODER", "FRONT_DESK"] },
  // ---- Revenue
  "billing.work": { label: "Revenue cycle: claims, pre-release queue, ERA, denials, statements", group: "Revenue", roles: ["ADMIN", "BILLER"] },
  "billing.templates": { label: "Superbill templates", group: "Revenue", roles: ["ADMIN", "CLINICIAN", "BILLER", "CODER"] },
  "codes.library": { label: "Code library and charge schedules (view)", group: "Revenue", roles: ["ADMIN", "BILLER", "CDS", "CODER"] },
  "payments.take": { label: "Take patient payments", group: "Revenue", roles: ["ADMIN", "BILLER", "FRONT_DESK"] },
  "reports.ops": { label: "Operational reports", group: "Revenue", roles: ["ADMIN", "FRONT_DESK", "BILLER", "SCHEDULER"] },
  "credentialing.work": { label: "Credentialing", group: "Revenue", roles: ["ADMIN", "CREDENTIALING"] },
  // ---- Setup
  "settings.admin": { label: "Practice setup (every admin screen)", group: "Setup", roles: ["ADMIN"] },
  "settings.insurance": { label: "Add and edit insurance plans", group: "Setup", roles: ["ADMIN", "FRONT_DESK", "BILLER", "CREDENTIALING"] },
  "settings.providers": { label: "Add and edit providers", group: "Setup", roles: ["ADMIN", "CREDENTIALING", "FRONT_DESK"] },
} as const satisfies Record<string, Permission>;

export type PermissionKey = keyof typeof PERMISSIONS;

export const PERMISSION_GROUPS = ["Patients", "Front office", "Clinical", "Revenue", "Setup"];

export function rolesFor(key: PermissionKey): string[] {
  return [...PERMISSIONS[key].roles];
}

export function can(role: string | null | undefined, key: PermissionKey) {
  return Boolean(role && (PERMISSIONS[key].roles as readonly string[]).includes(role));
}
