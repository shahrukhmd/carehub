"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { slugId } from "@/lib/chart-forms";
import {
  CONNECT_ROLES,
  createIntakeRequest,
  ensureConnectSetup,
  newToken,
  runAutomations,
  sendAppointmentReminder,
  sendIntakeMessages,
  sendMessage,
} from "@/lib/connect/core";
import { PAYMENT_ROLES, createPaymentLink } from "@/lib/connect/payments";
import { formatDate, formatTime } from "@/lib/format";
import { recordFlow } from "@/lib/flow";

class ConnectError extends Error {}
function fail(message: string): never {
  throw new ConnectError(message);
}

type User = Awaited<ReturnType<typeof requireUser>>;

async function guarded(back: string, roles: string[], work: (user: User) => Promise<string | void>) {
  const user = await requireUser(roles);
  await ensureConnectSetup(user.practiceId);
  let target = back;
  try {
    target = (await work(user)) ?? `${back}${back.includes("?") ? "&" : "?"}saved=1`;
  } catch (err) {
    if (!(err instanceof ConnectError)) throw err;
    target = `${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(err.message.slice(0, 300))}`;
  }
  revalidatePath("/connect", "layout");
  revalidatePath("/gateway", "layout");
  redirect(target);
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const on = (fd: FormData, k: string) => fd.get(k) === "on";

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  return host ? `${proto}://${host}` : null;
}

const safeBack = (v: string, fallback: string) => (/^\/(connect|gateway|patients)[\w/?=&.-]*$/.test(v) ? v : fallback);

// ---- Send forms ----

export async function sendPacket(fd: FormData) {
  const back = safeBack(str(fd, "back"), "/connect?tab=requests");
  return guarded(back, CONNECT_ROLES, async (user) => {
    const patient = await prisma.patient.findFirst({ where: { id: str(fd, "patientId"), practiceId: user.practiceId } });
    if (!patient) fail("Choose the patient.");
    const packet = await prisma.intakePacket.findFirst({ where: { id: str(fd, "packetId"), practiceId: user.practiceId, active: true } });
    if (!packet) fail("Choose which forms to send.");
    const channel = str(fd, "channel") as "SMS" | "EMAIL" | "BOTH" | "LINK";
    if (!["SMS", "EMAIL", "BOTH", "LINK"].includes(channel)) fail("Choose how to send the forms.");
    if (channel === "BOTH" && !patient.phone && !patient.email) fail("This patient has no mobile number or email — copy the link instead.");
    if (channel === "SMS" && !patient.phone) fail("This patient has no mobile number — send by email or copy the link.");
    if (channel === "EMAIL" && !patient.email) fail("This patient has no email address — send by text or copy the link.");
    const appointmentId = str(fd, "appointmentId") || null;
    if (appointmentId && !(await prisma.appointment.findFirst({ where: { id: appointmentId, patientId: patient.id } }))) fail("That appointment isn't this patient's.");
    const r = await createIntakeRequest({ practiceId: user.practiceId, packetId: packet.id, patientId: patient.id, appointmentId, channel, userId: user.id, origin: await origin() });
    await logAudit(user.practiceId, user.id, "SEND_PATIENT_FORMS", "IntakeRequest", r.id, `${packet.name} via ${channel}`);
    return `${back}${back.includes("?") ? "&" : "?"}sent=${r.id}`;
  });
}

export async function resendRequest(id: string, fd: FormData) {
  return guarded("/connect?tab=requests", CONNECT_ROLES, async (user) => {
    const r = await prisma.intakeRequest.findFirst({ where: { id, practiceId: user.practiceId } });
    if (!r || !r.patientId) fail("Request not found.");
    if (["COMPLETED", "CANCELLED"].includes(r.status)) fail("These forms are already completed or withdrawn.");
    const settings = await prisma.connectSettings.findUnique({ where: { practiceId: user.practiceId } });
    await prisma.intakeRequest.update({
      where: { id: r.id },
      data: {
        reminderCount: r.reminderCount + 1,
        lastReminderAt: new Date(),
        ...(r.status === "EXPIRED" ? { status: "SENT", expiresAt: new Date(Date.now() + (settings?.linkDays ?? 14) * 86_400_000) } : {}),
      },
    });
    const sent = await sendIntakeMessages(r.id, str(fd, "channel") || "BOTH", user.id, await origin());
    if (sent.length === 0) fail("Not resent — the patient has no valid mobile number or email. Copy the link instead.");
    return "/connect?tab=requests&resent=1";
  });
}

export async function cancelRequest(id: string) {
  return guarded("/connect?tab=requests", CONNECT_ROLES, async (user) => {
    await prisma.intakeRequest.updateMany({ where: { id, practiceId: user.practiceId, status: { not: "COMPLETED" } }, data: { status: "CANCELLED", sessionHash: null } });
  });
}

export async function remindAppointment(appointmentId: string) {
  return guarded("/connect?tab=reminders", CONNECT_ROLES, async (user) => {
    const a = await prisma.appointment.findFirst({ where: { id: appointmentId, practiceId: user.practiceId } });
    if (!a) fail("Appointment not found.");
    const sent = await sendAppointmentReminder(a.id, "BOTH", { userId: user.id, origin: await origin() });
    const failed = sent.filter((m) => m.status !== "SENT");
    if (failed.length === sent.length) fail(`Reminder not sent — ${failed.map((m) => m.error).join("; ")}.`);
    return `/connect?tab=reminders&reminded=1`;
  });
}

// ---- Packets (admin) ----

export async function savePacket(id: string, fd: FormData) {
  return guarded(`/connect?tab=packets${id !== "new" ? `&edit=${id}` : ""}`, ["ADMIN"], async (user) => {
    const name = str(fd, "name");
    if (!name) fail("Name the packet.");
    const forms = await prisma.documentTemplate.findMany({ where: { practiceId: user.practiceId, audience: "PATIENT" } });
    const orderOf = (k: string) => {
      const n = Number(str(fd, `order_${k}`));
      return Number.isFinite(n) ? n : 999;
    };
    const keys = fd
      .getAll("forms")
      .map(String)
      .filter((k) => forms.some((f) => f.key === k))
      .sort((a, b) => orderOf(a) - orderOf(b));
    if (keys.length === 0) fail("Pick at least one form.");
    const data = { name: name.slice(0, 120), description: str(fd, "description") || null, templateKeys: JSON.stringify(keys), active: on(fd, "active") };
    if (id === "new") await prisma.intakePacket.create({ data: { ...data, practiceId: user.practiceId } });
    else await prisma.intakePacket.updateMany({ where: { id, practiceId: user.practiceId }, data });
    return "/connect?tab=packets&saved=1";
  });
}

export async function createPatientForm(fd: FormData) {
  return guarded("/connect?tab=forms", ["ADMIN"], async (user) => {
    const name = str(fd, "name");
    if (!name) fail("Name the form.");
    const t = await prisma.documentTemplate.create({
      data: {
        practiceId: user.practiceId,
        key: `pt_custom_${slugId(name, new Set()).slice(0, 28)}_${randomBytes(3).toString("hex")}`,
        name: name.slice(0, 120),
        section: "ADDITIONAL",
        kind: "FORM",
        audience: "PATIENT",
        inProgressNote: false,
        sortOrder: 2900,
        noteOrder: 2900,
      },
    });
    return `/settings/documentation/templates/${t.id}`;
  });
}

// ---- Automations (admin) ----

export async function saveRule(id: string, fd: FormData) {
  return guarded("/connect?tab=automations", ["ADMIN"], async (user) => {
    const kind = str(fd, "kind");
    if (!["INTAKE_PACKET", "REMINDER", "SURVEY"].includes(kind)) fail("Pick what the rule sends.");
    const hours = Number(str(fd, "offsetHours"));
    if (!(Number.isInteger(hours) && hours >= 1 && hours <= 720)) fail("Timing must be 1–720 hours.");
    const channel = ["SMS", "EMAIL", "BOTH"].includes(str(fd, "channel")) ? str(fd, "channel") : "BOTH";
    const packetId = str(fd, "packetId") || null;
    if (kind === "INTAKE_PACKET" && !packetId) fail("Pick the packet to send.");
    const name = str(fd, "name") || `${kind === "REMINDER" ? "Reminder" : kind === "SURVEY" ? "Survey" : "Forms"} — ${hours}h`;
    const data = {
      name: name.slice(0, 120),
      kind,
      offsetHours: hours,
      channel,
      packetId: kind === "INTAKE_PACKET" ? packetId : null,
      onlyNewPatients: on(fd, "onlyNewPatients"),
      visitTypes: fd.getAll("visitTypes").map(String).join(",") || null,
      active: on(fd, "active"),
    };
    if (id === "new") await prisma.automationRule.create({ data: { ...data, practiceId: user.practiceId } });
    else await prisma.automationRule.updateMany({ where: { id, practiceId: user.practiceId }, data });
    await logAudit(user.practiceId, user.id, "SAVE_AUTOMATION", "AutomationRule", id, `${name} (${data.active ? "on" : "off"})`);
  });
}

export async function deleteRule(id: string) {
  return guarded("/connect?tab=automations", ["ADMIN"], async (user) => {
    await prisma.automationRule.deleteMany({ where: { id, practiceId: user.practiceId } });
  });
}

export async function runAutomationsNow() {
  return guarded("/connect?tab=automations", ["ADMIN"], async (user) => {
    const n = await runAutomations(user.practiceId);
    return `/connect?tab=automations&ran=${n}`;
  });
}

// ---- Kiosk links (admin) ----

export async function saveKiosk(fd: FormData) {
  return guarded("/connect?tab=kiosk", ["ADMIN"], async (user) => {
    const packet = await prisma.intakePacket.findFirst({ where: { id: str(fd, "packetId"), practiceId: user.practiceId } });
    if (!packet) fail("Pick the packet walk-ins fill in.");
    const locationId = str(fd, "locationId") || null;
    await prisma.kioskLink.create({
      data: { practiceId: user.practiceId, name: str(fd, "name").slice(0, 80) || `Check-in — ${packet.name}`, token: newToken(), packetId: packet.id, locationId },
    });
  });
}

export async function toggleKiosk(id: string) {
  return guarded("/connect?tab=kiosk", ["ADMIN"], async (user) => {
    const k = await prisma.kioskLink.findFirst({ where: { id, practiceId: user.practiceId } });
    if (!k) fail("Kiosk link not found.");
    await prisma.kioskLink.update({ where: { id: k.id }, data: { active: !k.active } });
  });
}

// ---- Branding & messaging (admin) ----

export async function saveConnectSettings(fd: FormData) {
  return guarded("/connect?tab=settings", ["ADMIN"], async (user) => {
    const color = (v: string, d: string) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
    const days = Number(str(fd, "linkDays"));
    let logo: string | null | undefined = undefined;
    const file = fd.get("logo");
    if (file instanceof File && file.size > 0) {
      if (!["image/png", "image/jpeg"].includes(file.type)) fail("The logo must be a PNG or JPG.");
      if (file.size > 200_000) fail("The logo must be under 200 KB.");
      logo = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
    }
    if (on(fd, "removeLogo")) logo = null;
    await prisma.connectSettings.update({
      where: { practiceId: user.practiceId },
      data: {
        displayName: str(fd, "displayName").slice(0, 80) || null,
        brandColor: color(str(fd, "brandColor"), "#171342"),
        accentColor: color(str(fd, "accentColor"), "#4f9c60"),
        welcomeText: str(fd, "welcomeText").slice(0, 500) || null,
        supportPhone: str(fd, "supportPhone").slice(0, 30) || null,
        linkDays: Number.isInteger(days) && days >= 1 && days <= 60 ? days : 14,
        smsProvider: ["MOCK", "TWILIO"].includes(str(fd, "smsProvider")) ? str(fd, "smsProvider") : "MOCK",
        emailProvider: ["MOCK", "SENDGRID"].includes(str(fd, "emailProvider")) ? str(fd, "emailProvider") : "MOCK",
        ...(logo !== undefined ? { logo } : {}),
      },
    });
    await logAudit(user.practiceId, user.id, "UPDATE_CONNECT_SETTINGS", "ConnectSettings", user.practiceId, "branding & messaging");
  });
}

// ---- Online bill pay ----

export async function sendPaymentLink(patientId: string, fd: FormData) {
  const back = safeBack(str(fd, "back"), "/connect?tab=payments");
  return guarded(back, PAYMENT_ROLES, async (user) => {
    const settings = await prisma.connectSettings.findUnique({ where: { practiceId: user.practiceId } });
    if (!settings?.paymentsEnabled) fail("Turn on online payments in Patient Connect → Payments first.");
    const channel = str(fd, "channel") as "SMS" | "EMAIL" | "BOTH" | "LINK";
    if (!["SMS", "EMAIL", "BOTH", "LINK"].includes(channel)) fail("Choose how to send the link.");
    try {
      const r = await createPaymentLink(user.practiceId, patientId, user.id, channel, await origin());
      return `${back}${back.includes("?") ? "&" : "?"}payLink=${r.pay.id}`;
    } catch (err) {
      fail((err as Error).message);
    }
  });
}

export async function cancelPaymentLink(id: string) {
  return guarded("/connect?tab=payments", PAYMENT_ROLES, async (user) => {
    await prisma.patientPayment.updateMany({ where: { id, practiceId: user.practiceId, status: "SENT" }, data: { status: "CANCELLED", sessionHash: null } });
  });
}

export async function savePaymentSettings(fd: FormData) {
  return guarded("/connect?tab=payments", ["ADMIN"], async (user) => {
    const provider = str(fd, "paymentProvider") === "STRIPE" ? "STRIPE" : "TEST";
    await prisma.connectSettings.update({ where: { practiceId: user.practiceId }, data: { paymentsEnabled: on(fd, "paymentsEnabled"), paymentProvider: provider } });
    await logAudit(user.practiceId, user.id, "UPDATE_PAYMENT_SETTINGS", "ConnectSettings", user.practiceId, `${on(fd, "paymentsEnabled") ? "on" : "off"} · ${provider}`);
  });
}

// ---- Online self-scheduling ----

export async function saveBookingSettings(fd: FormData) {
  return guarded("/connect?tab=booking", ["ADMIN"], async (user) => {
    const s = await prisma.connectSettings.findUniqueOrThrow({ where: { practiceId: user.practiceId } });
    const lead = Number(str(fd, "bookingLeadHours"));
    const win = Number(str(fd, "bookingWindowDays"));
    await prisma.connectSettings.update({
      where: { practiceId: user.practiceId },
      data: {
        bookingEnabled: on(fd, "bookingEnabled"),
        bookingApproval: on(fd, "bookingApproval"),
        bookingNewPatients: on(fd, "bookingNewPatients"),
        bookingLeadHours: Number.isInteger(lead) && lead >= 0 && lead <= 336 ? lead : 24,
        bookingWindowDays: Number.isInteger(win) && win >= 1 && win <= 120 ? win : 30,
        bookingMessage: str(fd, "bookingMessage").slice(0, 400) || null,
        bookingToken: s.bookingToken && fd.get("newLink") !== "on" ? s.bookingToken : newToken(),
      },
    });
    await logAudit(user.practiceId, user.id, "UPDATE_BOOKING_SETTINGS", "ConnectSettings", user.practiceId, on(fd, "bookingEnabled") ? "online booking on" : "online booking off");
  });
}

export async function reviewBooking(appointmentId: string, fd: FormData) {
  return guarded("/connect?tab=booking", CONNECT_ROLES, async (user) => {
    const a = await prisma.appointment.findFirst({ where: { id: appointmentId, practiceId: user.practiceId, status: "REQUESTED" }, include: { patient: true, location: true, provider: true, practice: { include: { connectSettings: true } } } });
    if (!a) fail("That request was already handled.");
    const approve = str(fd, "decision") === "approve";
    const note = str(fd, "note").slice(0, 200);
    await prisma.appointment.update({
      where: { id: a.id },
      data: approve ? { status: "SCHEDULED" } : { status: "CANCELLED", cancelReason: `Online request declined${note ? ` — ${note}` : ""}`, cancelledAt: new Date() },
    });
    await recordFlow(a.id, approve ? "SCHEDULED" : "CANCELLED", user.id);
    const clinic = a.practice.connectSettings?.displayName || a.practice.name;
    const when = `${formatDate(a.startsAt)} at ${formatTime(a.startsAt)}`;
    const body = approve
      ? `${clinic}: your appointment on ${when} with ${a.provider.name} at ${a.location.name} is confirmed.`
      : `${clinic}: we couldn't book your requested time on ${when}${note ? ` (${note})` : ""}. Please call ${a.practice.connectSettings?.supportPhone ?? "the office"} or pick another time online.`;
    for (const ch of ["SMS", "EMAIL"] as const) {
      const to = ch === "SMS" ? a.patient.phone : a.patient.email;
      if (to) await sendMessage({ practiceId: user.practiceId, channel: ch, to, subject: `${clinic}: appointment ${approve ? "confirmed" : "request"}`, body, kind: "REMINDER", patientId: a.patientId, appointmentId: a.id, userId: user.id });
    }
    await logAudit(user.practiceId, user.id, approve ? "APPROVE_ONLINE_BOOKING" : "DECLINE_ONLINE_BOOKING", "Appointment", a.id, when);
  });
}
