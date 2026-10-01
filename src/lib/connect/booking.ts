import "server-only";
import { prisma } from "@/lib/prisma";
import { timeToMinutes } from "@/lib/schedule";
import { parseOfficeHours } from "@/lib/scheduler";
import { dayKey } from "@/lib/holidays";

// Online self-scheduling: open slots from provider availability minus booked visits, reserved time,
// office hours and clinic closures.

export type Slot = { start: Date; end: Date; providerId: string; providerName: string; locationId: string; locationName: string };

const ACTIVE = { notIn: ["CANCELLED", "NO_SHOW"] };

export async function bookableTypes(practiceId: string) {
  return prisma.visitType.findMany({ where: { practiceId, active: true, onlineBooking: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function openSlots(
  practiceId: string,
  opts: { durationMin: number; locationId?: string | null; providerId?: string | null; leadHours: number; windowDays: number; limit?: number; from?: Date }
): Promise<Slot[]> {
  const now = new Date();
  const earliest = new Date(Math.max(now.getTime() + opts.leadHours * 3_600_000, (opts.from ?? now).getTime()));
  const until = new Date(now.getTime() + opts.windowDays * 86_400_000);
  const [avail, appts, reserved, closures] = await Promise.all([
    prisma.providerAvailability.findMany({
      where: { practiceId, ...(opts.locationId ? { locationId: opts.locationId } : {}), ...(opts.providerId ? { providerId: opts.providerId } : {}), provider: { active: true } },
      include: { provider: true, location: true },
    }),
    prisma.appointment.findMany({ where: { practiceId, status: ACTIVE, startsAt: { lt: until }, endsAt: { gt: earliest } }, select: { providerId: true, startsAt: true, endsAt: true } }),
    prisma.reservedTime.findMany({ where: { practiceId, startsAt: { lt: until }, endsAt: { gt: earliest } }, select: { providerId: true, startsAt: true, endsAt: true } }),
    prisma.clinicClosure.findMany({ where: { practiceId, allowBooking: false, date: { gte: new Date(earliest.getTime() - 86_400_000), lte: until } } }),
  ]);
  const busy = new Map<string, { s: number; e: number }[]>();
  for (const b of [...appts, ...reserved]) busy.set(b.providerId, [...(busy.get(b.providerId) ?? []), { s: b.startsAt.getTime(), e: b.endsAt.getTime() }]);
  const out: Slot[] = [];
  const dur = opts.durationMin * 60_000;
  for (let d = new Date(earliest.getFullYear(), earliest.getMonth(), earliest.getDate()); d <= until; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const dk = dayKey(d);
    for (const a of avail.filter((x) => x.dayOfWeek === d.getDay())) {
      if (closures.some((c) => dayKey(c.date) === dk && (!c.locationId || c.locationId === a.locationId))) continue;
      const hours = a.location.officeHours ? parseOfficeHours(a.location.officeHours)[d.getDay()] : null;
      if (hours?.closed) continue;
      let startMin = timeToMinutes(a.startTime);
      let endMin = timeToMinutes(a.endTime);
      if (hours) {
        startMin = Math.max(startMin, timeToMinutes(hours.start));
        endMin = Math.min(endMin, timeToMinutes(hours.end));
      }
      const step = Math.max(a.location.slotMinutes || 15, Math.min(opts.durationMin, 30));
      for (let m = startMin; m + opts.durationMin <= endMin; m += step) {
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(m / 60), m % 60);
        if (start < earliest) continue;
        const s = start.getTime();
        const e = s + dur;
        if ((busy.get(a.providerId) ?? []).some((b) => b.s < e && b.e > s)) continue;
        out.push({ start, end: new Date(e), providerId: a.providerId, providerName: a.provider.name, locationId: a.locationId, locationName: a.location.name });
      }
    }
  }
  out.sort((x, y) => x.start.getTime() - y.start.getTime() || x.providerName.localeCompare(y.providerName));
  return out.slice(0, opts.limit ?? 400);
}

export function slotKey(s: { start: Date; providerId: string; locationId: string }) {
  return `${s.start.getTime()}_${s.providerId}_${s.locationId}`;
}
