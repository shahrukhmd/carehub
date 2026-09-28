import Link from "next/link";

const LINKS: [string, string, string][] = [
  ["documentation", "/settings/documentation", "Documentation settings"],
  ["practice", "/settings/practice", "Facility setup"],
  ["signature", "/settings/signature", "My signature"],
];

export function SettingsNav({ current }: { current: string }) {
  return (
    <nav className="st-nav" aria-label="Settings">
      {LINKS.map(([key, href, label]) => (
        <Link key={key} href={href} className={current === key ? "active" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
