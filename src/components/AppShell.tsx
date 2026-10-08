import type { ReactNode } from "react";
import Link from "next/link";
import type { Membership, Practice, User } from "@prisma/client";
import { logout } from "@/app/login/actions";
import { switchPractice } from "@/app/switch-practice/actions";
import { roleLabel } from "@/lib/format";
import { SidebarNav } from "@/components/SidebarNav";
import { SectionTabs } from "@/components/SectionTabs";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Popover } from "@/components/Popover";
import { SystemBanner } from "@/components/SystemBanner";
import { PatientSearchPanel } from "@/components/PatientSearchPanel";
import { PATIENT_VIEW_ROLES, canWorkTeam } from "@/lib/gateway";
import { can, type PermissionKey, allowed, type Overrides } from "@/lib/permissions";

type Tab = { href: string; label: string; permission: PermissionKey };
type Entry = { label: string; icon: string; tabs: Tab[] };

// No separate communication space by design: Tasks & messages and Patient Connect are reached from Settings;
// team communication lives on the patient inside each team's step.
// The side menu is grouped by the kind of work. An entry with several tabs is one menu item; its tabs sit in the
// top bar. What a role sees comes from the permission map, the same place the pages check.
const MENU: { group: string; entries: Entry[] }[] = [
  {
    group: "Overview",
    entries: [
      {
        label: "Overview",
        icon: "reports",
        tabs: [
          { href: "/dashboard", label: "Dashboard", permission: "tasks.work" },
          { href: "/workflow", label: "Team workflow", permission: "tasks.work" },
        ],
      },
    ],
  },
  {
    group: "Front office",
    entries: [
      { label: "Patient Gateway", icon: "gateway", tabs: [{ href: "/", label: "Patient Gateway", permission: "gateway.work" }] },
      {
        label: "Scheduler",
        icon: "schedule",
        tabs: [
          { href: "/schedule", label: "Scheduler", permission: "schedule.view" },
          { href: "/flow", label: "Flow board", permission: "flow.work" },
          { href: "/checkout", label: "Checkout", permission: "checkout.work" },
          { href: "/schedule/eligibility", label: "Eligibility checks", permission: "eligibility.run" },
          { href: "/recalls", label: "Recalls", permission: "recalls.work" },
        ],
      },
      { label: "Faxing", icon: "connect", tabs: [{ href: "/faxing", label: "Faxing", permission: "fax.work" }] },
    ],
  },
  {
    group: "Clinical",
    entries: [
      {
        label: "Visits",
        icon: "visits",
        tabs: [
          { href: "/encounters", label: "Visit worklist", permission: "chart.worklist" },
          { href: "/orders", label: "Lab & imaging orders", permission: "orders.manage" },
          { href: "/referrals", label: "Referrals", permission: "referrals.work" },
          { href: "/care-gaps", label: "Care gaps", permission: "caregaps.view" },
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
          { href: "/billing", label: "Visits to bill", permission: "billing.work" },
          { href: "/billing/claims/release", label: "Pre-release queue", permission: "billing.work" },
          { href: "/billing/claims", label: "Claims", permission: "billing.work" },
          { href: "/statements", label: "Statements", permission: "billing.work" },
        ],
      },
      { label: "Credentialing", icon: "credentialing", tabs: [{ href: "/credentialing", label: "Credentialing", permission: "credentialing.work" }] },
    ],
  },
  {
    group: "Insights & setup",
    entries: [
      {
        label: "Reports",
        icon: "reports",
        tabs: [
          { href: "/reports", label: "All reports", permission: "tasks.work" },
          { href: "/reports/registry", label: "Patient registry", permission: "reports.clinical" },
          { href: "/reports/quality", label: "Quality measures", permission: "reports.clinical" },
        ],
      },
      { label: "Settings", icon: "settings", tabs: [{ href: "/settings", label: "Settings", permission: "tasks.work" }] },
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

function PinIcon() {
  return (
    <svg className="pin" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

export function AppShell({
  children,
  user,
  credentialingAlertCount = 0,
  taskCount = 0,
  waitingHome = "/",
  navCollapsed = true,
  theme = "light",
  ai = null,
  systemMessages = [],
}: {
  children: ReactNode;
  user: User & { practice: Practice; memberships: (Membership & { practice: Practice })[]; overrides?: Overrides | null };
  credentialingAlertCount?: number;
  // Patients with something waiting for the user's team, and the menu item (waitingHome) it is counted on.
  taskCount?: number;
  waitingHome?: string;
  navCollapsed?: boolean;
  theme?: "light" | "dark";
  // Which AI provider is switched on for this practice (null: AI assistance is off).
  ai?: string | null;
  systemMessages?: { id: string; title: string; message: string; level: string; version: string }[];
}) {
  // Only what this role may open; a menu entry links to the first of its tabs the user can use.
  const menu = MENU.map((g) => ({
    group: g.group,
    entries: g.entries.map((e) => ({ ...e, tabs: e.tabs.filter((t) => can(user, t.permission)) })).filter((e) => e.tabs.length > 0),
  })).filter((g) => g.entries.length > 0);
  const items = menu.flatMap((g) =>
    g.entries.map((e, i) => ({
      href: e.tabs[0].href,
      label: e.tabs.length > 1 ? e.label : e.tabs[0].label,
      icon: e.icon,
      group: i === 0 ? g.group : undefined,
      match: e.tabs.map((t) => t.href),
      // Patients with a message waiting for this user's team, shown on the item where that team works them.
      badge: e.tabs[0].href === "/credentialing" ? credentialingAlertCount : e.tabs.some((t) => t.href === waitingHome) ? taskCount : 0,
    }))
  );
  const sections = menu.flatMap((g) => g.entries.map((e) => e.tabs.map(({ href, label }) => ({ href, label }))));

  const roleName = roleLabel[user.role] ?? user.role;
  const facilityLabel = (p: Practice) => (p.state ? `${p.name} · ${p.state}` : p.name);

  return (
    <div className={`app-shell${navCollapsed ? " nav-collapsed" : ""}`} data-theme={theme}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z" fill="currentColor" />
            </svg>
          </span>
          <div className="brand-text">
            <strong>CareHub</strong>
            <p>Integrated EHR &amp; PM</p>
          </div>
        </div>
        <SidebarNav
          items={items}
          initialCollapsed={navCollapsed}
          search={allowed(user, PATIENT_VIEW_ROLES) ? <PatientSearchPanel canAdd={canWorkTeam(user.role, "DATA_ENTRY")} /> : null}
        />
        <div className="sidebar-foot">
          <div className="sidebar-user">
            <span className="avatar">{initials(user.name)}</span>
            <div className="sidebar-user-text">
              <strong>{user.name}</strong>
              <span>
                {user.practice.name} · {roleName}
              </span>
            </div>
            <form action={logout}>
              <button type="submit" className="sidebar-logout" aria-label="Sign out" title="Sign out">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M14 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2M9 12h12M18 9l3 3-3 3" />
                </svg>
              </button>
            </form>
          </div>
          <p className="demo-note">Demo clinic. Do not store real PHI.</p>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            {user.memberships.length > 1 ? (
              <Popover
                className="facility-switch"
                label="Working facility"
                trigger={
                  <span className="facility-pill">
                    <PinIcon />
                    <span className="facility-pill-label">Facility</span>
                    <strong>{facilityLabel(user.practice)}</strong>
                    <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </span>
                }
              >
                <div className="popover-head">
                  <div>
                    <strong>Working facility</strong>
                    <p>You only see data for the facility you pick.</p>
                  </div>
                  <button type="button" className="popover-close" data-close aria-label="Close">
                    ×
                  </button>
                </div>
                <form className="facility-grid" action={switchPractice}>
                  {user.memberships.map((m) => {
                    const current = m.practiceId === user.practiceId;
                    return (
                      <button key={m.practiceId} type="submit" name="practiceId" value={m.practiceId} className={current ? "current" : undefined} aria-current={current ? "true" : undefined}>
                        <span>
                          {current && <span aria-hidden="true">✓ </span>}
                          {m.practice.name}
                        </span>
                        <small>
                          {m.practice.state ? `${m.practice.state} · ` : ""}
                          {roleLabel[m.role] ?? m.role}
                        </small>
                      </button>
                    );
                  })}
                </form>
              </Popover>
            ) : (
              <span className="facility-pill static" title="Your facility">
                <PinIcon />
                <span className="facility-pill-label">Facility</span>
                <strong>{facilityLabel(user.practice)}</strong>
              </span>
            )}
            <SectionTabs sections={sections} />
          </div>
          <div className="topbar-right">
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
            <Popover
              className="user-menu"
              label="Account menu"
              trigger={
                <span className="profile-chip">
                  <span className="avatar" title={user.name}>
                    {initials(user.name)}
                  </span>
                  <span className="profile-chip-text">
                    <strong>{user.name}</strong>
                    <small>{roleName}</small>
                  </span>
                </span>
              }
            >
              <div className="profile-head">
                <span className="avatar avatar-lg">{initials(user.name)}</span>
                <div>
                  <strong>{user.name}</strong>
                  <span>{roleName}</span>
                  <span>{user.email}</span>
                </div>
              </div>
              <dl className="profile-rows">
                <dt>Working in</dt>
                <dd>{user.practice.name}</dd>
                {user.memberships.length > 1 && (
                  <>
                    <dt>Facilities</dt>
                    <dd>{user.memberships.map((m) => m.practice.name).join(", ")}</dd>
                  </>
                )}
              </dl>
              <div className="profile-links">
                {["ADMIN", "CLINICIAN"].includes(user.role) && (
                  <Link href="/settings/signature" data-close>
                    My signature
                  </Link>
                )}
                <Link href="/settings/password" data-close>
                  Change password
                </Link>
                <Link href="/settings" data-close>
                  Settings
                </Link>
              </div>
              <form action={logout}>
                <button type="submit" className="btn profile-logout">
                  Log out
                </button>
              </form>
            </Popover>
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
