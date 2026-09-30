import Link from "next/link";

// Settings sections and who can open them.
export const SETTINGS_SECTIONS: { key: string; href: string; label: string; description: string; roles: string[] }[] = [
  {
    key: "directories",
    href: "/settings/directories",
    label: "Directories",
    description: "Providers, insurance payers, billing groups, superbill templates, code lists & fees",
    roles: ["ADMIN", "FRONT_DESK", "BILLER", "CLINICIAN", "CREDENTIALING", "INTAKE", "VERIFICATION", "SCHEDULER", "CDS"],
  },
  {
    key: "documentation",
    href: "/settings/documentation",
    label: "Documentation settings",
    description: "Chart templates, form designer, chart workflows, signature & critical documents, documentation views",
    roles: ["ADMIN"],
  },
  {
    key: "practice",
    href: "/settings/practice",
    label: "Facility setup",
    description: "Claim pay-to and statement addresses, tax ID, claim rules, clearinghouse, document reading",
    roles: ["ADMIN"],
  },
  {
    key: "scheduling",
    href: "/settings/scheduling",
    label: "Scheduler admin",
    description: "Visit types & durations, color coding, visit info, office hours, cancellation reasons, calendar filters, resources",
    roles: ["ADMIN"],
  },
  {
    key: "clinical-rules",
    href: "/settings/clinical-rules",
    label: "Clinical rules",
    description: "Care-gap alerts: which screenings, labs and assessments are due, for whom and how often",
    roles: ["ADMIN"],
  },
  {
    key: "patients",
    href: "/settings/patients",
    label: "Duplicate patients",
    description: "Find likely duplicate charts and merge them into one",
    roles: ["ADMIN"],
  },
  {
    key: "letters",
    href: "/settings/letters",
    label: "Letters & labels",
    description: "Patient letter templates with merge fields; chart, address and barcode labels",
    roles: ["ADMIN"],
  },
  {
    key: "interop",
    href: "/settings/interop",
    label: "Interoperability",
    description: "FHIR API clients, C-CDA export/import and immunization registry export",
    roles: ["ADMIN"],
  },
  {
    key: "messages",
    href: "/settings/messages",
    label: "System messages",
    description: "Announcements shown to every user for a set period",
    roles: ["ADMIN"],
  },
  {
    key: "users",
    href: "/settings/users",
    label: "User Access Manager",
    description: "Staff logins and roles; add users, change roles, activate or deactivate, reset passwords",
    roles: ["ADMIN"],
  },
  {
    key: "audit",
    href: "/settings/audit",
    label: "Audit log",
    description: "Who did what and when, filterable by user, action and date",
    roles: ["ADMIN"],
  },
  {
    key: "signature",
    href: "/settings/signature",
    label: "My signature",
    description: "Your signature on file, stamped on the records and forms you sign",
    roles: ["ADMIN", "CLINICIAN"],
  },
];

export function settingsFor(role: string) {
  return SETTINGS_SECTIONS.filter((s) => s.roles.includes(role));
}

export function SettingsNav({ current, role = "ADMIN" }: { current: string; role?: string }) {
  return (
    <nav className="st-nav" aria-label="Settings">
      {settingsFor(role).map((s) => (
        <Link key={s.key} href={s.href} className={current === s.key ? "active" : undefined}>
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
