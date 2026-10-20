import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { rolesFor } from "@/lib/permissions";
import { formatDate, formatTime } from "@/lib/format";
import { GisPage } from "../gis-shell";
import { clearNotifications, markNotificationsRead } from "../actions";

// The GIS inbox: maps and groups shared with you, geocoding runs, share links opened.
export default async function GisNotificationsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser(rolesFor("gis.view"));
  const sp = await searchParams;
  const items = await prisma.gisNotification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 200 });
  const unread = items.filter((n) => !n.readAt).length;
  const tone: Record<string, string> = { INFO: "#2563eb", SUCCESS: "#16a34a", WARNING: "#d97706" };

  return (
    <GisPage
      title="Notifications"
      subtitle={unread ? `${unread} unread` : "Nothing unread"}
      sp={sp}
      actions={
        <>
          <form action={markNotificationsRead}>
            <button className="btn secondary" type="submit" disabled={unread === 0}>
              Mark all read
            </button>
          </form>
          <form action={clearNotifications}>
            <button className="btn ghost" type="submit">
              Clear read
            </button>
          </form>
        </>
      }
    >
      <section className="panel">
        <ul className="rp-list">
          {items.map((n) => (
            <li key={n.id} className={n.readAt ? "muted" : undefined}>
              <span>
                <span className="gis-swatch" style={{ background: tone[n.kind] ?? tone.INFO }} /> <strong>{n.title}</strong>
                <div className="cn-small">{n.message}</div>
                <div className="muted cn-small">
                  {formatDate(n.createdAt)} {formatTime(n.createdAt)}
                  {n.href && (
                    <>
                      {" · "}
                      <Link href={n.href}>Open</Link>
                    </>
                  )}
                </div>
              </span>
              {!n.readAt && (
                <form action={markNotificationsRead}>
                  <input type="hidden" name="ids" value={n.id} />
                  <button className="btn ghost" type="submit">
                    Mark read
                  </button>
                </form>
              )}
            </li>
          ))}
          {items.length === 0 && <li className="muted">No notifications yet.</li>}
        </ul>
      </section>
    </GisPage>
  );
}
