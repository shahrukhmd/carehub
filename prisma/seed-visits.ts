// Visit workflow demo data for the Riverside demo practice: a CDS coder and one visit at each post-visit stage.
//
// Runs as part of `prisma db seed`, and can be run on its own against an existing database:
//   npx tsx prisma/seed-visits.ts
// It does nothing if the CDS demo user already exists.
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number, hour = 10) => {
  const d = new Date(Date.now() - n * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
};

export async function seedVisits(prisma: PrismaClient, practiceId: string, passwordHash: string) {
  const email = "carmen.diaz@carehub.local";
  if (await prisma.user.findUnique({ where: { email } })) return false;

  const cds = await prisma.user.create({
    data: { practiceId, name: "Carmen Diaz, CPC", email, role: "CDS", passwordHash },
  });
  await prisma.membership.create({ data: { userId: cds.id, practiceId, role: "CDS" } });

  const userByEmail = async (e: string) => prisma.user.findUnique({ where: { email: e } });
  const [maya, james] = await Promise.all([userByEmail("maya.chen@carehub.local"), userByEmail("james.okonkwo@carehub.local")]);
  if (!maya || !james) return false;

  // Dr. Chen supervises James Okonkwo, PA-C, so his visits need her co-signature.
  const mayaRp = await prisma.renderingProvider.findFirst({ where: { practiceId, userId: maya.id } });
  const jamesRp = await prisma.renderingProvider.findFirst({ where: { practiceId, userId: james.id } });
  if (mayaRp) await prisma.renderingProvider.update({ where: { id: mayaRp.id }, data: { isSupervising: true } });
  if (jamesRp && mayaRp) {
    await prisma.renderingProvider.update({
      where: { id: jamesRp.id },
      data: { requiresSupervision: true, supervisingProviderId: mayaRp.id },
    });
  }

  const patient = (mrn: string) => prisma.patient.findFirst({ where: { practiceId, mrn } });
  const [marcus, ruth, jamal] = await Promise.all(["CH-100318", "CH-100407", "CH-100512"].map(patient));
  const group = await prisma.billingProvider.findFirst({ where: { practiceId } });
  if (!marcus || !ruth || !jamal) return false;

  const note = {
    subjective: "Patient reports the wound is less painful (3/10). Dressing changes done daily by caregiver. No fever or chills.",
    objective: "Afebrile. Wound bed 80% granulation, 20% slough. Mild serous drainage. Periwound intact, no erythema.",
    assessment: "Chronic ulcer improving with current plan of care.",
    plan: "Continue alginate dressing, offloading. Selective debridement next visit if slough persists. Follow up in 1 week.",
  };

  // 1. Ready for CDS — James (supervised by Dr. Chen) finished documenting.
  await prisma.encounter.create({
    data: {
      practiceId,
      patientId: marcus.id,
      providerId: james.id,
      date: daysAgo(1),
      type: "OFFICE",
      status: "READY_FOR_CDS",
      statusChangedAt: daysAgo(1, 15),
      submittedToCdsAt: daysAgo(1, 15),
      placeOfService: "11",
      supervisingProviderId: mayaRp?.id ?? null,
      chiefComplaint: "Follow-up, venous ulcer left lower leg",
      ...note,
      vitals: { create: { bpSystolic: 132, bpDiastolic: 84, heartRate: 76, respRate: 16, tempC: 36.8, spo2: 97 } },
      diagnoses: {
        create: [
          { icd10: "I83.022", description: "Varicose veins of left lower extremity with ulcer of calf", priority: 1 },
          { icd10: "L97.222", description: "Non-pressure chronic ulcer of left calf with fat layer exposed", priority: 2 },
        ],
      },
      events: {
        create: [
          { userId: james.id, toStatus: "IN_PROGRESS", note: "Visit started", createdAt: daysAgo(1, 10) },
          { userId: james.id, fromStatus: "IN_PROGRESS", toStatus: "READY_FOR_CDS", note: "Documentation complete", createdAt: daysAgo(1, 15) },
        ],
      },
    },
  });

  // 2. CDS query — returned to Dr. Chen for missing wound documentation.
  await prisma.encounter.create({
    data: {
      practiceId,
      patientId: ruth.id,
      providerId: maya.id,
      date: daysAgo(2),
      type: "OFFICE",
      status: "CDS_QUERY",
      statusChangedAt: daysAgo(1, 9),
      submittedToCdsAt: daysAgo(2, 16),
      placeOfService: "31",
      chiefComplaint: "Arterial ulcer left heel",
      ...note,
      cdsQueryNote: "Debridement billed but depth of tissue removed isn't documented. Please add wound measurements (L x W x D) and the debridement depth.",
      diagnoses: { create: [{ icd10: "I70.245", description: "Atherosclerosis of native arteries of left leg with ulceration of other part of foot", priority: 1 }] },
      events: {
        create: [
          { userId: maya.id, fromStatus: "IN_PROGRESS", toStatus: "READY_FOR_CDS", note: "Documentation complete", createdAt: daysAgo(2, 16) },
          { userId: cds.id, fromStatus: "READY_FOR_CDS", toStatus: "CDS_QUERY", note: "Missing wound measurements and debridement depth", createdAt: daysAgo(1, 9) },
        ],
      },
    },
  });

  // 3. Ready for signature — CDS coded the superbill; Dr. Chen needs to sign.
  const c = await prisma.encounter.create({
    data: {
      practiceId,
      patientId: jamal.id,
      providerId: maya.id,
      date: daysAgo(3),
      type: "OFFICE",
      status: "READY_FOR_SIGNATURE",
      statusChangedAt: daysAgo(1, 11),
      submittedToCdsAt: daysAgo(3, 16),
      codedById: cds.id,
      codedAt: daysAgo(1, 11),
      placeOfService: "11",
      billingProviderId: group?.id ?? null,
      mdmLevel: "LOW",
      patientStatus: "ESTABLISHED",
      chiefComplaint: "Surgical wound check, right knee",
      ...note,
      diagnoses: { create: [{ icd10: "Z48.817", description: "Encounter for surgical aftercare following surgery on the skin", priority: 1 }] },
      events: {
        create: [
          { userId: maya.id, fromStatus: "IN_PROGRESS", toStatus: "READY_FOR_CDS", note: "Documentation complete", createdAt: daysAgo(3, 16) },
          { userId: cds.id, fromStatus: "READY_FOR_CDS", toStatus: "READY_FOR_SIGNATURE", note: "Superbill coded, sent to provider for signature", createdAt: daysAgo(1, 11) },
        ],
      },
    },
    include: { diagnoses: true },
  });
  await prisma.charge.create({
    data: {
      practiceId,
      encounterId: c.id,
      cptCode: "99213",
      description: "Office visit, established patient, low MDM",
      amountCents: 12500,
      diagnosisPointers: c.diagnoses[0].id,
      placeOfService: "11",
    },
  });
  return true;
}

if (require.main === module) {
  const prisma = new PrismaClient();
  (async () => {
    const practice = await prisma.practice.findUnique({ where: { slug: "riverside" } });
    if (!practice) throw new Error("Riverside demo practice not found — run the main seed first");
    const done = await seedVisits(prisma, practice.id, hashPassword("carehub123"));
    console.log(done ? "Seeded visit workflow demo." : "Visit workflow demo already present; nothing to do.");
  })()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
