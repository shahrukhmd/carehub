import Link from "next/link";

export const BILLING_TABS = [
  { key: "visits", label: "Visits to bill", href: "/billing?tab=visits" },
  { key: "claims", label: "Claims", href: "/billing/claims" },
  { key: "release", label: "Pre-release queue", href: "/billing/claims/release" },
  { key: "deposits", label: "Deposits", href: "/billing?tab=deposits" },
  { key: "era", label: "ERA / 835 posting", href: "/billing?tab=era" },
  { key: "ar", label: "AR & denials", href: "/billing?tab=ar" },
  { key: "denials", label: "Denial worklist", href: "/billing/denials" },
  { key: "reports", label: "Financial reports", href: "/billing/reports" },
];

// The Revenue cycle tab strip, shared by the billing page and the claims dashboard.
export function BillingTabs({ active }: { active: string }) {
  return (
    <nav className="view-tabs" style={{ margin: "0.6rem 0", width: "fit-content" }}>
      {BILLING_TABS.map((t) => (
        <Link key={t.key} href={t.href} className={`view-tab${t.key === active ? " active" : ""}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export const CLAIM_TOOLS = [
  { key: "dashboard", label: "Dashboard", href: "/billing/claims", hint: "Every claim by status" },
  { key: "new", label: "Create new claim", href: "/billing/claims/new", hint: "From a signed visit, or keyed by billing" },
  { key: "paper", label: "Create paper claims", href: "/billing/claims/paper", hint: "Print CMS-1500 forms for payers that don't take electronic claims" },
  { key: "release", label: "Pre-release queue", href: "/billing/claims/release", hint: "Generated claims waiting for billing to review and bill to insurance" },
  { key: "status", label: "Billing batch status", href: "/billing/claims/release/status", hint: "What happened to each claim in a billing batch" },
];

// The Claims menu, under the Revenue cycle tabs on every claims page.
export function ClaimsMenu({ active }: { active: string }) {
  return (
    <nav className="cm-menu" aria-label="Claims">
      {CLAIM_TOOLS.map((t) => (
        <Link key={t.key} href={t.href} title={t.hint} className={t.key === active ? "cm-on" : undefined} aria-current={t.key === active ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
