import type { ReactNode } from "react";
import Link from "next/link";
import type { Membership, Practice, User } from "@prisma/client";
import { logout } from "@/app/login/actions";
import { switchPractice } from "@/app/switch-practice/actions";
import { roleLabel } from "@/lib/format";
import { SidebarNav } from "@/components/SidebarNav";
import { SectionTabs } from "@/components/SectionTabs";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SystemBanner } from "@/components/SystemBanner";
import { PatientSearchPanel } from "@/components/PatientSearchPanel";
import { PATIENT_VIEW_ROLES, canWorkTeam } from "@/lib/gateway";

type Tab = { href: string; label: string; roles: string[] };
type Entry = { label: string; icon: string; tabs: Tab[] };

// The side menu is grouped by the kind of work. An entry with several tabs is one menu item; its tabs sit in the
// top bar while the user is in that section, so related screens are one click apart without crowding the menu.
const MENU: { group: string; entries: Entry[] }[] = [
  {
    group: "My work",
    entries: [{ label: "Tasks & messages", icon: "tasks", tabs: [{ href: "/tasks", label: "Tasks & messages", roles: ["ADMIN", "FRONT_DESK", "BILLER", "CLINICIAN", "CREDENTIALING", "INTAKE", "VERIFICATION", "SCHEDULER", "CDS"] }] }],
  },
  {
    group: "Front office",
    entries: [
      { label: "Patient Gateway", icon: "gateway", tabs: [{ href: "/", label: "Patient Gateway", roles: ["ADMIN", "FRONT_DESK", "CLINICIAN", "INTAKE", "VERIFICATION", "SCHEDULER"] }] },
      {
        label: "Schedule",
        icon: "schedule",
        tabs: [
          { href: "/schedule", label: "Calendar", roles: ["ADMIN", "FRONT_DESK", "CLINICIAN", "SCHEDULER"] },
          { href: "/flow", label: "Flow board", roles: ["ADMIN", "FRONT_DESK", "CLINICIAN", "SCHEDULER", "INTAKE"] },
          { href: "/recalls", label: "Recalls", roles: ["ADMIN", "FRONT_DESK", "SCHEDULER", "CLINICIAN", "INTAKE"] },
        ],
      },
      {
        label: "Patient outreach",
        icon: "connect",
        tabs: [
          { href: "/connect", label: "Patient Connect", roles: ["ADMIN", "FRONT_DESK", "CLINICIAN", "INTAKE", "VERIFICATION", "SCHEDULER"] },
          { href: "/faxing", label: "Faxing", roles: ["ADMIN", "FRONT_DESK", "INTAKE", "VERIFICATION", "SCHEDULER", "CLINICIAN"] },
        ],
      },
    ],
  },
  {
    group: "Clinical",
    entries: [
      {
        label: "Clinical",
        icon: "visits",
        tabs: [
          { href: "/encounters", label: "Visit worklist", roles: ["ADMIN", "CLINICIAN", "CDS", "BILLER", "FRONT_DESK", "SCHEDULER"] },
          { href: "/orders", label: "Lab & imaging orders", roles: ["ADMIN", "CLINICIAN", "FRONT_DESK", "INTAKE"] },
          { href: "/referrals", label: "Referrals", roles: ["ADMIN", "CLINICIAN", "FRONT_DESK", "INTAKE", "SCHEDULER"] },
        ],
      },
    ],
  },
  {
    group: "Revenue",
    entries: [
      {
        label: "Revenue cycle",
        icon: "revenue",
        tabs: [
          { href: "/billing", label: "Revenue cycle", roles: ["ADMIN", "BILLER"] },
          { href: "/statements", label: "Statements", roles: ["ADMIN", "BILLER"] },
        ],
      },
      { label: "Credentialing", icon: "credentialing", tabs: [{ href: "/credentialing", label: "Credentialing", roles: ["ADMIN", "CREDENTIALING"] }] },
    ],
  },
  {
    group: "Insights & setup",
    entries: [
      { label: "Reports", icon: "reports", tabs: [{ href: "/reports", label: "Reports", roles: ["ADMIN", "FRONT_DESK", "BILLER", "SCHEDULER"] }] },
      // Directories live under Settings; everyone who uses them sees Settings.
      { label: "Settings", icon: "settings", tabs: [{ href: "/settings", label: "Settings", roles: ["ADMIN", "FRONT_DESK", "BILLER", "CLINICIAN", "CREDENTIALING", "INTAKE", "VERIFICATION", "SCHEDULER", "CDS"] }] },
    ],
  },
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
  taskCount = 0,
  navCollapsed = true,
  theme = "light",
  ai = null,
  systemMessages = [],
}: {
  children: ReactNode;
  user: User & { practice: Practice; memberships: (Membership & { practice: Practice })[] };
  credentialingAlertCount?: number;
  taskCount?: number;
  navCollapsed?: boolean;
  theme?: "light" | "dark";
  // Which AI provider is switched on for this practice (null: AI assistance is off).
  ai?: string | null;
  systemMessages?: { id: string; title: string; message: string; level: string; version: string }[];
}) {
  // Only what this role may open; a menu entry links to the first of its tabs the user can use.
  const menu = MENU.map((g) => ({
    group: g.group,
    entries: g.entries.map((e) => ({ ...e, tabs: e.tabs.filter((t) => t.roles.includes(user.role)) })).filter((e) => e.tabs.length > 0),
  })).filter((g) => g.entries.length > 0);
  const items = menu.flatMap((g) =>
    g.entries.map((e, i) => ({
      href: e.tabs[0].href,
      label: e.tabs.length > 1 ? e.label : e.tabs[0].label,
      icon: e.icon,
      group: i === 0 ? g.group : undefined,
      match: e.tabs.map((t) => t.href),
      badge: e.tabs[0].href === "/credentialing" ? credentialingAlertCount : e.tabs[0].href === "/tasks" ? taskCount : 0,
    }))
  );
  const sections = menu.flatMap((g) => g.entries.map((e) => e.tabs.map(({ href, label }) => ({ href, label }))));

  return (
    <div className={`app-shell${navCollapsed ? " nav-collapsed" : ""}`} data-theme={theme}>
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
          <div className="topbar-left">
            <div>
              <p className="clinic-name">{user.practice.name}</p>
              <p className="clinic-meta">{user.practice.state ? `Facility · ${user.practice.state}` : "Facility"}</p>
            </div>
            <SectionTabs sections={sections} />
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
            <Link
              className={`ai-chip${ai ? " on" : ""}`}
              href="/settings/practice"
              title={ai ? `AI assistance is on (${ai}): document reading, appeal letters, plan of care suggestions` : "AI assistance is off — turn it on in Settings → Practice"}
            >
              ✦ AI {ai ? "on" : "off"}
            </Link>
            <ThemeToggle initial={theme} />
            <details className="user-menu">
              <summary aria-label="Account menu">
                <span className="avatar" title={user.name}>
                  {initials(user.name)}
                </span>
              </summary>
              <div className="user-menu-pop">
                <strong>{user.name}</strong>
                <span className="muted">{roleLabel[user.role] ?? user.role}</span>
                <hr />
                {["ADMIN", "CLINICIAN"].includes(user.role) && <Link href="/settings/signature">My signature</Link>}
                <Link href="/settings">Settings</Link>
                <form action={logout}>
                  <button type="submit">Sign out</button>
                </form>
              </div>
            </details>
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
