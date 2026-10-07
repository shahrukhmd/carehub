import Link from "next/link";
import QRCode from "qrcode";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, formatTime, patientName } from "@/lib/format";
import { parseFields } from "@/lib/chart-forms";
import { CONNECT_ROLES, ensureConnectSetup, publicBase } from "@/lib/connect/core";
import { getVisitTypes, visitTypeNames } from "@/lib/scheduler-setup";
import { CopyButton } from "@/components/CopyButton";
import {
  cancelRequest,
  createPatientForm,
  deleteRule,
  remindAppointment,
  resendRequest,
  runAutomationsNow,
  saveConnectSettings,
  savePacket,
  saveKiosk,
  saveRule,
  sendPacket,
  toggleKiosk,
  cancelPaymentLink,
  reviewBooking,
  saveBookingSettings,
  savePaymentSettings,
  sendPaymentLink,
} from "./actions";
import { PAYMENT_PROVIDERS, PAYMENT_ROLES, patientBalance } from "@/lib/connect/payments";
import { testPaymentsAllowed } from "@/lib/connect/pay-session";
import { formatMoney } from "@/lib/format";
import { allowed, roleOf, type Subject } from "@/lib/permissions";

type Search = { payLink?: string; tab?: string; error?: string; saved?: string; sent?: string; ran?: string; reminded?: string; resent?: string; edit?: string; status?: string; patientId?: string; appointmentId?: string };

const TABS: [string, string, boolean][] = [
  ["overview", "Overview", false],
  ["requests", "Send forms", false],
  ["reminders", "Reminders", false],
  ["messages", "Messages", false],
  ["surveys", "Surveys", false],
  ["booking", "Online booking", false],
  ["payments", "Payments", false],
  ["packets", "Packets", true],
  ["forms", "Patient forms", true],
  ["automations", "Automations", true],
  ["kiosk", "Kiosk", true],
  ["settings", "Branding", true],
];

const REQUEST_STATUS: Record<string, string> = {
  SENT: "Sent",
  OPENED: "Opened",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  EXPIRED: "Expired",
  CANCELLED: "Withdrawn",
};
const RULE_KIND: Record<string, string> = { INTAKE_PACKET: "Send forms", REMINDER: "Appointment reminder", SURVEY: "Satisfaction survey" };
const CHANNEL: Record<string, string> = { SMS: "Text", EMAIL: "Email", BOTH: "Text + email", LINK: "Link", KIOSK: "Kiosk" };

async function base() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return publicBase(host ? `${h.get("x-forwarded-proto") ?? "http"}://${host}` : null);
}

const qr = (url: string) => QRCode.toString(url, { type: "svg", margin: 1, width: 132, errorCorrectionLevel: "M" });

export default async function ConnectPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(CONNECT_ROLES);
  const sp = await searchParams;
  const admin = user.role === "ADMIN";
  const tabs = TABS.filter(([, , adminOnly]) => admin || !adminOnly);
  const tab = tabs.some(([k]) => k === sp.tab) ? sp.tab! : "overview";
  await ensureConnectSetup(user.practiceId);
  const settings = await prisma.connectSettings.findUniqueOrThrow({ where: { practiceId: user.practiceId } });
  const mock = settings.smsProvider === "MOCK" || settings.emailProvider === "MOCK";

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">Patient engagement</p>
          <h1>Patient Connect</h1>
        </div>
        <p className="muted" style={{ margin: 0, textAlign: "right", maxWidth: "28rem" }}>
          Digital intake forms, e-signed consents, reminders, check-in kiosk and patient surveys.
        </p>
      </div>
      <nav className="view-tabs" style={{ width: "fit-content", flexWrap: "wrap" }}>
        {tabs.map(([k, l]) => (
          <Link key={k} href={`/connect?tab=${k}`} className={`view-tab${tab === k ? " active" : ""}`}>
            {l}
          </Link>
        ))}
      </nav>
      {mock && (
        <p className="cn-note">
          <strong>Test mode:</strong> texts and emails are recorded in <Link href="/connect?tab=messages">Messages</Link> but not delivered until a Twilio (text) /
          SendGrid (email) account is connected. Use <em>Copy link</em> to share forms in the meantime.
        </p>
      )}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.saved && <p className="notice-ok">Saved.</p>}
      {sp.reminded && <p className="notice-ok">Reminder sent — see Messages.</p>}
      {sp.resent && <p className="notice-ok">Forms link sent again.</p>}
      {sp.ran !== undefined && <p className="notice-ok">Automations ran — {sp.ran} message{sp.ran === "1" ? "" : "s"} sent.</p>}
      {tab === "overview" && <Overview practiceId={user.practiceId} />}
      {tab === "requests" && <Requests practiceId={user.practiceId} sp={sp} />}
      {tab === "reminders" && <Reminders practiceId={user.practiceId} />}
      {tab === "messages" && <Messages practiceId={user.practiceId} />}
      {tab === "surveys" && <Surveys practiceId={user.practiceId} />}
      {tab === "packets" && <Packets practiceId={user.practiceId} edit={sp.edit} />}
      {tab === "forms" && <Forms practiceId={user.practiceId} />}
      {tab === "automations" && <Automations practiceId={user.practiceId} />}
      {tab === "kiosk" && <Kiosk practiceId={user.practiceId} />}
      {tab === "settings" && <Branding s={settings} />}
      {tab === "booking" && <Booking practiceId={user.practiceId} admin={admin} s={settings} />}
      {tab === "payments" && <Payments practiceId={user.practiceId} role={user} s={settings} payLink={sp.payLink} />}
    </div>
  );
}

// ---- Overview ----

async function Overview({ practiceId }: { practiceId: string }) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [requests, reminded, confirmed, noShows, surveys, review] = await Promise.all([
    prisma.intakeRequest.findMany({ where: { practiceId, createdAt: { gte: since } }, include: { appointment: true } }),
    prisma.appointment.count({ where: { practiceId, reminderSentAt: { gte: since } } }),
    prisma.appointment.count({ where: { practiceId, confirmedAt: { gte: since }, confirmedVia: "PATIENT_LINK" } }),
    prisma.appointment.count({ where: { practiceId, status: "NO_SHOW", startsAt: { gte: since } } }),
    prisma.surveyResponse.findMany({ where: { practiceId, respondedAt: { gte: since } }, select: { score: true } }),
    prisma.patientDocument.findMany({
      where: { practiceId, docType: "INTAKE_PACKET", status: "READ" },
      include: { patient: true },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
  ]);
  const sent = requests.filter((r) => r.status !== "CANCELLED");
  const done = sent.filter((r) => r.status === "COMPLETED");
  const early = done.filter((r) => r.appointment && r.completedAt && r.completedAt < r.appointment.startsAt).length;
  const withAppt = done.filter((r) => r.appointment).length;
  const scores = surveys.map((s) => s.score).filter((n): n is number => n !== null);
  const nps = scores.length ? Math.round(((scores.filter((n) => n >= 9).length - scores.filter((n) => n <= 6).length) / scores.length) * 100) : null;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

  return (
    <>
      <p className="muted" style={{ margin: 0 }}>
        Last 30 days
      </p>
      <section className="grid-stats">
        <Link className="stat" href="/connect?tab=requests">
          <span>Forms sent</span>
          <strong>{sent.length}</strong>
        </Link>
        <Link className="stat" href="/connect?tab=requests&status=COMPLETED">
          <span>Completion rate</span>
          <strong>{pct(done.length, sent.length)}</strong>
        </Link>
        <div className="stat">
          <span>Finished before the visit</span>
          <strong>{pct(early, withAppt)}</strong>
        </div>
        <Link className="stat" href="/connect?tab=reminders">
          <span>Reminders · confirmed by patient</span>
          <strong>
            {reminded} · {confirmed}
          </strong>
        </Link>
        <div className="stat">
          <span>No-shows</span>
          <strong>{noShows}</strong>
        </div>
        <Link className="stat" href="/connect?tab=surveys">
          <span>NPS ({scores.length} responses)</span>
          <strong>{nps ?? "—"}</strong>
        </Link>
      </section>
      <section className="panel">
        <h2>Completed packets awaiting review</h2>
        <p className="muted">Each completed packet is saved as a signed PDF in Patient documents with the answers ready to apply to the patient record.</p>
        {review.length === 0 ? (
          <p className="muted">Nothing waiting.</p>
        ) : (
          <table className="cn-table">
            <thead>
              <tr>
                <th>Received</th>
                <th>Patient</th>
                <th>Document</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {review.map((d) => (
                <tr key={d.id}>
                  <td>
                    {formatDate(d.createdAt)} {formatTime(d.createdAt)}
                  </td>
                  <td>{d.patient ? patientName(d.patient) : "—"}</td>
                  <td>{d.name}</td>
                  <td>
                    <Link className="btn secondary gw-mini" href={`/gateway/documents/${d.id}`}>
                      Review &amp; apply
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

// ---- Send forms / requests ----

async function Requests({ practiceId, sp }: { practiceId: string; sp: Search }) {
  const status = sp.status && REQUEST_STATUS[sp.status] ? sp.status : undefined;
  const [patients, packets, upcoming, requests, link] = await Promise.all([
    prisma.patient.findMany({ where: { practiceId }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 1000 }),
    prisma.intakePacket.findMany({ where: { practiceId, active: true }, orderBy: { name: "asc" } }),
    prisma.appointment.findMany({
      where: { practiceId, startsAt: { gte: new Date() }, status: { in: ["SCHEDULED", "CONFIRMED"] } },
      include: { patient: true },
      orderBy: { startsAt: "asc" },
      take: 200,
    }),
    prisma.intakeRequest.findMany({
      where: { practiceId, ...(status ? { status } : {}) },
      include: { patient: true, packet: true, appointment: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    base(),
  ]);
  const just = sp.sent ? requests.find((r) => r.id === sp.sent) : undefined;

  return (
    <>
      {just && (
        <section className="panel cn-sent">
          <div>
            <h2>Forms sent to {just.patient ? patientName(just.patient) : "patient"}</h2>
            <p className="muted">
              {just.sentTo ? `Sent to ${just.sentTo}.` : "Not sent by text/email — share this link or QR code."} The patient confirms their date of birth to open it.
            </p>
            <p>
              <code className="cn-link">{`${link}/p/${just.token}`}</code> <CopyButton text={`${link}/p/${just.token}`} />
            </p>
          </div>
          <div className="cn-qr" dangerouslySetInnerHTML={{ __html: await qr(`${link}/p/${just.token}`) }} />
        </section>
      )}
      <section className="panel">
        <h2>Send forms to a patient</h2>
        <form action={sendPacket} className="form-grid gw-grid-3">
          <label>
            Patient
            <select name="patientId" required defaultValue={sp.patientId ?? ""}>
              <option value="">Choose…</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {patientName(p)} · {formatDate(p.dob)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Forms
            <select name="packetId" required defaultValue={packets.find((p) => p.name === "New Patient Packet")?.id}>
              {packets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({(JSON.parse(p.templateKeys) as string[]).length} forms)
                </option>
              ))}
            </select>
          </label>
          <label>
            Send by
            <select name="channel" defaultValue="BOTH">
              <option value="BOTH">Text + email</option>
              <option value="SMS">Text message</option>
              <option value="EMAIL">Email</option>
              <option value="LINK">Don&apos;t send — just give me the link / QR</option>
            </select>
          </label>
          <label className="gw-span-2">
            For appointment (optional)
            <select name="appointmentId" defaultValue={sp.appointmentId ?? ""}>
              <option value="">Not linked to a visit</option>
              {upcoming.map((a) => (
                <option key={a.id} value={a.id}>
                  {formatDate(a.startsAt)} {formatTime(a.startsAt)} — {patientName(a.patient)}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" type="submit">
            Send forms
          </button>
        </form>
      </section>
      <section className="panel">
        <div className="cn-head">
          <h2>Form requests</h2>
          <nav className="cn-filters">
            <Link href="/connect?tab=requests" className={!status ? "active" : ""}>
              All
            </Link>
            {Object.entries(REQUEST_STATUS).map(([k, l]) => (
              <Link key={k} href={`/connect?tab=requests&status=${k}`} className={status === k ? "active" : ""}>
                {l}
              </Link>
            ))}
          </nav>
        </div>
        {requests.length === 0 ? (
          <p className="muted">No form requests yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="cn-table">
              <thead>
                <tr>
                  <th>Sent</th>
                  <th>Patient</th>
                  <th>Forms</th>
                  <th>Visit</th>
                  <th>Via</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const url = `${link}/p/${r.token}`;
                  const open = !["COMPLETED", "CANCELLED"].includes(r.status);
                  const keys = JSON.parse(r.packet.templateKeys) as string[];
                  return (
                    <tr key={r.id}>
                      <td>
                        {formatDate(r.createdAt)}
                        <div className="muted cn-small">{r.reminderCount ? `resent ×${r.reminderCount}` : `expires ${formatDate(r.expiresAt)}`}</div>
                      </td>
                      <td>{r.patient ? <Link href={`/patients/${r.patient.id}`}>{patientName(r.patient)}</Link> : <em className="muted">Walk-in (kiosk)</em>}</td>
                      <td>{r.packet.name}</td>
                      <td>{r.appointment ? `${formatDate(r.appointment.startsAt)} ${formatTime(r.appointment.startsAt)}` : "—"}</td>
                      <td>{CHANNEL[r.channel] ?? r.channel}</td>
                      <td>
                        <span className={`cn-status cn-${r.status.toLowerCase()}`}>{REQUEST_STATUS[r.status] ?? r.status}</span>
                        {r.status === "IN_PROGRESS" && (
                          <div className="muted cn-small">
                            step {Math.min(r.currentStep + 1, keys.length)} of {keys.length}
                          </div>
                        )}
                        {r.completedAt && <div className="muted cn-small">{formatDate(r.completedAt)}</div>}
                      </td>
                      <td className="cn-actions">
                        {r.documentId && (
                          <Link className="btn secondary gw-mini" href={`/gateway/documents/${r.documentId}`}>
                            Review
                          </Link>
                        )}
                        {open && <CopyButton text={url} />}
                        {open && r.patient && (
                          <form action={resendRequest.bind(null, r.id)}>
                            <input type="hidden" name="channel" value="BOTH" />
                            <button className="btn ghost gw-mini" type="submit">
                              Resend
                            </button>
                          </form>
                        )}
                        {open && (
                          <form action={cancelRequest.bind(null, r.id)}>
                            <button className="btn ghost gw-mini" type="submit">
                              Withdraw
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// ---- Reminders ----

async function Reminders({ practiceId }: { practiceId: string }) {
  const now = new Date();
  const appts = await prisma.appointment.findMany({
    where: { practiceId, startsAt: { gte: now, lte: new Date(now.getTime() + 7 * 86_400_000) }, status: { notIn: ["CANCELLED"] } },
    include: { patient: true, provider: true, location: true },
    orderBy: { startsAt: "asc" },
    take: 300,
  });
  return (
    <section className="panel">
      <h2>Upcoming appointments — next 7 days</h2>
      <p className="muted">
        Patients get a link to confirm or cancel. Turn on automatic reminders in {""}
        <Link href="/connect?tab=automations">Automations</Link>.
      </p>
      {appts.length === 0 ? (
        <p className="muted">No appointments in the next 7 days.</p>
      ) : (
        <div className="table-scroll">
          <table className="cn-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Patient</th>
                <th>Provider · location</th>
                <th>Reminder</th>
                <th>Patient response</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {appts.map((a) => (
                <tr key={a.id}>
                  <td>
                    {formatDate(a.startsAt)} {formatTime(a.startsAt)}
                  </td>
                  <td>{patientName(a.patient)}</td>
                  <td>
                    {a.provider.name} · {a.location.name}
                  </td>
                  <td>{a.reminderSentAt ? `${formatDate(a.reminderSentAt)} ${formatTime(a.reminderSentAt)}` : <span className="muted">Not sent</span>}</td>
                  <td>
                    {a.confirmedAt ? (
                      <span className="cn-status cn-completed">Confirmed {formatDate(a.confirmedAt)}</span>
                    ) : a.status === "CANCELLED" ? (
                      <span className="cn-status cn-cancelled">Cancelled</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <form action={remindAppointment.bind(null, a.id)}>
                      <button className="btn ghost gw-mini" type="submit">
                        {a.reminderSentAt ? "Send again" : "Send reminder"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---- Messages ----

async function Messages({ practiceId }: { practiceId: string }) {
  const msgs = await prisma.messageLog.findMany({ where: { practiceId }, orderBy: { createdAt: "desc" }, take: 200 });
  const patients = new Map(
    (await prisma.patient.findMany({ where: { id: { in: [...new Set(msgs.map((m) => m.patientId).filter((x): x is string => Boolean(x)))] } } })).map((p) => [p.id, p])
  );
  return (
    <section className="panel">
      <h2>Message log</h2>
      <p className="muted">Every text and email Patient Connect sends — most recent 200.</p>
      {msgs.length === 0 ? (
        <p className="muted">No messages yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="cn-table">
            <thead>
              <tr>
                <th>Sent</th>
                <th>Patient</th>
                <th>Type</th>
                <th>To</th>
                <th>Message</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {msgs.map((m) => {
                const p = m.patientId ? patients.get(m.patientId) : undefined;
                return (
                  <tr key={m.id}>
                    <td>
                      {formatDate(m.createdAt)} {formatTime(m.createdAt)}
                    </td>
                    <td>{p ? patientName(p) : "—"}</td>
                    <td>
                      {m.channel === "SMS" ? "Text" : "Email"} · {m.kind.toLowerCase()}
                    </td>
                    <td>{m.to}</td>
                    <td className="cn-body">
                      <details>
                        <summary>{m.subject ?? m.body.slice(0, 60)}</summary>
                        <pre>{m.body}</pre>
                      </details>
                    </td>
                    <td>
                      <span className={`cn-status ${m.status === "SENT" ? "cn-completed" : "cn-cancelled"}`}>{m.status === "SENT" ? (m.provider === "MOCK" ? "Recorded (test)" : "Sent") : "Failed"}</span>
                      {m.error && <div className="muted cn-small">{m.error}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---- Surveys ----

async function Surveys({ practiceId }: { practiceId: string }) {
  const rows = await prisma.surveyResponse.findMany({ where: { practiceId }, include: { patient: true, appointment: { include: { provider: true } } }, orderBy: { sentAt: "desc" }, take: 300 });
  const answered = rows.filter((r) => r.score !== null);
  const promoters = answered.filter((r) => r.score! >= 9).length;
  const detractors = answered.filter((r) => r.score! <= 6).length;
  const nps = answered.length ? Math.round(((promoters - detractors) / answered.length) * 100) : null;
  return (
    <>
      <section className="grid-stats">
        <div className="stat">
          <span>Net Promoter Score</span>
          <strong>{nps ?? "—"}</strong>
        </div>
        <div className="stat">
          <span>Response rate</span>
          <strong>{rows.length ? `${Math.round((answered.length / rows.length) * 100)}%` : "—"}</strong>
        </div>
        <div className="stat">
          <span>Promoters (9–10)</span>
          <strong>{promoters}</strong>
        </div>
        <div className="stat">
          <span>Detractors (0–6)</span>
          <strong>{detractors}</strong>
        </div>
      </section>
      <section className="panel">
        <h2>Survey responses</h2>
        {rows.length === 0 ? (
          <p className="muted">No surveys sent yet. Turn on the post-visit survey in Automations.</p>
        ) : (
          <table className="cn-table">
            <thead>
              <tr>
                <th>Sent</th>
                <th>Patient</th>
                <th>Provider</th>
                <th>Score</th>
                <th>Comment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.sentAt)}</td>
                  <td>{patientName(r.patient)}</td>
                  <td>{r.appointment?.provider.name ?? "—"}</td>
                  <td>{r.score === null ? <span className="muted">No reply</span> : <span className={`cn-score ${r.score >= 9 ? "hi" : r.score <= 6 ? "lo" : ""}`}>{r.score}</span>}</td>
                  <td>{r.comment ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

// ---- Packets ----

async function Packets({ practiceId, edit }: { practiceId: string; edit?: string }) {
  const [packets, forms] = await Promise.all([
    prisma.intakePacket.findMany({ where: { practiceId }, include: { _count: { select: { requests: true } } }, orderBy: { name: "asc" } }),
    prisma.documentTemplate.findMany({ where: { practiceId, audience: "PATIENT", active: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const name = new Map(forms.map((f) => [f.key, f.name]));
  const editing = edit === "new" ? null : packets.find((p) => p.id === edit);
  return (
    <>
      <section className="panel">
        <div className="cn-head">
          <h2>Form packets</h2>
          <Link className="btn secondary gw-mini" href="/connect?tab=packets&edit=new">
            + New packet
          </Link>
        </div>
        <p className="muted">A packet is the set of forms a patient fills in, in order, from one link.</p>
        <table className="cn-table">
          <thead>
            <tr>
              <th>Packet</th>
              <th>Forms</th>
              <th>Sent</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {packets.map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>{p.name}</strong>
                  {p.description && <div className="muted cn-small">{p.description}</div>}
                </td>
                <td className="cn-small">{(JSON.parse(p.templateKeys) as string[]).map((k) => name.get(k) ?? k).join(" → ")}</td>
                <td>{p._count.requests}</td>
                <td>{p.active ? "Active" : <span className="muted">Off</span>}</td>
                <td>
                  <Link className="btn ghost gw-mini" href={`/connect?tab=packets&edit=${p.id}`}>
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {(edit === "new" || editing) && <PacketEditor packet={editing ?? null} forms={forms} />}
    </>
  );
}

function PacketEditor({
  packet,
  forms,
}: {
  packet: { id: string; name: string; description: string | null; templateKeys: string; active: boolean } | null;
  forms: { key: string; name: string; description: string | null }[];
}) {
  const chosen = packet ? (JSON.parse(packet.templateKeys) as string[]) : [];
  const ordered = [...forms].sort((a, b) => {
    const ia = chosen.indexOf(a.key);
    const ib = chosen.indexOf(b.key);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  return (
    <section className="panel" id="edit">
      <h2>{packet ? `Edit ${packet.name}` : "New packet"}</h2>
      <form action={savePacket.bind(null, packet?.id ?? "new")} className="stack">
        <div className="form-grid gw-grid-3">
          <label>
            Name
            <input name="name" required defaultValue={packet?.name ?? ""} />
          </label>
          <label className="gw-span-2">
            Description
            <input name="description" defaultValue={packet?.description ?? ""} />
          </label>
        </div>
        <table className="cn-table">
          <thead>
            <tr>
              <th>Include</th>
              <th>Order</th>
              <th>Form</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((f) => {
              const i = chosen.indexOf(f.key);
              return (
                <tr key={f.key}>
                  <td>
                    <input type="checkbox" name="forms" value={f.key} defaultChecked={i >= 0} aria-label={`Include ${f.name}`} />
                  </td>
                  <td>
                    <input className="cn-order" type="number" name={`order_${f.key}`} defaultValue={i >= 0 ? i + 1 : ""} min={1} max={99} aria-label="Order" />
                  </td>
                  <td>
                    {f.name}
                    {f.description && <div className="muted cn-small">{f.description}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <label className="checkbox-inline">
          <input type="checkbox" name="active" defaultChecked={packet?.active ?? true} /> Active (can be sent)
        </label>
        <div>
          <button className="btn" type="submit">
            Save packet
          </button>{" "}
          <Link className="btn ghost" href="/connect?tab=packets">
            Cancel
          </Link>
        </div>
      </form>
    </section>
  );
}

// ---- Patient forms ----

async function Forms({ practiceId }: { practiceId: string }) {
  const forms = await prisma.documentTemplate.findMany({ where: { practiceId, audience: "PATIENT" }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return (
    <section className="panel">
      <h2>Patient forms</h2>
      <p className="muted">
        Forms patients fill in on their phone. Open a form in the designer to add or change questions — use <em>Consent</em> and <em>Signature</em> fields
        for e-signed documents and <em>File</em> for card/ID photos. Answers mapped to patient fields fill the chart when staff apply the packet.
      </p>
      <form action={createPatientForm} className="cn-inline">
        <input name="name" placeholder="New form name (e.g. Nutrition questionnaire)" required />
        <button className="btn secondary" type="submit">
          + Design a new patient form
        </button>
      </form>
      <table className="cn-table">
        <thead>
          <tr>
            <th>Form</th>
            <th>Questions</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {forms.map((f) => {
            const fields = parseFields(f.fields);
            return (
              <tr key={f.id}>
                <td>
                  <strong>{f.name}</strong>
                  {f.description && <div className="muted cn-small">{f.description}</div>}
                </td>
                <td>
                  {fields.length}
                  {fields.some((x) => x.type === "signature") && <span className="cn-tag">e-sign</span>}
                  {fields.some((x) => x.type === "file") && <span className="cn-tag">upload</span>}
                </td>
                <td>{f.active ? (f.standard ? "Standard" : "Custom") : <span className="muted">Off</span>}</td>
                <td>
                  <Link className="btn ghost gw-mini" href={`/settings/documentation/templates/${f.id}`}>
                    Design
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// ---- Automations ----

async function Automations({ practiceId }: { practiceId: string }) {
  const [rules, packets, types] = await Promise.all([
    prisma.automationRule.findMany({ where: { practiceId }, orderBy: [{ kind: "asc" }, { offsetHours: "desc" }] }),
    prisma.intakePacket.findMany({ where: { practiceId, active: true }, orderBy: { name: "asc" } }),
    getVisitTypes(practiceId),
  ]);
  const ruleForm = (r: (typeof rules)[number] | null) => (
    <form action={saveRule.bind(null, r?.id ?? "new")} className="cn-rule">
      <label>
        Name
        <input name="name" defaultValue={r?.name ?? ""} placeholder="e.g. Reminder — day before" />
      </label>
      <label>
        Sends
        <select name="kind" defaultValue={r?.kind ?? "REMINDER"}>
          {Object.entries(RULE_KIND).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        Hours before visit (surveys: after)
        <input type="number" name="offsetHours" min={1} max={720} required defaultValue={r?.offsetHours ?? 24} />
      </label>
      <label>
        By
        <select name="channel" defaultValue={r?.channel ?? "BOTH"}>
          <option value="BOTH">Text + email</option>
          <option value="SMS">Text</option>
          <option value="EMAIL">Email</option>
        </select>
      </label>
      <label>
        Packet (for forms)
        <select name="packetId" defaultValue={r?.packetId ?? ""}>
          <option value="">—</option>
          {packets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="cn-types">
        <legend>Visit types (none = all)</legend>
        {types.map((t) => (
          <label key={t.code} className="checkbox-inline">
            <input type="checkbox" name="visitTypes" value={t.code} defaultChecked={(r?.visitTypes ?? "").split(",").includes(t.code)} /> {t.name}
          </label>
        ))}
      </fieldset>
      <label className="checkbox-inline">
        <input type="checkbox" name="onlyNewPatients" defaultChecked={r?.onlyNewPatients ?? false} /> New patients only
      </label>
      <label className="checkbox-inline">
        <input type="checkbox" name="active" defaultChecked={r?.active ?? true} /> On
      </label>
      <button className="btn secondary gw-mini" type="submit">
        {r ? "Save" : "Add rule"}
      </button>
    </form>
  );
  return (
    <>
      <section className="panel">
        <div className="cn-head">
          <h2>Automations</h2>
          <form action={runAutomationsNow}>
            <button className="btn secondary gw-mini" type="submit">
              Run now
            </button>
          </form>
        </div>
        <p className="muted">
          Rules check the schedule every 15 minutes and send what&apos;s due. Each patient gets each message only once per appointment. Rules ship switched off
          — review them, then turn them on.
        </p>
        {rules.map((r) => (
          <div key={r.id} className={`cn-rule-card${r.active ? " on" : ""}`}>
            <div className="cn-rule-top">
              <strong>{r.name}</strong>
              <span className={`cn-status ${r.active ? "cn-completed" : "cn-expired"}`}>{r.active ? "On" : "Off"}</span>
              <span className="muted cn-small">
                {RULE_KIND[r.kind]} · {r.offsetHours}h {r.kind === "SURVEY" ? "after" : "before"} the visit
                {r.lastRunAt ? ` · last checked ${formatDate(r.lastRunAt)} ${formatTime(r.lastRunAt)}` : ""}
              </span>
              <form action={deleteRule.bind(null, r.id)}>
                <button className="btn ghost gw-mini" type="submit">
                  Delete
                </button>
              </form>
            </div>
            {ruleForm(r)}
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>New rule</h2>
        {ruleForm(null)}
      </section>
    </>
  );
}

// ---- Kiosk ----

async function Kiosk({ practiceId }: { practiceId: string }) {
  const [links, packets, locations, url] = await Promise.all([
    prisma.kioskLink.findMany({ where: { practiceId }, include: { packet: true }, orderBy: { createdAt: "asc" } }),
    prisma.intakePacket.findMany({ where: { practiceId, active: true }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { practiceId }, orderBy: { name: "asc" } }),
    base(),
  ]);
  const loc = new Map(locations.map((l) => [l.id, l.name]));
  const qrs = await Promise.all(links.map((k) => qr(`${url}/k/${k.token}`)));
  return (
    <>
      <section className="panel">
        <h2>Check-in kiosk</h2>
        <p className="muted">
          Open a kiosk link on a front-desk tablet, or print the QR code for the waiting room. Walk-ins enter their name and date of birth, fill in the packet,
          and the completed forms land in Patient documents for the team to match and apply.
        </p>
        <div className="cn-kiosks">
          {links.map((k, i) => (
            <div key={k.id} className={`cn-kiosk${k.active ? "" : " off"}`}>
              <div className="cn-qr" dangerouslySetInnerHTML={{ __html: qrs[i] }} />
              <div>
                <strong>{k.name}</strong>
                <div className="muted cn-small">
                  {k.packet.name}
                  {k.locationId ? ` · ${loc.get(k.locationId) ?? ""}` : ""}
                </div>
                <div className="cn-actions">
                  <a className="btn secondary gw-mini" href={`/k/${k.token}`} target="_blank" rel="noreferrer">
                    Open kiosk
                  </a>
                  <CopyButton text={`${url}/k/${k.token}`} />
                  <form action={toggleKiosk.bind(null, k.id)}>
                    <button className="btn ghost gw-mini" type="submit">
                      {k.active ? "Turn off" : "Turn on"}
                    </button>
                  </form>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>New kiosk link</h2>
        <form action={saveKiosk} className="form-grid gw-grid-3">
          <label>
            Name
            <input name="name" placeholder="Front desk tablet" />
          </label>
          <label>
            Packet
            <select name="packetId" required>
              {packets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Location
            <select name="locationId">
              <option value="">Any</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" type="submit">
            Create kiosk link
          </button>
        </form>
      </section>
    </>
  );
}

// ---- Branding ----

function Branding({ s }: { s: Awaited<ReturnType<typeof prisma.connectSettings.findUniqueOrThrow>> }) {
  return (
    <section className="panel">
      <h2>Patient-facing branding &amp; messaging</h2>
      <form action={saveConnectSettings} className="stack">
        <div className="form-grid gw-grid-3">
          <label>
            Practice name patients see
            <input name="displayName" defaultValue={s.displayName ?? ""} />
          </label>
          <label>
            Brand colour
            <input type="color" name="brandColor" defaultValue={s.brandColor} />
          </label>
          <label>
            Button colour
            <input type="color" name="accentColor" defaultValue={s.accentColor} />
          </label>
          <label className="gw-span-2">
            Welcome message
            <textarea name="welcomeText" rows={2} defaultValue={s.welcomeText ?? ""} placeholder="Please complete these forms before your visit so we can see you on time." />
          </label>
          <label>
            Office phone (shown to patients)
            <input name="supportPhone" defaultValue={s.supportPhone ?? ""} />
          </label>
          <label>
            Logo (PNG/JPG, under 200 KB)
            <input type="file" name="logo" accept="image/png,image/jpeg" />
          </label>
          <div>
            {s.logo ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.logo} alt="Current logo" className="cn-logo" />
                <label className="checkbox-inline">
                  <input type="checkbox" name="removeLogo" /> Remove logo
                </label>
              </>
            ) : (
              <span className="muted">No logo uploaded</span>
            )}
          </div>
          <label>
            Form links expire after (days)
            <input type="number" name="linkDays" min={1} max={60} defaultValue={s.linkDays} />
          </label>
          <label>
            Text messages via
            <select name="smsProvider" defaultValue={s.smsProvider}>
              <option value="MOCK">Test mode (not delivered)</option>
              <option value="TWILIO">Twilio (needs account)</option>
            </select>
          </label>
          <label>
            Email via
            <select name="emailProvider" defaultValue={s.emailProvider}>
              <option value="MOCK">Test mode (not delivered)</option>
              <option value="SENDGRID">SendGrid (needs account)</option>
            </select>
          </label>
        </div>
        <p className="muted cn-small">
          Patients reach the forms at the address in <code>CAREHUB_PUBLIC_URL</code> (currently {process.env.CAREHUB_PUBLIC_URL || "this server's address"}). For
          patients outside the office network, CareHub must be hosted at a public HTTPS address.
        </p>
        <div>
          <button className="btn" type="submit">
            Save branding
          </button>
        </div>
      </form>
    </section>
  );
}

// ---- Online booking ----

type Settings = Awaited<ReturnType<typeof prisma.connectSettings.findUniqueOrThrow>>;

async function Booking({ practiceId, admin, s }: { practiceId: string; admin: boolean; s: Settings }) {
  const typeName = await visitTypeNames(practiceId);
  const [requests, types, recent, url] = await Promise.all([
    prisma.appointment.findMany({ where: { practiceId, status: "REQUESTED" }, include: { patient: true, provider: true, location: true }, orderBy: { startsAt: "asc" } }),
    prisma.visitType.findMany({ where: { practiceId, active: true, onlineBooking: true }, orderBy: { name: "asc" } }),
    prisma.appointment.findMany({ where: { practiceId, bookingSource: "ONLINE", status: { not: "REQUESTED" } }, include: { patient: true }, orderBy: { createdAt: "desc" }, take: 20 }),
    base(),
  ]);
  const link = s.bookingToken ? `${url}/book/${s.bookingToken}` : null;
  return (
    <>
      <section className="panel">
        <div className="cn-head">
          <h2>Requests waiting for approval ({requests.length})</h2>
        </div>
        {requests.length === 0 ? (
          <p className="muted">No online requests waiting.</p>
        ) : (
          <table className="cn-table">
            <thead>
              <tr>
                <th>Requested time</th>
                <th>Patient</th>
                <th>Visit</th>
                <th>Details</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {requests.map((a) => (
                <tr key={a.id}>
                  <td>
                    {formatDate(a.startsAt)} {formatTime(a.startsAt)}
                    <div className="muted cn-small">received {formatDate(a.createdAt)}</div>
                  </td>
                  <td>
                    <Link href={`/patients/${a.patientId}`}>{patientName(a.patient)}</Link>
                    <div className="muted cn-small">
                      {formatDate(a.patient.dob)} · {a.patient.phone}
                    </div>
                  </td>
                  <td>
                    {typeName[a.visitType] ?? a.visitType}
                    <div className="muted cn-small">
                      {a.provider.name} · {a.location.name}
                    </div>
                  </td>
                  <td className="cn-small">{a.bookingNote}</td>
                  <td>
                    <form action={reviewBooking.bind(null, a.id)} className="cn-actions">
                      <button className="btn secondary gw-mini" type="submit" name="decision" value="approve">
                        Approve
                      </button>
                      <input name="note" placeholder="Reason if declining" aria-label="Decline reason" style={{ width: "10rem" }} />
                      <button className="btn ghost gw-mini" type="submit" name="decision" value="decline">
                        Decline
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="panel">
        <h2>Online booking page</h2>
        {link && s.bookingEnabled ? (
          <div className="cn-sent" style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
            <div className="cn-qr" dangerouslySetInnerHTML={{ __html: await qr(link) }} />
            <div>
              <p>
                <code className="cn-link">{link}</code> <CopyButton text={link} />
              </p>
              <p className="muted cn-small">Put this link on your website, Google Business profile and texts. Patients see open times from provider schedules.</p>
            </div>
          </div>
        ) : (
          <p className="muted">Online booking is off.</p>
        )}
        <p className="muted cn-small">
          Bookable visit types: {types.length ? types.map((t) => t.name).join(", ") : "none"} —{" "}
          {admin ? <Link href="/settings/scheduling?tab=types">choose in Scheduler admin</Link> : "set in Scheduler admin"}. Open times come from{" "}
          <Link href="/schedule/availability">provider availability</Link>, minus booked visits, reserved time, office hours and clinic closures.
        </p>
        {admin && (
          <form action={saveBookingSettings} className="form-grid gw-grid-3">
            <label className="checkbox-inline">
              <input type="checkbox" name="bookingEnabled" defaultChecked={s.bookingEnabled} /> Online booking on
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="bookingApproval" defaultChecked={s.bookingApproval} /> Staff approve each request
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="bookingNewPatients" defaultChecked={s.bookingNewPatients} /> New patients can book
            </label>
            <label>
              Earliest booking (hours from now)
              <input type="number" name="bookingLeadHours" min={0} max={336} defaultValue={s.bookingLeadHours} />
            </label>
            <label>
              Book up to (days ahead)
              <input type="number" name="bookingWindowDays" min={1} max={120} defaultValue={s.bookingWindowDays} />
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="newLink" /> Make a new link (old one stops working)
            </label>
            <label className="gw-span-3">
              Message on the booking page
              <input name="bookingMessage" defaultValue={s.bookingMessage ?? ""} placeholder="e.g. For new wounds please bring your medication list and insurance card." />
            </label>
            <button className="btn" type="submit">
              Save booking settings
            </button>
          </form>
        )}
      </section>
      {recent.length > 0 && (
        <section className="panel">
          <h2>Recent online bookings</h2>
          <table className="cn-table">
            <tbody>
              {recent.map((a) => (
                <tr key={a.id}>
                  <td>
                    {formatDate(a.startsAt)} {formatTime(a.startsAt)}
                  </td>
                  <td>{patientName(a.patient)}</td>
                  <td>{typeName[a.visitType] ?? a.visitType}</td>
                  <td>{a.status === "CANCELLED" ? <span className="cn-status cn-cancelled">{a.cancelReason ?? "Cancelled"}</span> : <span className="cn-status cn-completed">Booked</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

// ---- Payments ----

const PAY_STATUS: Record<string, string> = { SENT: "Sent", PAID: "Paid", CANCELLED: "Replaced / cancelled", EXPIRED: "Expired" };

async function Payments({ practiceId, role, s, payLink }: { practiceId: string; role: Subject; s: Settings; payLink?: string }) {
  const canSend = allowed(role, PAYMENT_ROLES);
  const [links, owing, url] = await Promise.all([
    prisma.patientPayment.findMany({ where: { practiceId }, include: { patient: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.patient.findMany({
      where: { practiceId, claims: { some: { balanceResponsibility: "PATIENT", status: { notIn: ["VOID", "PAID", "WRITTEN_OFF"] } } } },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 200,
    }),
    base(),
  ]);
  const balances = await Promise.all(owing.map(async (p) => ({ p, total: (await patientBalance(p.id)).totalCents })));
  const due = balances.filter((b) => b.total > 0);
  const just = payLink ? links.find((l) => l.id === payLink) : undefined;
  const paid30 = links.filter((l) => l.status === "PAID" && l.paidAt && l.paidAt.getTime() > Date.now() - 30 * 86_400_000);
  return (
    <>
      {just && (
        <section className="panel cn-sent">
          <div>
            <h2>Payment link for {patientName(just.patient)}</h2>
            <p>
              <code className="cn-link">{`${url}/pay/${just.token}`}</code> <CopyButton text={`${url}/pay/${just.token}`} />
            </p>
          </div>
        </section>
      )}
      <section className="grid-stats">
        <div className="stat">
          <span>Patients with a balance</span>
          <strong>{due.length}</strong>
        </div>
        <div className="stat">
          <span>Patient balances</span>
          <strong>{formatMoney(due.reduce((x, b) => x + b.total, 0))}</strong>
        </div>
        <div className="stat">
          <span>Paid online · 30 days</span>
          <strong>
            {paid30.length} · {formatMoney(paid30.reduce((x, l) => x + (l.amountCents ?? 0), 0))}
          </strong>
        </div>
      </section>
      {!s.paymentsEnabled && <p className="cn-note">Online payments are off. An administrator can turn them on below.</p>}
      <section className="panel">
        <h2>Patient balances</h2>
        {due.length === 0 ? (
          <p className="muted">No patient balances.</p>
        ) : (
          <table className="cn-table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Balance</th>
                <th>Contact</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {due.map(({ p, total }) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/patients/${p.id}`}>{patientName(p)}</Link>
                  </td>
                  <td>{formatMoney(total)}</td>
                  <td className="cn-small">{[p.phone, p.email].filter(Boolean).join(" · ") || "—"}</td>
                  <td>
                    {canSend && s.paymentsEnabled && (
                      <form action={sendPaymentLink.bind(null, p.id)} className="cn-actions">
                        <input type="hidden" name="back" value="/connect?tab=payments" />
                        <select name="channel" defaultValue="BOTH" aria-label="Send by">
                          <option value="BOTH">Text + email</option>
                          <option value="SMS">Text</option>
                          <option value="EMAIL">Email</option>
                          <option value="LINK">Link only</option>
                        </select>
                        <button className="btn secondary gw-mini" type="submit">
                          Send pay link
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="panel">
        <h2>Payment links</h2>
        {links.length === 0 ? (
          <p className="muted">None sent yet.</p>
        ) : (
          <table className="cn-table">
            <thead>
              <tr>
                <th>Sent</th>
                <th>Patient</th>
                <th>Balance</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id}>
                  <td>{formatDate(l.createdAt)}</td>
                  <td>{patientName(l.patient)}</td>
                  <td>{formatMoney(l.balanceCents)}</td>
                  <td>
                    <span className={`cn-status ${l.status === "PAID" ? "cn-completed" : l.status === "SENT" ? "cn-sent" : "cn-expired"}`}>{PAY_STATUS[l.status] ?? l.status}</span>
                    {l.status === "PAID" && (
                      <div className="muted cn-small">
                        {formatMoney(l.amountCents ?? 0)} on {l.paidAt ? formatDate(l.paidAt) : ""} · {l.providerRef}
                      </div>
                    )}
                  </td>
                  <td className="cn-actions">
                    {l.status === "SENT" && <CopyButton text={`${url}/pay/${l.token}`} />}
                    {l.status === "SENT" && canSend && (
                      <form action={cancelPaymentLink.bind(null, l.id)}>
                        <button className="btn ghost gw-mini" type="submit">
                          Cancel
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {roleOf(role) === "ADMIN" && (
        <section className="panel">
          <h2>Payment settings</h2>
          <form action={savePaymentSettings} className="form-grid gw-grid-3">
            <label className="checkbox-inline">
              <input type="checkbox" name="paymentsEnabled" defaultChecked={s.paymentsEnabled} /> Online payments on
            </label>
            <label>
              Card processor
              <select name="paymentProvider" defaultValue={s.paymentProvider}>
                {Object.entries(PAYMENT_PROVIDERS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn" type="submit">
              Save
            </button>
          </form>
          <p className="muted cn-small">
            Patients enter their card only on the processor&apos;s secure hosted page — CareHub never sees or stores card numbers. Stripe needs the practice&apos;s
            secret key set as <code>STRIPE_SECRET_KEY</code> on the server ({process.env.STRIPE_SECRET_KEY ? "set" : "not set"}). Test mode simulates payments and
            {testPaymentsAllowed() ? " is available on this server." : " is disabled on this production server."} Payments post as patient deposits (card) and apply
            to the oldest balances first.
          </p>
        </section>
      )}
    </>
  );
}
