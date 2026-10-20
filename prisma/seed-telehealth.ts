// Telehealth scheduler demo data for the Riverside demo practice: the Rendering + Supervising providers (Dr. Chen) get
// telehealth licences and two weeks of online hours, plus one reservation so the calendar and the Reservations tab have
// something to show.
//
// Runs as part of `prisma db seed`, and can be run on its own against an existing database:
//   npx tsx --env-file-if-exists=.env prisma/seed-telehealth.ts
// It does nothing if the practice already has a telehealth profile.
import { PrismaClient } from "@prisma/client";
import { zonedToUtc, weekdaysBetween, BLOCK_MIN } from "../src/lib/telehealth";

const EASTERN = "America/New_York";
const DAY = 24 * 60 * 60 * 1000;
const dateKey = (d: Date) => d.toISOString().slice(0, 10);

export async function seedTelehealth(prisma: PrismaClient, practiceId: string) {
  if (await prisma.telehealthProvider.count({ where: { practiceId } })) return false;

  const doctors = await prisma.renderingProvider.findMany({
    where: { practiceId, isRendering: true, isSupervising: true, status: "ACTIVE", userId: { not: null } },
    orderBy: { name: "asc" },
  });
  if (doctors.length === 0) return false;
  const priya = await prisma.user.findUnique({ where: { email: "priya.shah@carehub.local" } });

  // Online hours on every weekday for the next two weeks (Eastern), 9–5 with a break after six blocks.
  const today = new Date();
  const days = weekdaysBetween(dateKey(new Date(today.getTime() + DAY)), dateKey(new Date(today.getTime() + 14 * DAY)));
  for (const rp of doctors) {
    const profile = await prisma.telehealthProvider.create({
      data: { practiceId, renderingProviderId: rp.id, stateLicenses: JSON.stringify([...new Set([rp.licenseState ?? "NJ", "NJ", "NY", "PA", "FL"])]) },
    });
    await prisma.telehealthAvailability.createMany({
      data: days.map((d) => ({
        practiceId,
        providerId: profile.id,
        startsAt: zonedToUtc(d, "09:00", EASTERN)!,
        endsAt: zonedToUtc(d, "17:00", EASTERN)!,
        timezone: EASTERN,
        breakAfterBlocks: 6,
        createdById: priya?.id ?? null,
      })),
    });
  }

  // One reservation in the first doctor's first window, mirrored on the calendar.
  const rp = doctors[0];
  const profile = await prisma.telehealthProvider.findUniqueOrThrow({ where: { renderingProviderId: rp.id } });
  const patient = await prisma.patient.findFirst({ where: { practiceId, mrn: "CH-100318" } });
  const location = await prisma.location.findFirst({ where: { practiceId }, orderBy: { name: "asc" } });
  const first = await prisma.telehealthAvailability.findFirst({ where: { providerId: profile.id }, orderBy: { startsAt: "asc" } });
  if (patient && location && first && rp.userId) {
    const startsAt = new Date(first.startsAt.getTime() + BLOCK_MIN * 60_000);
    const endsAt = new Date(startsAt.getTime() + BLOCK_MIN * 60_000);
    const appointment = await prisma.appointment.create({
      data: {
        practiceId,
        patientId: patient.id,
        providerId: rp.userId,
        locationId: location.id,
        startsAt,
        endsAt,
        visitType: "TELE_INIT",
        status: "SCHEDULED",
        reason: "Telehealth wound check, dressing review",
        placeOfService: "02",
        supervisingProviderId: rp.id,
        createdById: priya?.id ?? null,
      },
    });
    await prisma.telehealthReservation.create({
      data: {
        practiceId,
        providerId: profile.id,
        availabilityId: first.id,
        patientId: patient.id,
        appointmentId: appointment.id,
        stateCode: "NJ",
        startsAt,
        endsAt,
        timezone: EASTERN,
        notes: "Telehealth wound check, dressing review",
        reservedById: priya?.id ?? null,
      },
    });
  }
  return true;
}

if (require.main === module) {
  const prisma = new PrismaClient();
  (async () => {
    const practice = await prisma.practice.findUnique({ where: { slug: "riverside" } });
    if (!practice) throw new Error("Riverside demo practice not found — run the main seed first");
    const done = await seedTelehealth(prisma, practice.id);
    console.log(done ? "Seeded telehealth scheduler demo." : "Telehealth demo already present; nothing to do.");
  })()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
