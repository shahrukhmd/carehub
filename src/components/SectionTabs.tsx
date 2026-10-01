"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type SectionTab = { href: string; label: string };

const within = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

// Tabs of the section the user is in (e.g. Schedule: Calendar · Flow board · Recalls), shown in the top bar.
export function SectionTabs({ sections }: { sections: SectionTab[][] }) {
  const pathname = usePathname();
  const tabs = sections.find((s) => s.some((t) => within(pathname, t.href)));
  if (!tabs || tabs.length < 2) return null;
  return (
    <nav className="section-tabs" aria-label="Section">
      {tabs.map((t) => {
        const active = within(pathname, t.href);
        return (
          <Link key={t.href} href={t.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
