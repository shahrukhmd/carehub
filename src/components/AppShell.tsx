import type { ReactNode } from "react";
import Link from "next/link";
import type { Membership, Practice, User } from "@prisma/client";
import { logout } from "@/app/login/actions";
import { switchPractice } from "@/app/switch-practice/actions";
import { roleLabel } from "@/lib/format";

const nav = [
  { href: "/", label: "Command center", roles: ["ADMIN", "FRONT_DESK", "CLINICIAN", "BILLER"] },
  { href: "/schedule", label: "Schedule", roles: ["ADMIN", "FRONT_DESK", "CLINICIAN"] },
  { href: "/patients", label: "Patients", roles: ["ADMIN", "FRONT_DESK", "CLINICIAN"] },
  { href: "/encounters", label: "Charting", roles: ["ADMIN", "CLINICIAN"] },
  { href: "/billing", label: "Revenue cycle", roles: ["ADMIN", "BILLER"] },
  { href: "/directories", label: "Directories", roles: ["ADMIN", "FRONT_DESK", "BILLER", "CLINICIAN"] },
  { href: "/staff", label: "Staff & roles", roles: ["ADMIN"] },
  { href: "/audit", label: "Audit log", roles: ["ADMIN"] },
];

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function AppShell({
  children,
  user,
}: {
  children: ReactNode;
  user: User & { practice: Practice; memberships: (Membership & { practice: Practice })[] };
}) {
  const items = nav.filter((item) => item.roles.includes(user.role));

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
          {items.map((item) => (
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
            <p className="clinic-name">{user.practice.name}</p>
            <p className="clinic-meta">Demo tenant</p>
          </div>
          <div className="topbar-right">
            {user.memberships.length > 1 && (
              <form className="practice-switch" action={switchPractice}>
                <select name="practiceId" defaultValue={user.practiceId}>
                  {user.memberships.map((m) => (
                    <option key={m.practiceId} value={m.practiceId}>
                      {m.practice.name}
                    </option>
                  ))}
                </select>
                <button className="btn secondary" type="submit">
                  Switch
                </button>
              </form>
            )}
            <span className="pill">{roleLabel[user.role] ?? user.role}</span>
            <span className="avatar" title={user.name}>
              {initials(user.name)}
            </span>
            <form action={logout}>
              <button className="btn ghost" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
