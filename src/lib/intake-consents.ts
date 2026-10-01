import "server-only";
import { prisma } from "@/lib/prisma";
import { createIntakeRequest, ensureConnectSetup, sendIntakeMessages } from "@/lib/connect/core";
import { CONSENT_FLAGS, CONSENT_PACKET_NAME } from "@/lib/connect/patient-forms";
import { parseFields } from "@/lib/chart-forms";
import { CONSENTS } from "@/lib/gateway";

const OPEN_REQUEST = ["SENT", "OPENED", "IN_PROGRESS"];

function keysOf(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// The packet sent at hand-off: one whose forms cover every gateway consent (treatment, HIPAA, financial, assignment).
// The practice's Initial Encounter Packet is used when it qualifies; otherwise the smallest packet that does.
async function consentPacket(practiceId: string) {
  await ensureConnectSetup(practiceId);
  const [packets, templates] = await Promise.all([
    prisma.intakePacket.findMany({ where: { practiceId, active: true } }),
    prisma.documentTemplate.findMany({ where: { practiceId, audience: "PATIENT", active: true }, select: { key: true, fields: true } }),
  ]);
  const flagsOf = new Map(templates.map((t) => [t.key, parseFields(t.fields).flatMap((f) => (f.map ? (CONSENT_FLAGS[f.map] ?? []) : []))]));
  const covering = packets.filter((p) => {
    const flags = new Set(keysOf(p.templateKeys).flatMap((k) => flagsOf.get(k) ?? []));
    return CONSENTS.every((c) => flags.has(c.key));
  });
  return covering.find((p) => p.name === CONSENT_PACKET_NAME) ?? covering.sort((x, y) => keysOf(x.templateKeys).length - keysOf(y.templateKeys).length)[0] ?? null;
}

export type ConsentSend = { requestId: string; token: string; sentTo: string[]; channel: string; reused: boolean };

// Sends the consent forms to the patient for e-signature (text and/or email, or a link to pass on when the
// patient has neither) and records the request on the case. An unsigned request already out is re-sent, not duplicated.
// Returns null when the practice has no consent packet set up in Patient Connect.
export async function sendCaseConsents(input: { caseId: string; practiceId: string; userId: string; origin: string | null }): Promise<ConsentSend | null> {
  const c = await prisma.intakeCase.findFirstOrThrow({ where: { id: input.caseId, practiceId: input.practiceId }, include: { patient: true } });
  const channel = c.patient.phone && c.patient.email ? "BOTH" : c.patient.phone ? "SMS" : c.patient.email ? "EMAIL" : "LINK";

  const open = c.consentRequestId
    ? await prisma.intakeRequest.findFirst({ where: { id: c.consentRequestId, status: { in: OPEN_REQUEST }, expiresAt: { gt: new Date() } } })
    : null;
  if (open) {
    const sentTo = channel === "LINK" ? [] : await sendIntakeMessages(open.id, channel, input.userId, input.origin);
    await prisma.intakeRequest.update({ where: { id: open.id }, data: { reminderCount: { increment: 1 }, lastReminderAt: new Date(), ...(sentTo.length ? { sentTo: sentTo.join(", ") } : {}) } });
    return { requestId: open.id, token: open.token, sentTo, channel, reused: true };
  }

  const packet = await consentPacket(input.practiceId);
  if (!packet) return null;
  const request = await createIntakeRequest({ practiceId: input.practiceId, packetId: packet.id, patientId: c.patientId, channel, userId: input.userId, origin: input.origin });
  const sent = await prisma.intakeRequest.findUniqueOrThrow({ where: { id: request.id }, select: { sentTo: true } });
  await prisma.intakeCase.update({ where: { id: c.id }, data: { consentRequestId: request.id, consentsSentAt: new Date() } });
  return { requestId: request.id, token: request.token, sentTo: sent.sentTo ? sent.sentTo.split(", ") : [], channel, reused: false };
}
