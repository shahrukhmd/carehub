import Link from "next/link";

// Settings are grouped by what they set up, in the order a practice usually needs them.
export const SETTINGS_GROUPS: { key: string; label: string; about: string }[] = [
  { key: "people", label: "People & access", about: "Who can sign in and what they sign" },
  { key: "practice", label: "Practice, sites & scheduling", about: "The practice itself, where patients are seen and how visits are booked" },
  { key: "billing", label: "Providers, insurance & fees", about: "The lists every claim is built from" },
  { key: "patients", label: "Patients & registration", about: "The registration form, bringing patients in and writing to them" },
  { key: "clinical", label: "Clinical", about: "Charting, care rules, orders and vaccines" },
  { key: "compliance", label: "Compliance & data", about: "Privacy, the audit trail and connections to other systems" },
];

export type SettingsSection = { key: string; group: string; href: string; label: string; description: string; roles: string[] };

// Settings sections and who can open them.
export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    key: "directories",
    group: "billing",
    href: "/settings/directories",
    label: "Providers, insurance & codes",
    description: "Providers, insurance payers, billing groups, superbill templates, code lists & fees",
    roles: ["ADMIN", "FRONT_DESK", "BILLER", "CLINICIAN", "CREDENTIALING", "INTAKE", "VERIFICATION", "SCHEDULER", "CDS", "CODER"],
  },
  {
    key: "documentation",
    group: "clinical",
    href: "/settings/documentation",
    label: "Charting & documents",
    description: "Chart templates, form designer, chart workflows, signature & critical documents, documentation views",
    roles: ["ADMIN"],
  },
  {
    key: "practice",
    group: "practice",
    href: "/settings/practice",
    label: "Practice setup",
    description: "Claim pay-to and statement addresses, tax ID, claim rules, clearinghouse, document reading",
    roles: ["ADMIN"],
  },
  {
    key: "sites",
    group: "practice",
    href: "/settings/sites",
    label: "Sites of service",
    description: "Facilities and clinics where patients are seen: service type, address, place of service, NPIs, PTAN",
    roles: ["ADMIN"],
  },
  {
    key: "charge-schedules",
    group: "billing",
    href: "/settings/charge-schedules",
    label: "Charge schedules",
    description: "Fee per billing code by site of service, provider and insurance, with start and end dates; export and import",
    roles: ["ADMIN", "BILLER"],
  },
  {
    key: "code-library",
    group: "billing",
    href: "/settings/code-library",
    label: "Code library",
    description: "Every ICD-10 diagnosis code and HCPCS / CPT billing code, fetched from the publishers and searchable; charge schedules and the superbill pick from it",
    roles: ["ADMIN", "BILLER", "CDS", "CODER"],
  },
  {
    key: "scheduling",
    group: "practice",
    href: "/settings/scheduling",
    label: "Scheduler admin",
    description: "Encounter types (billable, durations, wound photo measurements), color coding, visit info, office hours, cancellation reasons, calendar filters, resources",
    roles: ["ADMIN"],
  },
  {
    key: "clinical-rules",
    group: "clinical",
    href: "/settings/clinical-rules",
    label: "Clinical rules",
    description: "Care-gap alerts: which screenings, labs and assessments are due, for whom and how often",
    roles: ["ADMIN"],
  },
  {
    key: "orders",
    group: "clinical",
    href: "/settings/orders",
    label: "Lab & imaging setup",
    description: "Labs, imaging and vascular centers you order from, and the test / study catalog",
    roles: ["ADMIN"],
  },
  {
    key: "vaccines",
    group: "clinical",
    href: "/settings/vaccines",
    label: "Vaccine inventory",
    description: "Vaccine stock by lot: doses on hand, expiration, low stock; doses given come off the count",
    roles: ["ADMIN", "CLINICIAN"],
  },
  {
    key: "custom-fields",
    group: "patients",
    href: "/settings/custom-fields",
    label: "Custom patient fields",
    description: "Extra fields on the patient registration form: text, number, date, checkbox or your own dropdown lists",
    roles: ["ADMIN"],
  },
  {
    key: "import",
    group: "patients",
    href: "/settings/import",
    label: "Patient import",
    description: "Bring patients over from another system with a CSV file — preview, check and undo",
    roles: ["ADMIN"],
  },
  {
    key: "patients",
    group: "patients",
    href: "/settings/patients",
    label: "Duplicate patients",
    description: "Find likely duplicate charts and merge them into one",
    roles: ["ADMIN"],
  },
  {
    key: "letters",
    group: "patients",
    href: "/settings/letters",
    label: "Letters & labels",
    description: "Patient letter templates with merge fields; chart, address and barcode labels",
    roles: ["ADMIN"],
  },
  {
    key: "interop",
    group: "compliance",
    href: "/settings/interop",
    label: "Interoperability",
    description: "FHIR API clients, C-CDA export/import and immunization registry export",
    roles: ["ADMIN"],
  },
  {
    key: "messages",
    group: "practice",
    href: "/settings/messages",
    label: "System messages",
    description: "Announcements shown to every user for a set period",
    roles: ["ADMIN"],
  },
  {
    key: "users",
    group: "people",
    href: "/settings/users",
    label: "Users & roles",
    description: "Staff logins and roles; add users, change roles, activate or deactivate, reset passwords",
    roles: ["ADMIN"],
  },
  {
    key: "privacy",
    group: "compliance",
    href: "/settings/privacy",
    label: "Privacy & compliance",
    description: "Amendment requests, emergency chart access to review, restricted charts, disclosures, text consent rule",
    roles: ["ADMIN"],
  },
  {
    key: "audit",
    group: "compliance",
    href: "/settings/audit",
    label: "Audit log",
    description: "Who did what and when, filterable by user, action and date",
    roles: ["ADMIN"],
  },
  {
    key: "signature",
    group: "people",
    href: "/settings/signature",
    label: "My signature",
    description: "Your signature on file, stamped on the records and forms you sign",
    roles: ["ADMIN", "CLINICIAN"],
  },
];

export function settingsFor(role: string) {
  return SETTINGS_SECTIONS.filter((s) => s.roles.includes(role));
}

// On a settings page: the way back to all settings, then only the settings that belong with this one.
export function SettingsNav({ current, role = "ADMIN" }: { current: string; role?: string }) {
  const all = settingsFor(role);
  const here = all.find((s) => s.key === current);
  if (!here) return null;
  const group = SETTINGS_GROUPS.find((g) => g.key === here.group);
  return (
    <nav className="st-nav" aria-label="Settings">
      <Link href="/settings" className="st-nav-back">
        « All settings
      </Link>
      {group && <span className="st-nav-group">{group.label}</span>}
      {all
        .filter((s) => s.group === here.group)
        .map((s) => (
          <Link key={s.key} href={s.href} className={current === s.key ? "active" : undefined}>
            {s.label}
          </Link>
        ))}
    </nav>
  );
}
