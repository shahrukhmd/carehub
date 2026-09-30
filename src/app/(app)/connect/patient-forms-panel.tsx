import Link from "next/link";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { CONNECT_ROLES, ensureConnectSetup, publicBase } from "@/lib/connect/core";
import { CopyButton } from "@/components/CopyButton";
import { sendPacket } from "./actions";

const STATUS: Record<string, [string, string]> = {
  SENT: ["Sent", "info"],
  OPENED: ["Opened", "info"],
  IN_PROGRESS: ["In progress", "warn"],
  COMPLETED: ["Completed", "ok"],
  EXPIRED: ["Expired", "bad"],
  CANCELLED: ["Withdrawn", "bad"],
};

// "Send intake forms" box for the Gateway case and the patient chart.
export async function PatientFormsPanel({ practiceId, patientId, role, back }: { practiceId: string; patientId: string; role: string; back: string }) {
  await ensureConnectSetup(practiceId);
  const [packets, requests, upcoming] = await Promise.all([
    prisma.intakePacket.findMany({ where: { practiceId, active: true }, orderBy: { name: "asc" } }),
    prisma.intakeRequest.findMany({ where: { practiceId, patientId }, include: { packet: true }, orderBy: { createdAt: "desc" }, take: 6 }),
    prisma.appointment.findMany({ where: { practiceId, patientId, startsAt: { gte: new Date() }, status: { in: ["SCHEDULED", "CONFIRMED"] } }, orderBy: { startsAt: "asc" }, take: 5 }),
  ]);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const link = publicBase(host ? `${h.get("x-forwarded-proto") ?? "http"}://${host}` : null);
  const canSend = CONNECT_ROLES.includes(role);

  return (
    <section className="panel">
      <div className="gw-section-head">
        <h2>Patient forms (Patient Connect)</h2>
        <Link className="muted" href="/connect?tab=requests">
          All form requests
        </Link>
      </div>
      {requests.length > 0 && (
        <ul className="pd-list">
          {requests.map((r) => {
            const [label, tone] = STATUS[r.status] ?? [r.status, "info"];
            const open = !["COMPLETED", "CANCELLED", "EXPIRED"].includes(r.status);
            return (
              <li key={r.id}>
                {r.documentId ? <Link href={`/gateway/documents/${r.documentId}`}>{r.packet.name}</Link> : <span>{r.packet.name}</span>}
                <span className="muted">
                  sent {formatDate(r.createdAt)}
                  {r.completedAt ? ` · completed ${formatDate(r.completedAt)}` : ""}
                </span>
                <span className={`gw-tag gw-tag-${tone}`}>{label}</span>
                {open && <CopyButton text={`${link}/p/${r.token}`} />}
              </li>
            );
          })}
        </ul>
      )}
      {canSend && packets.length > 0 && (
        <form action={sendPacket} className="vw-inline pd-case-upload">
          <input type="hidden" name="patientId" value={patientId} />
          <input type="hidden" name="back" value={back} />
          <select name="packetId" aria-label="Forms to send" defaultValue={packets.find((p) => p.name === "New Patient Packet")?.id}>
            {packets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select name="channel" defaultValue="BOTH" aria-label="Send by">
            <option value="BOTH">Text + email</option>
            <option value="SMS">Text</option>
            <option value="EMAIL">Email</option>
            <option value="LINK">Link only</option>
          </select>
          {upcoming.length > 0 && (
            <select name="appointmentId" defaultValue={upcoming[0].id} aria-label="For appointment">
              <option value="">No visit</option>
              {upcoming.map((a) => (
                <option key={a.id} value={a.id}>
                  Visit {formatDate(a.startsAt)}
                </option>
              ))}
            </select>
          )}
          <button className="btn secondary gw-mini" type="submit">
            Send intake forms
          </button>
        </form>
      )}
    </section>
  );
}
