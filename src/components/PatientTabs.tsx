"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The patient chart's tab strip: every patient page one click away, instead of the quick-actions dropdown.
export function PatientTabs({ patientId, tabs }: { patientId: string; tabs: { href: string; label: string }[] }) {
  const path = usePathname();
  const base = `/patients/${patientId}`;
  const active = (href: string) => (href === base ? path === base : path.startsWith(href));
  return (
    <nav className="view-tabs pt-tabs no-print" aria-label="Patient">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className={`view-tab${active(t.href) ? " active" : ""}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
