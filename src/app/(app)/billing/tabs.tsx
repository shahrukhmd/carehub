import Link from "next/link";

export const BILLING_TABS = [
  { key: "visits", label: "Visits to bill", href: "/billing?tab=visits" },
  { key: "claims", label: "Claims", href: "/billing/claims" },
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
