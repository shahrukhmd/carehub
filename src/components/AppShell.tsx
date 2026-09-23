import type { ReactNode } from "react";
import Link from "next/link";

const nav = [
  { href: "/", label: "Command center" },
  { href: "/schedule", label: "Schedule" },
  { href: "/patients", label: "Patients" },
  { href: "/encounters", label: "Charting" },
  { href: "/billing", label: "Revenue cycle" },
  { href: "/staff", label: "Staff & roles" },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">CH</span>
          <div>
            <strong>CareHub</strong>
            <p>Integrated EHR &amp; PM</p>
          </div>
        </div>
        <nav>
          {nav.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <p className="demo-note">Demo clinic. Do not store real PHI.</p>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div>
            <p className="clinic-name">Riverside Family Practice</p>
            <p className="clinic-meta">Main Clinic · Demo tenant</p>
          </div>
          <div className="topbar-right">
            <span className="pill">Local SQLite</span>
            <span className="avatar">MC</span>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
