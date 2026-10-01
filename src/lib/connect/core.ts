import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/patient-docs";
import { formatDate, formatTime } from "@/lib/format";
import { DEFAULT_PACKETS, DEFAULT_RULES, PATIENT_TEMPLATES, RETIRED_TEMPLATES } from "@/lib/connect/patient-forms";

export const CONNECT_ROLES = ["ADMIN", "FRONT_DESK", "CLINICIAN", "INTAKE", "VERIFICATION", "SCHEDULER"];

export const newToken = () => randomBytes(24).toString("base64url");
export const hashToken = (v: string) => createHash("sha256").update(v).digest("hex");

// Links in texts/emails. Set CAREHUB_PUBLIC_URL to the address patients can reach (e.g. https://portal.example.com).
export function publicBase(requestOrigin?: string | null) {
  return (process.env.CAREHUB_PUBLIC_URL || requestOrigin || "http://localhost:3000").replace(/\/+$/, "");
}

// ---- Setup ----

const setups = new Map<string, Promise<void>>();

export function ensureConnectSetup(practiceId: string) {
  let run = setups.get(practiceId);
  if (!run) {
    run = setup(practiceId).catch((err) => {
      setups.delete(practiceId);
      throw err;
    });
    setups.set(practiceId, run);
  }
  return run;
}

async function setup(practiceId: string) {
  const have = new Set((await prisma.documentTemplate.findMany({ where: { practiceId }, select: { key: true } })).map((t) => t.key));
  const missing = PATIENT_TEMPLATES.filter((t) => !have.has(t.key));
  if (missing.length) {
    await prisma.documentTemplate.createMany({
      data: missing.map((t, i) => ({
        practiceId,
        key: t.key,
        name: t.name,
        description: t.description ?? null,
        section: "ADDITIONAL",
        kind: "FORM",
        audience: "PATIENT",
        fields: JSON.stringify(t.fields ?? []),
        standard: true,
        inProgressNote: false,
        sortOrder: 2000 + i * 10,
        noteOrder: 2000 + i * 10,
      })),
    });
  }
  const firstSetup = (await prisma.intakePacket.count({ where: { practiceId } })) === 0;
  if (!firstSetup && missing.length) await upgradePackets(practiceId, new Set(missing.map((t) => t.key)));
  if (firstSetup) {
    for (const p of DEFAULT_PACKETS) {
      await prisma.intakePacket.create({ data: { practiceId, name: p.name, description: p.description, templateKeys: JSON.stringify(p.keys) } });
    }
    const packets = await prisma.intakePacket.findMany({ where: { practiceId } });
    // Rules start switched off; turn them on in Patient Connect -> Automations.
    for (const r of DEFAULT_RULES) {
      await prisma.automationRule.create({
        data: {
          practiceId,
          name: r.name,
          kind: r.kind,
          offsetHours: r.offsetHours,
          channel: r.channel,
          packetId: r.packet ? (packets.find((p) => p.name === r.packet)?.id ?? null) : null,
          onlyNewPatients: Boolean(r.onlyNewPatients),
          active: false,
        },
      });
    }
    const first = packets.find((p) => p.name === "New Patient Packet");
    const loc = await prisma.location.findFirst({ where: { practiceId }, orderBy: { name: "asc" } });
    if (first) {
      await prisma.kioskLink.create({
        data: { practiceId, name: `Front desk check-in${loc ? ` — ${loc.name}` : ""}`, token: newToken(), packetId: first.id, locationId: loc?.id ?? null },
      });
    }
  }
  const practice = await prisma.practice.findUnique({ where: { id: practiceId } });
  await prisma.connectSettings.upsert({ where: { practiceId }, update: {}, create: { practiceId, displayName: practice?.name ?? null } });
}

// A practice set up before a batch of forms was added: its packets swap retired stock forms for their replacements,
// the retired forms are switched off, and the packets that come with the new forms are added (once, by name).
async function upgradePackets(practiceId: string, installed: Set<string>) {
  const retired = Object.entries(RETIRED_TEMPLATES).filter(([, to]) => !to || installed.has(to));
  if (retired.length) {
    const swap = new Map(retired);
    for (const p of await prisma.intakePacket.findMany({ where: { practiceId } })) {
      let keys: string[] = [];
      try {
        keys = JSON.parse(p.templateKeys);
      } catch {
        continue;
      }
      const next = [...new Set(keys.flatMap((k) => (swap.has(k) ? (swap.get(k) ? [swap.get(k)!] : []) : [k])))];
      if (next.join() !== keys.join()) await prisma.intakePacket.update({ where: { id: p.id }, data: { templateKeys: JSON.stringify(next) } });
    }
    await prisma.documentTemplate.updateMany({ where: { practiceId, key: { in: retired.map(([from]) => from) }, standard: true }, data: { active: false } });
  }
  const have = new Set((await prisma.intakePacket.findMany({ where: { practiceId }, select: { name: true } })).map((p) => p.name));
  for (const p of DEFAULT_PACKETS) {
    if (have.has(p.name) || !p.keys.some((k) => installed.has(k))) continue;
    await prisma.intakePacket.create({ data: { practiceId, name: p.name, description: p.description, templateKeys: JSON.stringify(p.keys) } });
  }
}

export async function getConnectSettings(practiceId: string) {
  await ensureConnectSetup(practiceId);
  return prisma.connectSettings.findUniqueOrThrow({ where: { practiceId } });
}

// ---- Messaging ----

// Test sender: validates and records the message; real SMS/email connectors (Twilio, SendGrid) plug in here.
export async function sendMessage(input: {
  practiceId: string;
  channel: "SMS" | "EMAIL";
  to: string | null | undefined;
  subject?: string;
  body: string;
  kind: "INTAKE" | "REMINDER" | "SURVEY" | "RECALL" | "OTHER";
  patientId?: string | null;
  appointmentId?: string | null;
  requestId?: string | null;
  ruleId?: string | null;
  userId?: string | null;
}) {
  const to = (input.to ?? "").trim();
  const valid = input.channel === "SMS" ? Boolean(normalizePhone(to)) : /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to);
  const settings = await prisma.connectSettings.findUnique({ where: { practiceId: input.practiceId } });
  const provider = input.channel === "SMS" ? (settings?.smsProvider ?? "MOCK") : (settings?.emailProvider ?? "MOCK");
  // No live connector is wired up yet: a real provider without credentials fails loudly rather than pretending to deliver.
  const error = !valid
    ? input.channel === "SMS"
      ? "No valid mobile number"
      : "No valid email address"
    : provider !== "MOCK"
      ? `${provider === "TWILIO" ? "Twilio" : "SendGrid"} is not connected yet — switch to test mode or add the account`
      : null;
  return prisma.messageLog.create({
    data: {
      practiceId: input.practiceId,
      channel: input.channel,
      to: to || "—",
      subject: input.subject ?? null,
      body: input.body.slice(0, 2000),
      kind: input.kind,
      status: error ? "FAILED" : "SENT",
      provider,
      error,
      patientId: input.patientId ?? null,
      appointmentId: input.appointmentId ?? null,
      requestId: input.requestId ?? null,
      ruleId: input.ruleId ?? null,
      createdById: input.userId ?? null,
    },
  });
}

function channels(channel: string): ("SMS" | "EMAIL")[] {
  return channel === "BOTH" ? ["SMS", "EMAIL"] : channel === "EMAIL" ? ["EMAIL"] : ["SMS"];
}

// ---- Intake requests ----

export async function createIntakeRequest(input: {
  practiceId: string;
  packetId: string;
  patientId: string | null;
  appointmentId?: string | null;
  channel: "SMS" | "EMAIL" | "BOTH" | "LINK" | "KIOSK";
  userId?: string | null;
  ruleId?: string | null;
  kioskLinkId?: string | null;
  origin?: string | null;
}) {
  const settings = await getConnectSettings(input.practiceId);
  const request = await prisma.intakeRequest.create({
    data: {
      practiceId: input.practiceId,
      packetId: input.packetId,
      patientId: input.patientId,
      appointmentId: input.appointmentId ?? null,
      token: newToken(),
      channel: input.channel,
      expiresAt: new Date(Date.now() + settings.linkDays * 86_400_000),
      createdById: input.userId ?? null,
      ruleId: input.ruleId ?? null,
      kioskLinkId: input.kioskLinkId ?? null,
    },
    include: { patient: true, packet: true, appointment: { include: { location: true } } },
  });
  if (["SMS", "EMAIL", "BOTH"].includes(input.channel) && request.patient) {
    const sent = await sendIntakeMessages(request.id, input.channel, input.userId ?? null, input.origin ?? null);
    await prisma.intakeRequest.update({ where: { id: request.id }, data: { sentTo: sent.join(", ") || null } });
  }
  return request;
}

export async function sendIntakeMessages(requestId: string, channel: string, userId: string | null, origin: string | null) {
  const r = await prisma.intakeRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { patient: true, packet: true, appointment: { include: { location: true } }, practice: { include: { connectSettings: true } } },
  });
  if (!r.patient) return [];
  const clinic = r.practice.connectSettings?.displayName || r.practice.name;
  const link = `${publicBase(origin)}/p/${r.token}`;
  const when = r.appointment ? ` before your visit on ${formatDate(r.appointment.startsAt)} at ${formatTime(r.appointment.startsAt)}` : "";
  const sentTo: string[] = [];
  for (const ch of channels(channel)) {
    const to = ch === "SMS" ? r.patient.phone : r.patient.email;
    const msg = await sendMessage({
      practiceId: r.practiceId,
      channel: ch,
      to,
      subject: `${clinic}: please complete your forms`,
      body:
        ch === "SMS"
          ? `${clinic}: Hi ${r.patient.firstName}, please complete your forms (${r.packet.name})${when}: ${link} (secure link, expires ${formatDate(r.expiresAt)})`
          : `Hi ${r.patient.firstName},\n\nPlease complete your ${r.packet.name}${when}. It takes about 10 minutes on your phone or computer.\n\n${link}\n\nYou'll be asked for your date of birth to open the forms. The link expires on ${formatDate(r.expiresAt)}.\n\n${clinic}`,
      kind: "INTAKE",
      patientId: r.patientId,
      appointmentId: r.appointmentId,
      requestId: r.id,
      ruleId: r.ruleId,
      userId,
    });
    if (msg.status === "SENT") sentTo.push(msg.to);
  }
  return sentTo;
}

// ---- Appointment reminders & surveys ----

export async function sendAppointmentReminder(appointmentId: string, channel: string, opts: { userId?: string | null; ruleId?: string | null; origin?: string | null } = {}) {
  const a = await prisma.appointment.findUniqueOrThrow({
    where: { id: appointmentId },
    include: { patient: true, location: true, provider: true, practice: { include: { connectSettings: true } } },
  });
  const token = a.confirmToken ?? newToken();
  if (!a.confirmToken) await prisma.appointment.update({ where: { id: a.id }, data: { confirmToken: token } });
  const clinic = a.practice.connectSettings?.displayName || a.practice.name;
  const link = `${publicBase(opts.origin)}/c/${token}`;
  const when = `${formatDate(a.startsAt)} at ${formatTime(a.startsAt)}`;
  const results = [];
  for (const ch of channels(channel)) {
    results.push(
      await sendMessage({
        practiceId: a.practiceId,
        channel: ch,
        to: ch === "SMS" ? a.patient.phone : a.patient.email,
        subject: `${clinic}: appointment reminder ${formatDate(a.startsAt)}`,
        body:
          ch === "SMS"
            ? `${clinic}: Reminder — ${a.patient.firstName}, you have an appointment ${when} at ${a.location.name}. Confirm or cancel: ${link}`
            : `Hi ${a.patient.firstName},\n\nThis is a reminder of your appointment on ${when} with ${a.provider.name} at ${a.location.name}.\n\nPlease confirm or let us know if you need to cancel: ${link}\n\n${clinic}`,
        kind: "REMINDER",
        patientId: a.patientId,
        appointmentId: a.id,
        ruleId: opts.ruleId ?? null,
        userId: opts.userId ?? null,
      })
    );
  }
  await prisma.appointment.update({ where: { id: a.id }, data: { reminderSentAt: new Date() } });
  return results;
}

export async function sendSurvey(appointmentId: string, channel: string, opts: { userId?: string | null; ruleId?: string | null; origin?: string | null } = {}) {
  const a = await prisma.appointment.findUniqueOrThrow({
    where: { id: appointmentId },
    include: { patient: true, practice: { include: { connectSettings: true } } },
  });
  const survey = await prisma.surveyResponse.create({ data: { practiceId: a.practiceId, patientId: a.patientId, appointmentId: a.id, token: newToken() } });
  const clinic = a.practice.connectSettings?.displayName || a.practice.name;
  const link = `${publicBase(opts.origin)}/s/${survey.token}`;
  for (const ch of channels(channel)) {
    await sendMessage({
      practiceId: a.practiceId,
      channel: ch,
      to: ch === "SMS" ? a.patient.phone : a.patient.email,
      subject: `${clinic}: how was your visit?`,
      body: `${clinic}: Thanks for visiting us, ${a.patient.firstName}. How likely are you to recommend us to a friend? ${link}`,
      kind: "SURVEY",
      patientId: a.patientId,
      appointmentId: a.id,
      ruleId: opts.ruleId ?? null,
      userId: opts.userId ?? null,
    });
  }
  return survey;
}

// ---- Automations ----

// Runs every active rule once: sends what's due and never sends the same thing twice.
export async function runAutomations(practiceId?: string) {
  const rules = await prisma.automationRule.findMany({ where: { active: true, ...(practiceId ? { practiceId } : {}) } });
  const now = new Date();
  let sent = 0;
  for (const rule of rules) {
    const types = (rule.visitTypes ?? "").split(",").filter(Boolean);
    const typeFilter = types.length ? { visitType: { in: types } } : {};
    if (rule.kind === "REMINDER" || rule.kind === "INTAKE_PACKET") {
      const due = await prisma.appointment.findMany({
        where: {
          practiceId: rule.practiceId,
          status: { in: ["SCHEDULED", "CONFIRMED"] },
          startsAt: { gt: now, lte: new Date(now.getTime() + rule.offsetHours * 3_600_000) },
          ...typeFilter,
        },
        include: { patient: { include: { encounters: { select: { id: true }, take: 1 } } } },
        take: 200,
      });
      for (const a of due) {
        if (rule.kind === "REMINDER") {
          const already = await prisma.messageLog.count({ where: { ruleId: rule.id, appointmentId: a.id } });
          if (already) continue;
          if (rule.onlyNewPatients && a.patient.encounters.length) continue;
          await sendAppointmentReminder(a.id, rule.channel, { ruleId: rule.id });
          sent++;
        } else if (rule.packetId) {
          if (rule.onlyNewPatients && a.patient.encounters.length) continue;
          const already = await prisma.intakeRequest.count({
            where: { patientId: a.patientId, packetId: rule.packetId, status: { notIn: ["CANCELLED", "EXPIRED"] }, createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } },
          });
          if (already) continue;
          await createIntakeRequest({ practiceId: rule.practiceId, packetId: rule.packetId, patientId: a.patientId, appointmentId: a.id, channel: rule.channel as "SMS", ruleId: rule.id });
          sent++;
        }
      }
    } else if (rule.kind === "SURVEY") {
      const done = await prisma.appointment.findMany({
        where: {
          practiceId: rule.practiceId,
          status: { in: ["COMPLETED", "IN_ROOM", "CHECKED_IN"] },
          encounter: { isNot: null },
          endsAt: { lte: new Date(now.getTime() - rule.offsetHours * 3_600_000), gte: new Date(now.getTime() - 7 * 86_400_000) },
          surveys: { none: {} },
          ...typeFilter,
        },
        take: 200,
      });
      for (const a of done) {
        await sendSurvey(a.id, rule.channel, { ruleId: rule.id });
        sent++;
      }
    }
    await prisma.automationRule.update({ where: { id: rule.id }, data: { lastRunAt: now } });
  }
  // Expire old links.
  await prisma.intakeRequest.updateMany({ where: { status: { in: ["SENT", "OPENED", "IN_PROGRESS"] }, expiresAt: { lt: now } }, data: { status: "EXPIRED" } });
  return sent;
}
