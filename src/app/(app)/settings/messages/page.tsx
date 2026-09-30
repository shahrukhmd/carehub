import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, formatTime } from "@/lib/format";
import { SettingsNav } from "../settings-nav";
import { isMessageLive } from "@/lib/system-messages";
import { deleteSystemMessage, saveSystemMessage } from "./actions";

const pad = (n: number) => String(n).padStart(2, "0");
const dateValue = (d: Date | null) => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "");
const timeValue = (d: Date | null) => (d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : "");

export default async function SystemMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; saved?: string; error?: string; inactive?: string }>;
}) {
  const user = await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const messages = await prisma.systemMessage.findMany({
    where: { practiceId: user.practiceId, ...(sp.inactive ? {} : { active: true }) },
    orderBy: { createdAt: "desc" },
  });
  const editing = sp.edit ? await prisma.systemMessage.findFirst({ where: { id: sp.edit, practiceId: user.practiceId } }) : null;
  const now = new Date();

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link>
          </p>
          <h1>System messages</h1>
        </div>
        <Link className="muted" href={sp.inactive ? "/settings/messages" : "/settings/messages?inactive=1"}>
          {sp.inactive ? "Hide inactive messages" : "Include inactive messages"}
        </Link>
      </div>
      <SettingsNav current="messages" />
      {sp.saved && <p className="notice-ok">Saved.</p>}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      <div className="two-col">
        <section className="panel">
          <h2>Messages</h2>
          <p className="muted">Live messages show as a banner at the top of CareHub for everyone in this facility.</p>
          <table>
            <thead>
              <tr>
                <th>Message</th>
                <th>Shows</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>{m.title}</strong>{" "}
                    <span className={`gw-tag gw-tag-${isMessageLive(m, now) ? "ok" : "muted"}`}>{isMessageLive(m, now) ? "Live" : m.active ? "Scheduled / ended" : "Inactive"}</span>
                    <div className="muted">{m.message.slice(0, 140)}</div>
                  </td>
                  <td className="muted">
                    {m.activeFrom ? `${formatDate(m.activeFrom)} ${formatTime(m.activeFrom)}` : "Now"} →{" "}
                    {m.activeTo ? `${formatDate(m.activeTo)} ${formatTime(m.activeTo)}` : "until turned off"}
                  </td>
                  <td>
                    <Link href={`/settings/messages?edit=${m.id}`}>Edit</Link>
                  </td>
                </tr>
              ))}
              {messages.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    No messages.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <form action={saveSystemMessage.bind(null, editing?.id ?? "new")} className="panel stack">
          <div className="gw-section-head">
            <h2>{editing ? "Edit message details" : "Add message"}</h2>
            {editing && <Link href="/settings/messages">+ New message</Link>}
          </div>
          <label>
            Title
            <input name="title" required defaultValue={editing?.title ?? ""} />
          </label>
          <div className="form-grid">
            <label>
              Type
              <select name="level" defaultValue={editing?.level ?? "INFO"}>
                <option value="INFO">Information</option>
                <option value="WARNING">Warning</option>
                <option value="URGENT">Urgent</option>
              </select>
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="active" defaultChecked={editing?.active ?? true} /> Active
            </label>
            <label>
              Message active from
              <input type="date" name="fromDate" defaultValue={dateValue(editing?.activeFrom ?? null)} />
            </label>
            <label>
              Start time
              <input type="time" name="fromTime" defaultValue={timeValue(editing?.activeFrom ?? null)} />
            </label>
            <label>
              Message active to
              <input type="date" name="toDate" defaultValue={dateValue(editing?.activeTo ?? null)} />
            </label>
            <label>
              End time
              <input type="time" name="toTime" defaultValue={timeValue(editing?.activeTo ?? null)} />
            </label>
          </div>
          <label>
            Message
            <textarea name="message" required rows={5} defaultValue={editing?.message ?? ""} />
          </label>
          <div className="vw-step-actions">
            <button className="btn" type="submit">
              Save
            </button>
          </div>
        </form>
      </div>
      {editing && (
        <form action={deleteSystemMessage.bind(null, editing.id)}>
          <button className="btn ghost" type="submit">
            Delete this message
          </button>
        </form>
      )}
    </div>
  );
}
