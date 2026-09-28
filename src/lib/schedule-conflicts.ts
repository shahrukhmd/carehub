import "server-only";
import { prisma } from "@/lib/prisma";
import { formatDate, formatTime } from "@/lib/format";
import { timeToMinutes } from "@/lib/schedule";

export type Occurrence = { startsAt: Date; endsAt: Date };

const INACTIVE = ["CANCELLED", "NO_SHOW"];
const MAX_OCCURRENCES = 52;

// Weekly / every-other-week series on the chosen weekdays, from the first visit through the end date.
export function buildOccurrences(
  first: Date,
  minutes: number,
  recurrence: "NONE" | "WEEKLY" | "BIWEEKLY",
  weekdays: number[],
  endDate: Date | null
): Occurrence[] {
  const make = (d: Date) => ({ startsAt: d, endsAt: new Date(d.getTime() + minutes * 60_000) });
  if (recurrence === "NONE" || !endDate) return [make(first)];
  const days = weekdays.length ? weekdays : [first.getDay()];
  const out: Occurrence[] = [];
  const weekStart = new Date(first);
  weekStart.setDate(first.getDate() - first.getDay());
  const last = new Date(endDate);
  last.setHours(23, 59, 59, 999);
  for (let week = 0; out.length < MAX_OCCURRENCES; week += recurrence === "BIWEEKLY" ? 2 : 1) {
    let pastEnd = true;
    for (const day of [...days].sort()) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + week * 7 + day);
      d.setHours(first.getHours(), first.getMinutes(), 0, 0);
      if (d > last) continue;
      pastEnd = false;
      if (d >= first && out.length < MAX_OCCURRENCES) out.push(make(d));
    }
    if (pastEnd) break;
  }
  return out;
}

type ConflictInput = {
  practiceId: string;
  patientId: string;
  providerId: string;
  locationId: string;
  clinicalStaffId: string | null;
  intakeCaseId: string | null;
  occurrences: Occurrence[];
};

// Same checks the WoundExpert scheduler warns about, returned as readable lines.
export async function findConflicts(input: ConflictInput): Promise<string[]> {
  const { practiceId, occurrences } = input;
  const from = occurrences[0].startsAt;
  const to = occurrences[occurrences.length - 1].endsAt;
  const people = [input.providerId, input.clinicalStaffId].filter((x): x is string => Boolean(x));

  const [availability, appts, reserved, authCase, authUsed] = await Promise.all([
    prisma.providerAvailability.findMany({ where: { practiceId, providerId: input.providerId } }),
    prisma.appointment.findMany({
      where: {
        practiceId,
        status: { notIn: INACTIVE },
        startsAt: { lt: to },
        endsAt: { gt: from },
        OR: [
          { providerId: { in: people } },
          { clinicalStaffId: { in: people } },
          { patientId: input.patientId },
        ],
      },
      include: { patient: true, provider: true },
    }),
    prisma.reservedTime.findMany({
      where: { practiceId, providerId: { in: people }, startsAt: { lt: to }, endsAt: { gt: from } },
      include: { provider: true },
    }),
    input.intakeCaseId ? prisma.intakeCase.findFirst({ where: { id: input.intakeCaseId, practiceId } }) : null,
    input.intakeCaseId
      ? prisma.appointment.count({ where: { intakeCaseId: input.intakeCaseId, status: { notIn: INACTIVE } } })
      : 0,
  ]);

  const out: string[] = [];
  for (const o of occurrences) {
    const when = `${formatDate(o.startsAt)} ${formatTime(o.startsAt)}`;
    const startMin = o.startsAt.getHours() * 60 + o.startsAt.getMinutes();
    const endMin = startMin + (o.endsAt.getTime() - o.startsAt.getTime()) / 60_000;

    // Only enforce availability once the physician's hours have been set up.
    if (availability.length) {
      const covered = availability.some(
        (a) =>
          a.locationId === input.locationId &&
          a.dayOfWeek === o.startsAt.getDay() &&
          timeToMinutes(a.startTime) <= startMin &&
          timeToMinutes(a.endTime) >= endMin
      );
      if (!covered) out.push(`${when} — physician not available at this location at this time`);
    }
    for (const a of appts) {
      if (a.startsAt >= o.endsAt || a.endsAt <= o.startsAt) continue;
      if (a.patientId === input.patientId) out.push(`${when} — patient already booked (${a.provider.name})`);
      else if (a.providerId === input.providerId || a.clinicalStaffId === input.providerId)
        out.push(`${when} — physician already booked with ${a.patient.lastName}, ${a.patient.firstName}`);
      else out.push(`${when} — clinician already booked with ${a.patient.lastName}, ${a.patient.firstName}`);
    }
    for (const r of reserved) {
      if (r.startsAt >= o.endsAt || r.endsAt <= o.startsAt) continue;
      out.push(`${when} — ${r.provider.name} has reserved time (${r.title})`);
    }
    if (authCase) {
      if (authCase.authStatus !== "APPROVED") out.push(`${when} — prior auth is not approved`);
      else if (authCase.authEndDate && o.startsAt > authCase.authEndDate)
        out.push(`${when} — after the auth end date (${formatDate(authCase.authEndDate)})`);
      else if (authCase.authStartDate && o.startsAt < authCase.authStartDate)
        out.push(`${when} — before the auth start date (${formatDate(authCase.authStartDate)})`);
    }
  }
  if (authCase?.authVisitsApproved && authUsed + occurrences.length > authCase.authVisitsApproved) {
    out.push(
      `Auth #${authCase.authNumber} allows ${authCase.authVisitsApproved} visits; ${authUsed} already booked, ${occurrences.length} more requested`
    );
  }
  return [...new Set(out)];
}
