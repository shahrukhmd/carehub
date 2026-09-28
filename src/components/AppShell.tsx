import type { ReactNode } from "react";
import Link from "next/link";
import type { Membership, Practice, User } from "@prisma/client";
import { logout } from "@/app/login/actions";
import { switchPractice } from "@/app/switch-practice/actions";
import { roleLabel } from "@/lib/format";

const nav = [
  { href: "/credentialing", label: "Credentialing", roles: ["ADMIN", "CREDENTIALING"] },
  { href: "/", label: "Patient Gateway", roles: ["ADMIN", "FRONT_DESK", "CLINICIAN", "INTAKE", "VERIFICATION", "SCHEDULER"] },
  { href: "/schedule", label: "Schedule", roles: ["ADMIN", "FRONT_DESK", "CLINICIAN", "SCHEDULER"] },
  { href: "/encounters", label: "Visit worklist", roles: ["ADMIN", "CLINICIAN", "CDS", "BILLER", "FRONT_DESK", "SCHEDULER"] },
  { href: "/billing", label: "Revenue cycle", roles: ["ADMIN", "BILLER"] },
  { href: "/statements", label: "Statements", roles: ["ADMIN", "BILLER"] },
  { href: "/directories", label: "Directories", roles: ["ADMIN", "FRONT_DESK", "BILLER", "CLINICIAN", "CREDENTIALING", "INTAKE", "VERIFICATION", "SCHEDULER", "CDS"] },
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
  credentialingAlertCount = 0,
}: {
  children: ReactNode;
  user: User & { practice: Practice; memberships: (Membership & { practice: Practice })[] };
  credentialingAlertCount?: number;
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
              {item.href === "/credentialing" && credentialingAlertCount > 0 && (
                <span className="nav-badge" title="Credentialing items need attention">
                  {credentialingAlertCount}
                </span>
              )}
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
            <p className="clinic-meta">{user.practice.state ? `Facility · ${user.practice.state}` : "Facility"}</p>
          </div>
          <div className="topbar-right">
            {user.memberships.length > 1 && (
              <form className="practice-switch" action={switchPractice}>
                <select name="practiceId" defaultValue={user.practiceId} aria-label="Facility">
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
            {user.isMaster && (
              <span className="pill pill-master" title="Consolidated view across all your practices">
                Master
              </span>
            )}
            <span className="pill">{roleLabel[user.role] ?? user.role}</span>
            {["ADMIN", "CLINICIAN"].includes(user.role) && (
              <Link className="btn ghost" href="/settings/signature">
                My signature
              </Link>
            )}
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
