import "server-only";
import { prisma } from "@/lib/prisma";

export const FLOW_ROLES = ["ADMIN", "FRONT_DESK", "CLINICIAN", "SCHEDULER", "INTAKE"];

// Patient flow board: time-stamps each appointment status change (arrived, roomed, checked out...).
export async function recordFlow(appointmentIds: string | string[], status: string, userId: string | null, room?: string | null) {
  const ids = (Array.isArray(appointmentIds) ? appointmentIds : [appointmentIds]).filter(Boolean);
  if (ids.length === 0) return;
  await prisma.appointmentEvent.createMany({ data: ids.map((appointmentId) => ({ appointmentId, status, userId, room: room ?? null })) });
}

export const FLOW_STAGES: [string, string, string[]][] = [
  ["expected", "Expected", ["SCHEDULED", "CONFIRMED"]],
  ["waiting", "Waiting room", ["CHECKED_IN"]],
  ["room", "In room", ["IN_ROOM", "IN_PROGRESS"]],
  ["out", "Checked out", ["COMPLETED", "READY_FOR_CDS", "CDS_QUERY", "READY_FOR_CODING", "CODING_QUERY", "READY_FOR_SIGNATURE", "READY_FOR_BILLING", "BILLED"]],
  ["missed", "No-show / cancelled", ["NO_SHOW", "CANCELLED"]],
];

export function flowTimes(events: { status: string; at: Date; room: string | null }[]) {
  const first = (s: string[]) => events.find((e) => s.includes(e.status))?.at ?? null;
  const arrived = first(["CHECKED_IN"]);
  const roomed = first(["IN_ROOM"]);
  const out = first(["COMPLETED"]);
  const room = [...events].reverse().find((e) => e.room)?.room ?? null;
  return { arrived, roomed, out, room };
}

export const minutesBetween = (a: Date | null, b: Date | null) => (a && b ? Math.max(Math.round((b.getTime() - a.getTime()) / 60_000), 0) : null);
