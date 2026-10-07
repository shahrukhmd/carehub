import { rolesFor } from "@/lib/permissions";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { formatDate, formatTime, roleLabel } from "@/lib/format";
import { SettingsNav } from "../settings-nav";

const PAGE_SIZE = 200;

type Search = { user?: string; action?: string; entity?: string; from?: string; to?: string; q?: string; page?: string };

const isDate = (v?: string) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(rolesFor("settings.admin"));
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const where: Prisma.AuditLogWhereInput = {
    practiceId: user.practiceId,
    ...(sp.user === "none" ? { userId: null } : sp.user ? { userId: sp.user } : {}),
    ...(sp.action ? { action: sp.action } : {}),
    ...(sp.entity ? { entityType: sp.entity } : {}),
    ...(isDate(sp.from) || isDate(sp.to)
      ? {
          createdAt: {
            ...(isDate(sp.from) ? { gte: new Date(`${sp.from}T00:00:00`) } : {}),
            ...(isDate(sp.to) ? { lte: new Date(`${sp.to}T23:59:59.999`) } : {}),
          },
        }
      : {}),
    ...(sp.q ? { OR: [{ detail: { contains: sp.q, mode: "insensitive" } }, { entityId: { contains: sp.q, mode: "insensitive" } }] } : {}),
  };

  const [logs, total, users, actions, entities] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditLog.count({ where }),
    // Everyone who has an entry in this practice's log, including staff since removed from it.
    prisma.user.findMany({
      where: { auditLogs: { some: { practiceId: user.practiceId } } },
      select: { id: true, name: true, email: true, role: true, active: true },
      orderBy: { name: "asc" },
    }),
    prisma.auditLog.findMany({ where: { practiceId: user.practiceId }, distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
    prisma.auditLog.findMany({ where: { practiceId: user.practiceId }, distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
  ]);

  const filtered = Boolean(sp.user || sp.action || sp.entity || sp.from || sp.to || sp.q);
  const selectedUser = users.find((u) => u.id === sp.user);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (n: number) => {
    const params = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== "page" && v) as [string, string][]);
    params.set("page", String(n));
    return `/settings/audit?${params}`;
  };

  return (
    <>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link>
          </p>
          <h1>Audit log</h1>
        </div>
      </div>
      <SettingsNav current="audit" />

      <section className="panel" style={{ marginTop: "1rem" }}>
        <form className="au-filters" method="get">
          <label>
            User
            <select name="user" defaultValue={sp.user ?? ""}>
              <option value="">All users</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {roleLabel[u.role] ?? u.role}
                  {u.active ? "" : " (inactive)"}
                </option>
              ))}
              <option value="none">System / signed-out</option>
            </select>
          </label>
          <label>
            Action
            <select name="action" defaultValue={sp.action ?? ""}>
              <option value="">All actions</option>
              {actions.map((a) => (
                <option key={a.action} value={a.action}>
                  {a.action}
                </option>
              ))}
            </select>
          </label>
          <label>
            Record type
            <select name="entity" defaultValue={sp.entity ?? ""}>
              <option value="">All records</option>
              {entities.map((e) => (
                <option key={e.entityType} value={e.entityType}>
                  {e.entityType}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input type="date" name="from" defaultValue={sp.from ?? ""} />
          </label>
          <label>
            To
            <input type="date" name="to" defaultValue={sp.to ?? ""} />
          </label>
          <label>
            Detail contains
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Name, record ID…" />
          </label>
          <div className="au-filter-actions">
            <button className="btn" type="submit">
              Filter
            </button>
            {filtered && (
              <Link className="btn ghost" href="/settings/audit">
                Clear
              </Link>
            )}
          </div>
        </form>
      </section>

      <section className="panel">
        <p className="muted">
          {total.toLocaleString()} event{total === 1 ? "" : "s"}
          {selectedUser ? ` by ${selectedUser.name} (${selectedUser.email})` : sp.user === "none" ? " with no signed-in user" : ""}
          {filtered ? " matching the filters" : ""} — newest first
          {pages > 1 ? ` · page ${page} of ${pages}` : ""}.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Action</th>
                <th>Record</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="au-when">
                    {formatDate(log.createdAt)} {formatTime(log.createdAt)}
                  </td>
                  <td>
                    {log.user ? (
                      <Link href={`/settings/audit?user=${log.user.id}`} title={`Show only ${log.user.name}'s activity`}>
                        {log.user.name}
                      </Link>
                    ) : (
                      "System"
                    )}
                  </td>
                  <td>{log.action}</td>
                  <td>
                    {log.entityType}
                    {log.entityId ? <span className="muted"> · {log.entityId.slice(0, 8)}</span> : ""}
                  </td>
                  <td>{log.detail ?? "—"}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    {filtered ? "No events match these filters." : "No audit events recorded yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <nav className="vw-step-nav" aria-label="Audit log pages">
            {page > 1 ? (
              <Link className="btn secondary" href={pageHref(page - 1)}>
                ‹ Newer
              </Link>
            ) : (
              <span />
            )}
            {page < pages && (
              <Link className="btn secondary" href={pageHref(page + 1)}>
                Older ›
              </Link>
            )}
          </nav>
        )}
      </section>
    </>
  );
}
