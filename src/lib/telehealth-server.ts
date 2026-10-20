import "server-only";
import { prisma } from "@/lib/prisma";
import { getSchedulerSettings } from "@/lib/scheduler-setup";
import { parseLicenses } from "@/lib/telehealth";

// A telehealth doctor is any active Rendering provider from the directory: supervising physicians and nurse
// practitioners alike (NPs are Rendering without Supervising).
export const TELEHEALTH_DOCTOR_WHERE = { isRendering: true, status: "ACTIVE" } as const;

// The telehealth profile for a directory provider, created on first use (licences default to the provider's licence state).
export async function ensureTelehealthProfile(practiceId: string, renderingProviderId: string) {
  const rp = await prisma.renderingProvider.findFirst({ where: { id: renderingProviderId, practiceId, ...TELEHEALTH_DOCTOR_WHERE }, include: { telehealthProfile: true } });
  if (!rp) return null;
  if (rp.telehealthProfile) return rp.telehealthProfile;
  return prisma.telehealthProvider.create({
    data: { practiceId, renderingProviderId: rp.id, stateLicenses: JSON.stringify(rp.licenseState ? [rp.licenseState] : []) },
  });
}

// What the booking panel needs: every bookable telehealth doctor (profile active, provider still rendering,
// linked to a login) with their windows in the range, each window with its live (non-cancelled) reservations. Plain
// strings and numbers only — it is handed to a client component.
export async function telehealthBookingData(practiceId: string, from: Date, to: Date) {
  const profiles = await prisma.telehealthProvider.findMany({
    where: { practiceId, status: "ACTIVE", renderingProvider: { ...TELEHEALTH_DOCTOR_WHERE, userId: { not: null } } },
    include: {
      renderingProvider: { select: { name: true, credential: true, specialty: true } },
      availability: {
        where: { endsAt: { gt: from }, startsAt: { lt: to } },
        orderBy: { startsAt: "asc" },
        include: { reservations: { where: { status: { not: "CANCELLED" } }, select: { id: true, startsAt: true, endsAt: true, status: true } } },
      },
    },
    orderBy: { renderingProvider: { name: "asc" } },
  });
  return profiles.map((p) => ({
    id: p.id,
    name: p.renderingProvider.name,
    credential: p.renderingProvider.credential,
    specialty: p.renderingProvider.specialty,
    licenses: parseLicenses(p.stateLicenses),
    windows: p.availability.map((w) => ({
      id: w.id,
      startsAt: w.startsAt.toISOString(),
      endsAt: w.endsAt.toISOString(),
      timezone: w.timezone,
      breakAfterBlocks: w.breakAfterBlocks,
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
