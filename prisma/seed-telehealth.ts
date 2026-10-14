// Telehealth scheduler demo data for the Riverside demo practice: two telehealth doctors with state licences and
// two weeks of online hours, plus one reservation so the calendar and the Reservations tab have something to show.
//
// Runs as part of `prisma db seed`, and can be run on its own against an existing database:
//   npx tsx --env-file-if-exists=.env prisma/seed-telehealth.ts
// It does nothing if the practice already has a telehealth doctor.
import { PrismaClient } from "@prisma/client";
import { zonedToUtc, weekdaysBetween, BLOCK_MIN } from "../src/lib/telehealth";

const EASTERN = "America/New_York";
const DAY = 24 * 60 * 60 * 1000;
const dateKey = (d: Date) => d.toISOString().slice(0, 10);

export async function seedTelehealth(prisma: PrismaClient, practiceId: string) {
  if (await prisma.telehealthProvider.count({ where: { practiceId } })) return false;

  const userByEmail = (e: string) => prisma.user.findUnique({ where: { email: e } });
  const [maya, james, priya] = await Promise.all([userByEmail("maya.chen@carehub.local"), userByEmail("james.okonkwo@carehub.local"), userByEmail("priya.shah@carehub.local")]);
  if (!maya || !james) return false;

  const [drChen, okonkwo] = await Promise.all([
    prisma.telehealthProvider.create({
      data: { practiceId, userId: maya.id, suffix: "Dr.", specialty: "Wound care", stateLicenses: JSON.stringify(["NJ", "NY", "PA", "FL"]), breakAfterBlocks: 6, breakMinWindowMin: 300 },
    }),
    prisma.telehealthProvider.create({
      data: { practiceId, userId: james.id, suffix: "PA", specialty: "Wound care", stateLicenses: JSON.stringify(["NJ", "TX"]) },
    }),
  ]);

  // Online hours on every weekday for the next two weeks (Eastern): Dr. Chen all day, Okonkwo afternoons.
  const today = new Date();
  const days = weekdaysBetween(dateKey(new Date(today.getTime() + DAY)), dateKey(new Date(today.getTime() + 14 * DAY)));
  const windows = days.flatMap((d) => [
    { providerId: drChen.id, startsAt: zonedToUtc(d, "09:00", EASTERN)!, endsAt: zonedToUtc(d, "17:00", EASTERN)! },
    { providerId: okonkwo.id, startsAt: zonedToUtc(d, "13:00", EASTERN)!, endsAt: zonedToUtc(d, "17:00", EASTERN)! },
  ]);
  await prisma.telehealthAvailability.createMany({
    data: windows.map((w) => ({ practiceId, providerId: w.providerId, startsAt: w.startsAt, endsAt: w.endsAt, timezone: EASTERN, createdById: priya?.id ?? null })),
  });

  // One reservation in Dr. Chen's first window, mirrored on the calendar.
  const patient = await prisma.patient.findFirst({ where: { practiceId, mrn: "CH-100318" } });
  const location = await prisma.location.findFirst({ where: { practiceId }, orderBy: { name: "asc" } });
  const first = await prisma.telehealthAvailability.findFirst({ where: { providerId: drChen.id }, orderBy: { startsAt: "asc" } });
  if (patient && location && first) {
    const startsAt = new Date(first.startsAt.getTime() + BLOCK_MIN * 60_000);
    const endsAt = new Date(startsAt.getTime() + BLOCK_MIN * 60_000);
    const appointment = await prisma.appointment.create({
      data: {
        practiceId,
        patientId: patient.id,
        providerId: maya.id,
        locationId: location.id,
        startsAt,
        endsAt,
        visitType: "TELE_INIT",
        status: "SCHEDULED",
        reason: "Telehealth wound check, dressing review",
        placeOfService: "02",
        createdById: priya?.id ?? null,
      },
    });
    await prisma.telehealthReservation.create({
      data: {
        practiceId,
        providerId: drChen.id,
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
