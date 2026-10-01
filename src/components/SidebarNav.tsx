"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useState, type ReactNode } from "react";

// group: heading shown above this item (first of its group). match: every path that belongs to the item.
export type NavItem = { href: string; label: string; icon: string; badge?: number; group?: string; match?: string[] };

const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

// Simple line icons (24×24) for the main navigation.
const ICONS: Record<string, ReactNode> = {
  credentialing: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" {...s} />
      <circle cx="9" cy="11" r="2.5" {...s} />
      <path d="M5.5 17c.6-1.8 2-2.8 3.5-2.8s2.9 1 3.5 2.8M14.5 10h4M14.5 13.5h3" {...s} />
    </>
  ),
  gateway: (
    <>
      <path d="M4 20V6a2 2 0 0 1 2-2h8l6 6v10" {...s} />
      <path d="M2 20h20M10 13h4M12 11v4" {...s} />
    </>
  ),
  connect: (
    <>
      <rect x="6" y="2" width="12" height="20" rx="2.5" {...s} />
      <path d="M10 18h4M9 8.5l2 2 4-4" {...s} />
    </>
  ),
  schedule: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" {...s} />
      <path d="M3 10h18M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2" {...s} />
    </>
  ),
  tasks: (
    <>
      <path d="M4 5h16v11H8l-4 4z" {...s} />
      <path d="M8 10l2 2 4-4" {...s} />
    </>
  ),
  orders: (
    <>
      <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3" {...s} />
      <path d="M7.5 14h9" {...s} />
    </>
  ),
  referral: (
    <>
      <path d="M4 12h12M12 7l5 5-5 5" {...s} />
      <path d="M20 4v16" {...s} />
    </>
  ),
  reports: (
    <>
      <path d="M4 20V4M4 20h16" {...s} />
      <path d="M8 16v-4M12 16V8M16 16v-6" {...s} />
    </>
  ),
  flow: (
    <>
      <rect x="3" y="4" width="5" height="16" rx="1.5" {...s} />
      <rect x="10" y="4" width="5" height="11" rx="1.5" {...s} />
      <rect x="17" y="4" width="4" height="7" rx="1.5" {...s} />
    </>
  ),
  recall: (
    <>
      <path d="M4 12a8 8 0 1 0 2.4-5.7" {...s} />
      <path d="M4 4v4h4M12 8v4l3 2" {...s} />
    </>
  ),
  visits: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" {...s} />
      <path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3" {...s} />
    </>
  ),
  revenue: (
    <>
      <circle cx="12" cy="12" r="9" {...s} />
      <path d="M15 9.2c-.5-1-1.6-1.6-3-1.6-1.8 0-3 .9-3 2.2 0 3 6 1.6 6 4.6 0 1.3-1.3 2.2-3 2.2-1.5 0-2.7-.7-3.1-1.8M12 6v1.6M12 16.6V18" {...s} />
    </>
  ),
  statements: (
    <>
      <path d="M6 3h9l4 4v14H6z" {...s} />
      <path d="M14 3v5h5M9 12h7M9 15.5h7M9 19h4" {...s} />
    </>
  ),
  directories: (
    <>
      <path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z" {...s} />
      <path d="M5 18a2 2 0 0 1 2-2h11M9 8h5" {...s} />
    </>
  ),
  staff: (
    <>
      <circle cx="9" cy="8" r="3.2" {...s} />
      <path d="M3 20c.8-3.3 3.2-5 6-5s5.2 1.7 6 5M16 5.2a3 3 0 0 1 0 5.6M18 15.3c1.5.7 2.6 2.3 3 4.7" {...s} />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" {...s} />
      <path
        d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
        {...s}
      />
    </>
  ),
  fax: (
    <>
      <path d="M7 9V3h8l3 3v3" {...s} />
      <rect x="3" y="9" width="18" height="9" rx="2" {...s} />
      <path d="M7 15h10v6H7zM17 12h1" {...s} />
    </>
  ),
  audit: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z" {...s} />
      <path d="M9 12l2 2 4-4" {...s} />
    </>
  ),
};

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/gateway");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ items, initialCollapsed, search }: { items: NavItem[]; initialCollapsed: boolean; search?: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    setCookie("ch_nav", next ? "collapsed" : "expanded");
    // The grid column width lives on the shell so the main area resizes with the panel.
    document.querySelector(".app-shell")?.classList.toggle("nav-collapsed", next);
  };

  return (
    <>
      <button
        type="button"
        className="nav-toggle"
        onClick={toggle}
        aria-label={collapsed ? "Expand menu" : "Collapse menu"}
        title={collapsed ? "Expand menu" : "Collapse menu"}
        aria-expanded={!collapsed}
      >
        {collapsed ? "»" : "«"}
      </button>
      <nav aria-label="Main">
        {search}
        {items.map((item) => {
          const active = (item.match ?? [item.href]).some((href) => isActive(pathname, href));
          return (
            <Fragment key={item.href}>
              {item.group && <span className="nav-group">{item.group}</span>}
            <Link
              href={item.href}
              className={active ? "active" : undefined}
              aria-current={active ? "page" : undefined}
              aria-label={collapsed ? item.label : undefined}
              data-label={item.label}
              title={collapsed ? item.label : undefined}
            >
              <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
                {ICONS[item.icon]}
              </svg>
              <span className="nav-label">{item.label}</span>
              {item.badge ? (
                <span className="nav-badge" title="Items need attention">
                  {item.badge}
                </span>
              ) : null}
            </Link>
            </Fragment>
          );
        })}
      </nav>
    </>
  );
}

// « / » to hide a side panel (e.g. the chart's document workflow); remembered in a cookie.
export function PanelToggle({ target, cookie, initialCollapsed, label }: { target: string; cookie: string; initialCollapsed: boolean; label: string }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  return (
    <button
      type="button"
      className="panel-toggle"
      aria-label={collapsed ? `Show ${label}` : `Hide ${label}`}
      title={collapsed ? `Show ${label}` : `Hide ${label}`}
      aria-expanded={!collapsed}
      onClick={() => {
        const next = !collapsed;
        setCollapsed(next);
        setCookie(cookie, next ? "collapsed" : "expanded");
        document.querySelector(target)?.classList.toggle("rail-collapsed", next);
      }}
    >
      {collapsed ? "»" : "«"}
    </button>
  );
}
