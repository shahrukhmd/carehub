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
  "patients.edit": { label: "Register and edit patient demographics", group: "Patients", roles: ["ADMIN", "FRONT_DESK", "CLINICIAN", "INTAKE", "VERIFICATION"] },
  "patients.letters": { label: "Letters and labels", group: "Patients", roles: ["ADMIN", "FRONT_DESK", "CLINICIAN", "BILLER", "INTAKE", "SCHEDULER"] },
  "patients.scans": { label: "View and add scanned documents", group: "Patients", roles: [...FRONT, "CLINICIAN", "BILLER"] },
  "patients.scans.delete": { label: "Remove a scanned document", group: "Patients", roles: ["ADMIN", "FRONT_DESK", "INTAKE", "CLINICIAN"] },
  "patients.insurance": { label: "Edit patient insurance and authorizations", group: "Patients", roles: ["ADMIN", "FRONT_DESK", "INTAKE", "VERIFICATION", "BILLER"] },
  "patients.privacy": { label: "Privacy: consents, restrictions and the disclosure log", group: "Patients", roles: ["ADMIN", "FRONT_DESK", "INTAKE", "VERIFICATION", "CLINICIAN", "BILLER"] },
  "patients.privacy.decide": { label: "Decide restrictions and record requests", group: "Patients", roles: ["ADMIN", "CLINICIAN"] },
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
  "chart.sign": { label: "Sign visit documents and the visit", group: "Clinical", roles: ["ADMIN", "CLINICIAN"] },
  "chart.attach": { label: "Add files to a visit", group: "Clinical", roles: ["ADMIN", "CLINICIAN", "CDS", "CODER", "BILLER"] },
  "chart.hold": { label: "Place and release holds on a visit", group: "Clinical", roles: ["ADMIN", "CDS", "CODER", "BILLER"] },
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
  "immunizations.stock": { label: "Vaccine inventory", group: "Clinical", roles: ["ADMIN", "CLINICIAN"] },
  "caregaps.view": { label: "Care gaps and clinical reminders", group: "Clinical", roles: ["ADMIN", "CLINICIAN", "FRONT_DESK", "INTAKE", "CDS", "SCHEDULER"] },
  "careplan.edit": { label: "Care plan, goals and care team", group: "Clinical", roles: ["ADMIN", "CLINICIAN", "CDS"] },
  "careplan.team": { label: "Care team members on the care plan", group: "Clinical", roles: ["ADMIN", "CLINICIAN", "CDS", "FRONT_DESK", "INTAKE"] },
  "reports.clinical": { label: "Patient registry and quality measures", group: "Clinical", roles: ["ADMIN", "CLINICIAN", "CDS", "CODER", "FRONT_DESK"] },
  "reports.export": { label: "Export registry results", group: "Clinical", roles: ["ADMIN", "CLINICIAN", "CDS"] },
  // ---- Revenue
  "billing.work": { label: "Revenue cycle: claims, pre-release queue, ERA, denials, statements", group: "Revenue", roles: ["ADMIN", "BILLER"] },
  "billing.templates": { label: "Superbill templates", group: "Revenue", roles: ["ADMIN", "CLINICIAN", "BILLER", "CODER"] },
  "codes.library": { label: "Code library and charge schedules (view)", group: "Revenue", roles: ["ADMIN", "BILLER", "CDS", "CODER"] },
  "codes.edit": { label: "Edit the code library and charge schedules", group: "Revenue", roles: ["ADMIN", "BILLER"] },
  "codes.lookup": { label: "Look up codes while charting or billing", group: "Revenue", roles: ["ADMIN", "BILLER", "CDS", "CODER", "CLINICIAN", "FRONT_DESK"] },
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

// Per-user, per-practice changes to the defaults: a permission the user's role does not have but this person may
// use (true), or one the role has that this person may not (false). Stored as JSON on the practice membership.
export type Overrides = Partial<Record<PermissionKey, boolean>>;

// Whoever is asking: a bare role (defaults only) or a signed-in user with their overrides for the active practice.
export type Subject = string | null | undefined | { role: string; overrides?: Overrides | null };

// A role list that remembers which permission it came from, so a check against the list can also apply the
// subject's overrides. Lists built by hand (no permission key) stay role-only.
export type RoleList = string[] & { permission?: PermissionKey };

export function rolesFor(key: PermissionKey): RoleList {
  return Object.assign([...PERMISSIONS[key].roles], { permission: key });
}

export function roleOf(subject: Subject): string | null {
  if (!subject) return null;
  return typeof subject === "string" ? subject : subject.role;
}

export function can(subject: Subject, key: PermissionKey) {
  const role = roleOf(subject);
  if (!role) return false;
  const override = subject && typeof subject === "object" ? subject.overrides?.[key] : undefined;
  if (override !== undefined) return override;
  return (PERMISSIONS[key].roles as readonly string[]).includes(role);
}

// Is the subject allowed by this role list? When the list came from rolesFor(key), the overrides count too.
export function allowed(subject: Subject, roles: RoleList | readonly string[]) {
  const key = (roles as RoleList).permission;
  if (key) return can(subject, key);
  const role = roleOf(subject);
  return Boolean(role && roles.includes(role));
}

export function parseOverrides(json: string | null | undefined): Overrides | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    const out: Overrides = {};
    for (const [k, v] of Object.entries(raw)) if (k in PERMISSIONS && typeof v === "boolean") out[k as PermissionKey] = v;
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

// Only the entries that change the role's default are kept; an override equal to the default is dropped.
export function serializeOverrides(role: string, overrides: Overrides): string | null {
  const kept: Overrides = {};
  for (const [k, v] of Object.entries(overrides)) {
    const key = k as PermissionKey;
    if (v !== undefined && v !== can(role, key)) kept[key] = v;
  }
  return Object.keys(kept).length ? JSON.stringify(kept) : null;
}
