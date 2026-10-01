"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { formatDate, formatTime } from "@/lib/format";
import { normalizePhone } from "@/lib/patient-docs";
import { newToken, publicBase, sendMessage } from "@/lib/connect/core";
import { openSlots, slotKey } from "@/lib/connect/booking";
import { recordFlow } from "@/lib/flow";
import { headers } from "next/headers";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const norm = (v: string) => v.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");

export async function bookOnline(token: string, fd: FormData) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) redirect("/");
  const settings = await prisma.connectSettings.findUnique({ where: { bookingToken: token } });
  if (!settings?.bookingEnabled) redirect(`/book/${token}`);
  const practiceId = settings.practiceId;
  const type = str(fd, "type");
  const slot = str(fd, "slot");
  const back = (error: string) => redirect(`/book/${token}?type=${encodeURIComponent(type)}&slot=${encodeURIComponent(slot)}&error=${encodeURIComponent(error)}`);
  // Bots fill every field; people never see this one.
  if (str(fd, "website")) redirect(`/book/${token}`);

  const vt = await prisma.visitType.findFirst({ where: { practiceId, code: type, active: true, onlineBooking: true } });
  if (!vt) redirect(`/book/${token}`);
  const [ms, providerId, locationId] = slot.split("_");
  const start = new Date(Number(ms));
  if (!providerId || !locationId || Number.isNaN(start.getTime())) redirect(`/book/${token}?type=${type}`);
  const firstName = str(fd, "firstName").slice(0, 60);
  const lastName = str(fd, "lastName").slice(0, 60);
  const dobRaw = str(fd, "dob");
  const phone = normalizePhone(str(fd, "phone"));
  const email = str(fd, "email").slice(0, 120);
  if (!firstName || !lastName) back("Enter your first and last name.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dobRaw)) back("Enter your date of birth.");
  if (!phone) back("Enter a mobile number so we can confirm your visit.");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) back("That email address doesn't look right.");
  if (fd.get("consent") !== "on") back("Please agree to be contacted about this appointment.");
  const dob = new Date(`${dobRaw}T12:00:00Z`);

  // At most three online bookings from one phone number a day.
  const recent = await prisma.appointment.count({ where: { practiceId, bookingSource: "ONLINE", createdAt: { gte: new Date(Date.now() - 86_400_000) }, patient: { phone } } });
  if (recent >= 3) back("You've already requested several visits today — please call the office.");

  // The slot must still be open.
  const duration = vt.durationMin ?? 30;
  const still = await openSlots(practiceId, { durationMin: duration, providerId, locationId, leadHours: settings.bookingLeadHours, windowDays: settings.bookingWindowDays, from: new Date(start.getTime() - 60_000), limit: 50 });
  if (!still.some((s) => slotKey(s) === slot)) back("Sorry — that time was just taken. Please pick another.");

  // Match an existing patient on name + date of birth; never reveal whether a match was found.
  const sameDob = await prisma.patient.findMany({ where: { practiceId, dob: { gte: new Date(dob.getTime() - 86_400_000), lte: new Date(dob.getTime() + 86_400_000) } } });
  let patient =
    sameDob.find((p) => p.dob.toISOString().slice(0, 10) === dobRaw && norm(p.lastName) === norm(lastName) && norm(p.firstName) === norm(firstName)) ??
    sameDob.find((p) => p.dob.toISOString().slice(0, 10) === dobRaw && norm(p.lastName) === norm(lastName) && norm(p.firstName)[0] === norm(firstName)[0]) ??
    null;
  const isNew = !patient;
  if (isNew && !settings.bookingNewPatients) back("Online booking is for current patients. New patients, please call the office to schedule.");
  if (!patient) {
    patient = await prisma.patient.create({
      data: { practiceId, mrn: `CH-${Math.floor(100000 + Math.random() * 899999)}`, firstName, lastName, dob, sex: "U", phone, email: email || null },
    });
  } else if (!patient.phone || !patient.email) {
    patient = await prisma.patient.update({ where: { id: patient.id }, data: { phone: patient.phone ?? phone, email: patient.email ?? (email || null) } });
  }
  const status = settings.bookingApproval ? "REQUESTED" : "SCHEDULED";
  const reason = str(fd, "reason").slice(0, 300);
  const appt = await prisma.appointment.create({
    data: {
      practiceId,
      patientId: patient.id,
      providerId,
      locationId,
      startsAt: start,
      endsAt: new Date(start.getTime() + duration * 60_000),
      visitType: vt.code,
      status,
      reason: reason || null,
      bookingSource: "ONLINE",
      bookingNote: `${isNew ? "New patient" : "Existing patient"} · booked online${reason ? ` · ${reason}` : ""}`.slice(0, 300),
      confirmToken: newToken(),
    },
    include: { location: true, provider: true },
  });
  await recordFlow(appt.id, status, null);
  await logAudit(practiceId, null, "ONLINE_BOOKING", "Appointment", appt.id, `${vt.name} ${formatDate(start)} ${formatTime(start)} · ${isNew ? "new" : "existing"} patient`);

  const practice = await prisma.practice.findUniqueOrThrow({ where: { id: practiceId } });
  const clinic = settings.displayName || practice.name;
  const h = await headers();
  const origin = h.get("host") ? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}` : null;
  const link = `${publicBase(origin)}/c/${appt.confirmToken}`;
  const when = `${formatDate(start)} at ${formatTime(start)}`;
  const text =
    status === "REQUESTED"
      ? `${clinic}: we received your request for ${when} at ${appt.location.name}. We'll text you once it's confirmed. Details: ${link}`
      : `${clinic}: you're booked for ${when} with ${appt.provider.name} at ${appt.location.name}. Manage your visit: ${link}`;
  await sendMessage({ practiceId, channel: "SMS", to: phone, body: text, kind: "REMINDER", patientId: patient.id, appointmentId: appt.id });
  if (email) await sendMessage({ practiceId, channel: "EMAIL", to: email, subject: `${clinic}: ${status === "REQUESTED" ? "appointment request received" : "appointment booked"}`, body: text, kind: "REMINDER", patientId: patient.id, appointmentId: appt.id });
  redirect(`/c/${appt.confirmToken}?booked=1`);
}
