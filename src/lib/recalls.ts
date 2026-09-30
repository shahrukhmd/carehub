import "server-only";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { sendMessage } from "@/lib/connect/core";

export const RECALL_ROLES = ["ADMIN", "FRONT_DESK", "SCHEDULER", "CLINICIAN", "INTAKE"];

export const RECALL_REASONS = [
  "Wound re-check",
  "Post-healing follow-up",
  "Dressing / compression check",
  "Skin substitute follow-up",
  "Diabetic foot exam",
  "Vascular study follow-up",
  "Annual visit",
  "Lab follow-up",
];

export const CLOSE_REASONS = ["Visit booked elsewhere", "Patient declined", "Patient moved / changed provider", "Deceased", "Not needed any more", "Unable to reach"];

// Links an open recall to an upcoming visit booked around its due date (from 3 weeks before).
export async function linkBookedRecalls(practiceId: string) {
  const open = await prisma.recall.findMany({ where: { practiceId, status: "OPEN" }, select: { id: true, patientId: true, dueDate: true } });
  if (open.length === 0) return;
  const appts = await prisma.appointment.findMany({
    where: {
      practiceId,
      patientId: { in: [...new Set(open.map((r) => r.patientId))] },
      startsAt: { gte: new Date() },
      status: { in: ["SCHEDULED", "CONFIRMED", "CHECKED_IN"] },
    },
    orderBy: { startsAt: "asc" },
    select: { id: true, patientId: true, startsAt: true },
  });
  for (const r of open) {
    const window = r.dueDate.getTime() - 21 * 86_400_000;
    const a = appts.find((x) => x.patientId === r.patientId && x.startsAt.getTime() >= window);
    if (a) await prisma.recall.update({ where: { id: r.id }, data: { status: "SCHEDULED", appointmentId: a.id } });
  }
}

export async function sendRecallMessage(recallId: string, practiceId: string, userId: string | null) {
  const r = await prisma.recall.findFirstOrThrow({ where: { id: recallId, practiceId }, include: { patient: true, practice: { include: { connectSettings: true } } } });
  const clinic = r.practice.connectSettings?.displayName || r.practice.name;
  const phone = r.practice.connectSettings?.supportPhone;
  const call = phone ? ` Please call ${phone} to book.` : " Please call the office to book.";
  const results = [];
  for (const channel of ["SMS", "EMAIL"] as const) {
    const to = channel === "SMS" ? r.patient.phone : r.patient.email;
    if (!to) continue;
    results.push(
      await sendMessage({
        practiceId,
        channel,
        to,
        subject: `${clinic}: time for your follow-up visit`,
        body:
          channel === "SMS"
            ? `${clinic}: Hi ${r.patient.firstName}, you're due for a follow-up visit (${r.reason.toLowerCase()}) around ${formatDate(r.dueDate)}.${call}`
            : `Hi ${r.patient.firstName},\n\nOur records show you're due for a follow-up visit (${r.reason}) around ${formatDate(r.dueDate)}.${call}\n\n${clinic}`,
        kind: "RECALL",
        patientId: r.patientId,
        userId,
      })
    );
  }
  const sent = results.filter((m) => m.status === "SENT");
  if (sent.length) {
    await prisma.recall.update({
      where: { id: r.id },
      data: { contactCount: r.contactCount + 1, lastContactAt: new Date(), lastContactVia: sent.map((m) => (m.channel === "SMS" ? "Text" : "Email")).join(" + ") },
    });
  }
  return sent.length;
}
