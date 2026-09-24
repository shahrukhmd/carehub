import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { formatDate, formatTime } from "@/lib/format";

export default async function AuditLogPage() {
  const user = await requireUser(["ADMIN"]);

  const logs = await prisma.auditLog.findMany({
    where: { practiceId: user.practiceId },
    include: { user: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Administration</p>
          <h1>Audit log</h1>
        </div>
      </div>
      <section className="panel">
        <p className="muted">Most recent 200 events — who did what, and when.</p>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>
                  {formatDate(log.createdAt)} {formatTime(log.createdAt)}
                </td>
                <td>{log.user?.name ?? "Unknown"}</td>
                <td>{log.action}</td>
                <td>
                  {log.entityType}
                  {log.entityId ? ` · ${log.entityId.slice(0, 8)}` : ""}
                </td>
                <td>{log.detail ?? "—"}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={5}>No audit events recorded yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
