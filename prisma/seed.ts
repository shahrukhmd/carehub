import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function atHour(dayOffset: number, hour: number, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function main() {
  await prisma.claim.deleteMany();
  await prisma.charge.deleteMany();
  await prisma.encounter.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.medication.deleteMany();
  await prisma.problem.deleteMany();
  await prisma.allergy.deleteMany();
  await prisma.insurance.deleteMany();
  await prisma.patient.deleteMany();
  await prisma.user.deleteMany();

  const [maya, james, priya, alex] = await Promise.all([
    prisma.user.create({
      data: {
        name: "Maya Chen, MD",
        email: "maya.chen@carehub.local",
        role: "CLINICIAN",
        npi: "1234567890",
        specialty: "Family Medicine",
      },
    }),
    prisma.user.create({
      data: {
        name: "James Okonkwo, PA-C",
        email: "james.okonkwo@carehub.local",
        role: "CLINICIAN",
        npi: "1987654321",
        specialty: "Internal Medicine",
      },
    }),
    prisma.user.create({
      data: {
        name: "Priya Shah",
        email: "priya.shah@carehub.local",
        role: "FRONT_DESK",
      },
    }),
    prisma.user.create({
      data: {
        name: "Alex Rivera",
        email: "alex.rivera@carehub.local",
        role: "BILLER",
      },
    }),
  ]);

  const patients = await Promise.all([
    prisma.patient.create({
      data: {
        mrn: "CH-100241",
        firstName: "Elena",
        lastName: "Vasquez",
        dob: new Date("1978-04-12"),
        sex: "F",
        phone: "555-0142",
        email: "elena.v@example.com",
        addressLine1: "18 Harbor Lane",
        city: "Riverton",
        state: "NJ",
        zip: "08077",
        preferredLanguage: "English",
        insurances: {
          create: {
            payerName: "Horizon Blue Cross",
            memberId: "HBC-882910",
            groupNumber: "GRP-441",
            planName: "PPO Gold",
            isPrimary: true,
          },
        },
        allergies: {
          create: { allergen: "Penicillin", reaction: "Rash", severity: "MODERATE" },
        },
        problems: {
          create: [
            { icd10: "E11.9", description: "Type 2 diabetes mellitus", status: "ACTIVE", onsetDate: new Date("2019-06-01") },
            { icd10: "I10", description: "Essential hypertension", status: "ACTIVE", onsetDate: new Date("2016-02-01") },
          ],
        },
        medications: {
          create: [
            { name: "Metformin 1000 mg", sig: "1 tab PO BID", status: "ACTIVE" },
            { name: "Lisinopril 20 mg", sig: "1 tab PO daily", status: "ACTIVE" },
          ],
        },
      },
    }),
    prisma.patient.create({
      data: {
        mrn: "CH-100318",
        firstName: "Marcus",
        lastName: "Hale",
        dob: new Date("1991-11-03"),
        sex: "M",
        phone: "555-0198",
        city: "Camden",
        state: "NJ",
        zip: "08102",
        insurances: {
          create: {
            payerName: "Aetna",
            memberId: "AET-441902",
            planName: "HMO Standard",
            isPrimary: true,
          },
        },
        problems: {
          create: { icd10: "J45.909", description: "Unspecified asthma", status: "ACTIVE" },
        },
        medications: {
          create: { name: "Albuterol HFA", sig: "2 puffs PRN", status: "ACTIVE" },
        },
      },
    }),
    prisma.patient.create({
      data: {
        mrn: "CH-100407",
        firstName: "Ruth",
        lastName: "Kim",
        dob: new Date("1954-08-22"),
        sex: "F",
        phone: "555-0114",
        city: "Cherry Hill",
        state: "NJ",
        zip: "08002",
        insurances: {
          create: {
            payerName: "Medicare",
            memberId: "1EG4-TE5-MK72",
            planName: "Medicare Part B",
            isPrimary: true,
          },
        },
        allergies: {
          create: { allergen: "Sulfa", reaction: "Hives", severity: "SEVERE" },
        },
        problems: {
          create: { icd10: "M17.11", description: "Unilateral primary osteoarthritis, right knee", status: "ACTIVE" },
        },
      },
    }),
    prisma.patient.create({
      data: {
        mrn: "CH-100512",
        firstName: "Jamal",
        lastName: "Brooks",
        dob: new Date("2008-01-17"),
        sex: "M",
        phone: "555-0166",
        city: "Philadelphia",
        state: "PA",
        zip: "19147",
        preferredLanguage: "English",
        insurances: {
          create: {
            payerName: "Independence Blue Cross",
            memberId: "IBX-229001",
            planName: "Keystone HMO",
            isPrimary: true,
          },
        },
      },
    }),
  ]);

  const [elena, marcus, ruth, jamal] = patients;

  const appts = await Promise.all([
    prisma.appointment.create({
      data: {
        patientId: elena.id,
        providerId: maya.id,
        startsAt: atHour(0, 9, 0),
        endsAt: atHour(0, 9, 30),
        visitType: "FOLLOW_UP",
        status: "CHECKED_IN",
        reason: "Diabetes follow-up, A1c review",
      },
    }),
    prisma.appointment.create({
      data: {
        patientId: marcus.id,
        providerId: james.id,
        startsAt: atHour(0, 10, 0),
        endsAt: atHour(0, 10, 20),
        visitType: "SICK",
        status: "SCHEDULED",
        reason: "Wheeze after exercise",
      },
    }),
    prisma.appointment.create({
      data: {
        patientId: ruth.id,
        providerId: maya.id,
        startsAt: atHour(0, 11, 0),
        endsAt: atHour(0, 11, 40),
        visitType: "NEW",
        status: "SCHEDULED",
        reason: "Knee pain, new patient",
      },
    }),
    prisma.appointment.create({
      data: {
        patientId: jamal.id,
        providerId: james.id,
        startsAt: atHour(1, 14, 0),
        endsAt: atHour(1, 14, 20),
        visitType: "WELL",
        status: "SCHEDULED",
        reason: "Sports physical",
      },
    }),
  ]);

  const encounter = await prisma.encounter.create({
    data: {
      patientId: elena.id,
      providerId: maya.id,
      appointmentId: appts[0].id,
      type: "OFFICE",
      status: "IN_PROGRESS",
      chiefComplaint: "Follow-up diabetes and blood pressure",
      subjective:
        "Patient reports improved fasting glucose with metformin. Occasional AM headaches. Denies chest pain, polyuria, or vision changes.",
      objective:
        "BP 138/84, HR 72, BMI 29.4. Lungs clear. No LE edema. Foot exam intact.",
      assessment: "T2DM, improving. HTN, not at goal.",
      plan: "Repeat A1c. Increase lisinopril to 20 mg daily. Return in 3 months. Diabetic foot education.",
    },
  ]);

  const charge = await prisma.charge.create({
    data: {
      encounterId: encounter.id,
      cptCode: "99214",
      description: "Office visit, established, moderate MDM",
      units: 1,
      amountCents: 18500,
      icd10: "E11.9",
    },
  });

  await prisma.claim.create({
    data: {
      chargeId: charge.id,
      payerName: "Horizon Blue Cross",
      status: "SUBMITTED",
      billedCents: 18500,
      paidCents: 0,
      submittedAt: new Date(),
    },
  });

  await prisma.user.create({
    data: {
      name: "System Admin",
      email: "admin@carehub.local",
      role: "ADMIN",
    },
  });

  console.log("Seeded CareHub demo clinic.");
  console.log({ providers: [maya.email, james.email], frontDesk: priya.email, biller: alex.email });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
