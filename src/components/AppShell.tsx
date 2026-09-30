import type { ReactNode } from "react";
import Link from "next/link";
import type { Membership, Practice, User } from "@prisma/client";
import { logout } from "@/app/login/actions";
import { switchPractice } from "@/app/switch-practice/actions";
import { roleLabel } from "@/lib/format";
import { SidebarNav } from "@/components/SidebarNav";
import { SystemBanner } from "@/components/SystemBanner";
import { PatientSearchPanel } from "@/components/PatientSearchPanel";
import { PATIENT_VIEW_ROLES, canWorkTeam } from "@/lib/gateway";

const nav = [
  { href: "/credentialing", label: "Credentialing", icon: "credentialing", roles: ["ADMIN", "CREDENTIALING"] },
  { href: "/", label: "Patient Gateway", icon: "gateway", roles: ["ADMIN", "FRONT_DESK", "CLINICIAN", "INTAKE", "VERIFICATION", "SCHEDULER"] },
  { href: "/connect", label: "Patient Connect", icon: "connect", roles: ["ADMIN", "FRONT_DESK", "CLINICIAN", "INTAKE", "VERIFICATION", "SCHEDULER"] },
  { href: "/schedule", label: "Schedule", icon: "schedule", roles: ["ADMIN", "FRONT_DESK", "CLINICIAN", "SCHEDULER"] },
  { href: "/flow", label: "Flow board", icon: "flow", roles: ["ADMIN", "FRONT_DESK", "CLINICIAN", "SCHEDULER", "INTAKE"] },
  { href: "/recalls", label: "Recalls", icon: "recall", roles: ["ADMIN", "FRONT_DESK", "SCHEDULER", "CLINICIAN", "INTAKE"] },
  { href: "/encounters", label: "Visit worklist", icon: "visits", roles: ["ADMIN", "CLINICIAN", "CDS", "BILLER", "FRONT_DESK", "SCHEDULER"] },
  { href: "/faxing", label: "Faxing", icon: "fax", roles: ["ADMIN", "FRONT_DESK", "INTAKE", "VERIFICATION", "SCHEDULER", "CLINICIAN"] },
  { href: "/billing", label: "Revenue cycle", icon: "revenue", roles: ["ADMIN", "BILLER"] },
  { href: "/statements", label: "Statements", icon: "statements", roles: ["ADMIN", "BILLER"] },
  // Directories live under Settings; everyone who uses them sees Settings.
  { href: "/settings", label: "Settings", icon: "settings", roles: ["ADMIN", "FRONT_DESK", "BILLER", "CLINICIAN", "CREDENTIALING", "INTAKE", "VERIFICATION", "SCHEDULER", "CDS"] },
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
  navCollapsed = true,
  systemMessages = [],
}: {
  children: ReactNode;
  user: User & { practice: Practice; memberships: (Membership & { practice: Practice })[] };
  credentialingAlertCount?: number;
  navCollapsed?: boolean;
  systemMessages?: { id: string; title: string; message: string; level: string; version: string }[];
}) {
  const items = nav
    .filter((item) => item.roles.includes(user.role))
    .map(({ href, label, icon }) => ({ href, label, icon, badge: href === "/credentialing" ? credentialingAlertCount : 0 }));

  return (
    <div className={`app-shell${navCollapsed ? " nav-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">CH</span>
          <div className="brand-text">
            <strong>CareHub</strong>
            <p>Integrated EHR &amp; PM</p>
          </div>
        </div>
        <SidebarNav
          items={items}
          initialCollapsed={navCollapsed}
          search={PATIENT_VIEW_ROLES.includes(user.role) ? <PatientSearchPanel canAdd={canWorkTeam(user.role, "DATA_ENTRY")} /> : null}
        />
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
        <main className="content">
          <SystemBanner messages={systemMessages} />
          {children}
        </main>
      </div>
    </div>
  );
}
