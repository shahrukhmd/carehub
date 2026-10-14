import "server-only";
import { prisma } from "@/lib/prisma";
import { getSchedulerSettings } from "@/lib/scheduler-setup";
import { parseLicenses } from "@/lib/telehealth";

// What the booking panel needs: every active telehealth doctor with their windows in the range, each window with its
// live (non-cancelled) reservations. Plain strings and numbers only — it is handed to a client component.
export async function telehealthBookingData(practiceId: string, from: Date, to: Date) {
  const providers = await prisma.telehealthProvider.findMany({
    where: { practiceId, status: "ACTIVE" },
    include: {
      user: { select: { name: true } },
      availability: {
        where: { endsAt: { gt: from }, startsAt: { lt: to } },
        orderBy: { startsAt: "asc" },
        include: { reservations: { where: { status: { not: "CANCELLED" } }, select: { id: true, startsAt: true, endsAt: true, status: true } } },
      },
    },
    orderBy: { user: { name: "asc" } },
  });
  return providers.map((p) => ({
    id: p.id,
    name: p.user.name,
    suffix: p.suffix,
    specialty: p.specialty,
    licenses: parseLicenses(p.stateLicenses),
    breakAfterBlocks: p.breakAfterBlocks,
    breakMinWindowMin: p.breakMinWindowMin,
    windows: p.availability.map((w) => ({
      id: w.id,
      startsAt: w.startsAt.toISOString(),
      endsAt: w.endsAt.toISOString(),
      timezone: w.timezone,
      reservations: w.reservations.map((r) => ({ id: r.id, startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString(), status: r.status })),
    })),
  }));
}
export type TelehealthBookingProvider = Awaited<ReturnType<typeof telehealthBookingData>>[number];

// The site a telehealth visit is filed under: the scheduler's default site, else the first active one.
export async function telehealthLocationId(practiceId: string) {
  const settings = await getSchedulerSettings(practiceId);
  if (settings.defaultLocationId) {
    const loc = await prisma.location.findFirst({ where: { id: settings.defaultLocationId, practiceId }, select: { id: true } });
    if (loc) return loc.id;
  }
  const first = await prisma.location.findFirst({ where: { practiceId, active: true }, orderBy: { name: "asc" }, select: { id: true } });
  return first?.id ?? null;
}

// Appointment status -> reservation status (null = no change to the reservation).
export function reservationStatusFor(appointmentStatus: string): string | null {
  switch (appointmentStatus) {
    case "CONFIRMED":
      return "CONFIRMED";
    case "CANCELLED":
      return "CANCELLED";
    case "NO_SHOW":
      return "MISSED";
    case "COMPLETED":
    case "BILLED":
      return "COMPLETED";
    default:
      return null;
  }
}

// Reservation status -> the calendar status its appointment shows.
export function appointmentStatusFor(reservationStatus: string): string {
  switch (reservationStatus) {
    case "CONFIRMED":
      return "CONFIRMED";
    case "CANCELLED":
      return "CANCELLED";
    case "MISSED":
      return "NO_SHOW";
    case "COMPLETED":
      return "COMPLETED";
    default:
      return "SCHEDULED";
  }
}

// A status change made on the calendar (confirm, cancel, mark missed) carries over to the telehealth reservation.
export async function syncReservationsFromAppointments(practiceId: string, appointmentIds: string[], appointmentStatus: string, userId: string | null, reason?: string | null) {
  const status = reservationStatusFor(appointmentStatus);
  if (!status || appointmentIds.length === 0) return;
  await prisma.telehealthReservation.updateMany({
    where: { practiceId, appointmentId: { in: appointmentIds } },
    data: {
      status,
      ...(status === "CONFIRMED" ? { confirmedById: userId, confirmedAt: new Date() } : {}),
      ...(status === "CANCELLED" ? { cancelReason: reason ?? "Cancelled from the calendar" } : {}),
    },
  });
}
