import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, formatTime, patientName } from "@/lib/format";
import { TASK_PRIORITIES, TASK_TEAMS, TASK_TYPES } from "@/lib/tasks";
import { commentTask, completeTask, newTask, reassignTask, reopenTask } from "./actions";

type Search = { view?: string; type?: string; open?: string; error?: string; patientId?: string; to?: string };

const VIEWS: [string, string][] = [
  ["mine", "My tasks"],
  ["team", "My team"],
  ["unassigned", "Unassigned"],
  ["sent", "Sent by me"],
  ["all", "All open"],
  ["done", "Done"],
];

export default async function TasksPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = VIEWS.some(([k]) => k === sp.view) ? sp.view! : "mine";
  const base: Prisma.TaskWhereInput = { practiceId: user.practiceId, ...(sp.type && TASK_TYPES[sp.type] ? { type: sp.type } : {}) };
  const where: Prisma.TaskWhereInput =
    view === "mine"
      ? { ...base, status: "OPEN", assignedToId: user.id }
      : view === "team"
        ? { ...base, status: "OPEN", assignedToId: null, assignedRole: user.role }
        : view === "unassigned"
          ? { ...base, status: "OPEN", assignedToId: null, assignedRole: null }
          : view === "sent"
            ? { ...base, createdById: user.id }
            : view === "done"
              ? { ...base, status: "DONE" }
              : { ...base, status: "OPEN" };
  const [tasks, members, counts, patients] = await Promise.all([
    prisma.task.findMany({
      where,
      include: { patient: true, comments: { orderBy: { createdAt: "asc" } } },
      orderBy: view === "done" ? [{ completedAt: "desc" }] : [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 300,
    }),
    prisma.membership.findMany({ where: { practiceId: user.practiceId, user: { active: true } }, include: { user: true }, orderBy: { user: { name: "asc" } } }),
    Promise.all([
      prisma.task.count({ where: { practiceId: user.practiceId, status: "OPEN", assignedToId: user.id } }),
      prisma.task.count({ where: { practiceId: user.practiceId, status: "OPEN", assignedToId: null, assignedRole: user.role } }),
      prisma.task.count({ where: { practiceId: user.practiceId, status: "OPEN", assignedToId: null, assignedRole: null } }),
    ]),
    prisma.patient.findMany({ where: { practiceId: user.practiceId, status: "ACTIVE" }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 2000, select: { id: true, firstName: true, lastName: true, mrn: true } }),
  ]);
  const name = new Map(members.map((m) => [m.userId, m.user.name]));
  const who = (t: { assignedToId: string | null; assignedRole: string | null }) =>
    t.assignedToId ? (t.assignedToId === user.id ? "Me" : (name.get(t.assignedToId) ?? "Someone")) : t.assignedRole ? `${TASK_TEAMS[t.assignedRole] ?? t.assignedRole} team` : "Unassigned";
  const now = Date.now();
  const assignOptions = (
    <>
      <optgroup label="Team inbox">
        {Object.entries(TASK_TEAMS).map(([k, l]) => (
          <option key={k} value={`team:${k}`}>
            {l}
          </option>
        ))}
      </optgroup>
      <optgroup label="Person">
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.user.name}
          </option>
        ))}
      </optgroup>
    </>
  );

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">Work queue</p>
          <h1>Tasks &amp; messages</h1>
        </div>
      </div>
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      <nav className="view-tabs" style={{ width: "fit-content", flexWrap: "wrap" }}>
        {VIEWS.map(([k, l], i) => (
          <Link key={k} href={`/tasks?view=${k}${sp.type ? `&type=${sp.type}` : ""}`} className={`view-tab${view === k ? " active" : ""}`}>
            {l}
            {i < 3 && counts[i] > 0 ? <span className="tk-count">{counts[i]}</span> : null}
          </Link>
        ))}
      </nav>
      <nav className="cn-filters">
        <Link href={`/tasks?view=${view}`} className={!sp.type ? "active" : ""}>
          All types
        </Link>
        {Object.entries(TASK_TYPES).map(([k, l]) => (
          <Link key={k} href={`/tasks?view=${view}&type=${k}`} className={sp.type === k ? "active" : ""}>
            {l}
          </Link>
        ))}
      </nav>
      <section className="panel">
        {tasks.length === 0 ? (
          <p className="muted">Nothing here.</p>
        ) : (
          <ul className="tk-list">
            {tasks.map((t) => {
              const overdue = t.status === "OPEN" && t.dueAt && t.dueAt.getTime() < now;
              return (
                <li key={t.id} className={`tk-item tk-${t.priority.toLowerCase()}${overdue ? " tk-overdue" : ""}`}>
                  <details open={sp.open === t.id}>
                    <summary>
                      <span className="tk-type">{TASK_TYPES[t.type] ?? t.type}</span>
                      <strong>{t.title}</strong>
                      {t.patient && <span className="muted"> · {patientName(t.patient)}</span>}
                      <span className="tk-meta">
                        {t.priority !== "NORMAL" && <span className={`cn-status ${t.priority === "URGENT" || t.priority === "HIGH" ? "cn-cancelled" : "cn-expired"}`}>{TASK_PRIORITIES[t.priority]}</span>}
                        {t.dueAt && <span className={overdue ? "gw-missing" : "muted"}>due {formatDate(t.dueAt)}</span>}
                        <span className="muted">{who(t)}</span>
                        <span className="muted">{formatDate(t.createdAt)}</span>
                        {t.comments.length > 0 && <span className="muted">💬 {t.comments.length}</span>}
                      </span>
                    </summary>
                    <div className="tk-body">
                      <p className="muted cn-small">
                        From {t.createdById ? (name.get(t.createdById) ?? "a user") : "CareHub (automatic)"} · {formatDate(t.createdAt)} {formatTime(t.createdAt)}
                        {t.status === "DONE" && t.completedAt ? ` · done ${formatDate(t.completedAt)} by ${name.get(t.completedById ?? "") ?? "—"}` : ""}
                      </p>
                      {t.body && <p className="tk-text">{t.body}</p>}
                      <div className="cn-actions">
                        {t.link && (
                          <Link className="btn secondary gw-mini" href={t.link}>
                            Open
                          </Link>
                        )}
                        {t.patient && t.link !== `/patients/${t.patient.id}` && (
                          <Link className="btn ghost gw-mini" href={`/patients/${t.patient.id}`}>
                            Patient chart
                          </Link>
                        )}
                      </div>
                      {t.comments.length > 0 && (
                        <ul className="tk-comments">
                          {t.comments.map((c) => (
                            <li key={c.id}>
                              <strong>{c.userId ? (name.get(c.userId) ?? "User") : "CareHub"}</strong> <span className="muted cn-small">{formatDate(c.createdAt)} {formatTime(c.createdAt)}</span>
                              <div>{c.body}</div>
                            </li>
                          ))}
                        </ul>
                      )}
                      {t.status === "OPEN" ? (
                        <div className="tk-actions">
                          <form action={commentTask.bind(null, t.id)} className="cn-inline">
                            <input name="body" placeholder="Reply or add a note" aria-label="Reply" />
                            {t.createdById && t.createdById !== user.id && (
                              <label className="checkbox-inline">
                                <input type="checkbox" name="sendBack" /> Send back to sender
                              </label>
                            )}
                            <button className="btn ghost gw-mini" type="submit">
                              Post
                            </button>
                          </form>
                          <form action={reassignTask.bind(null, t.id)} className="cn-inline">
                            <select name="assignee" defaultValue="" aria-label="Reassign">
                              <option value="">Reassign to…</option>
                              <option value="me">Me</option>
                              {assignOptions}
                            </select>
                            <button className="btn ghost gw-mini" type="submit">
                              Move
                            </button>
                          </form>
                          <form action={completeTask.bind(null, t.id)} className="cn-inline">
                            <input type="hidden" name="back" value={`/tasks?view=${view}`} />
                            <input name="note" placeholder="Outcome (optional)" aria-label="Outcome" />
                            <button className="btn secondary gw-mini" type="submit">
                              Mark done
                            </button>
                          </form>
                        </div>
                      ) : (
                        <form action={reopenTask.bind(null, t.id)}>
                          <button className="btn ghost gw-mini" type="submit">
                            Reopen
                          </button>
                        </form>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="panel" id="new">
        <h2>New task or message</h2>
        <form action={newTask} className="form-grid gw-grid-3">
          <label>
            Type
            <select name="type" defaultValue="MESSAGE">
              {Object.entries(TASK_TYPES).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Send to
            <select name="assignee" defaultValue={sp.to ?? ""} required>
              <option value="">Choose…</option>
              {assignOptions}
            </select>
          </label>
          <label>
            Patient (optional)
            <select name="patientId" defaultValue={sp.patientId ?? ""}>
              <option value="">—</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {patientName(p)} · {p.mrn}
                </option>
              ))}
            </select>
          </label>
          <label className="gw-span-2">
            Subject
            <input name="title" required maxLength={200} placeholder="e.g. Please call patient about lab results" />
          </label>
          <label>
            Priority
            <select name="priority" defaultValue="NORMAL">
              {Object.entries(TASK_PRIORITIES).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="gw-span-2">
            Message
            <textarea name="body" rows={3} maxLength={4000} />
          </label>
          <label>
            Due (optional)
            <input type="date" name="dueAt" />
          </label>
          <button className="btn" type="submit">
            Send
          </button>
        </form>
      </section>
    </div>
  );
}
