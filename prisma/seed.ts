import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();
const DEMO_PASSWORD_HASH = hashPassword("carehub123");

function atHour(dayOffset: number, hour: number, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function main() {
  await prisma.paymentApplication.deleteMany();
  await prisma.deposit.deleteMany();
  await prisma.claim.deleteMany();
  await prisma.debridement.deleteMany();
  await prisma.charge.deleteMany();
  await prisma.woundAssessment.deleteMany();
  await prisma.wound.deleteMany();
  await prisma.labResult.deleteMany();
  await prisma.labOrder.deleteMany();
  await prisma.vitals.deleteMany();
  await prisma.encounter.deleteMany();
  await prisma.reservedTime.deleteMany();
  await prisma.providerAvailability.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.medication.deleteMany();
  await prisma.problem.deleteMany();
  await prisma.allergy.deleteMany();
  await prisma.insurance.deleteMany();
  await prisma.patient.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.location.deleteMany();
  await prisma.practice.deleteMany();

  // --- Practice 1: Riverside Family Practice ---
  const riverside = await prisma.practice.create({
    data: { name: "Riverside Family Practice", slug: "riverside" },
  });

  const riversideMain = await prisma.location.create({
    data: {
      practiceId: riverside.id,
      name: "Main Clinic",
      addressLine1: "18 Harbor Lane",
      city: "Riverton",
      state: "NJ",
      zip: "08077",
      phone: "555-0100",
    },
  });

  const [horizonBcbs, aetna, medicare, ibx] = await Promise.all([
    prisma.payer.create({ data: { practiceId: riverside.id, name: "Horizon Blue Cross", payerCode: "HBC01" } }),
    prisma.payer.create({ data: { practiceId: riverside.id, name: "Aetna", payerCode: "AET01" } }),
    prisma.payer.create({ data: { practiceId: riverside.id, name: "Medicare", payerCode: "MCARE" } }),
    prisma.payer.create({ data: { practiceId: riverside.id, name: "Independence Blue Cross", payerCode: "IBX01" } }),
  ]);

  const drFoster = await prisma.referringPhysician.create({
    data: {
      practiceId: riverside.id,
      name: "Dr. Karen Foster",
      npi: "1467892345",
      specialty: "Podiatry",
      phone: "555-0177",
    },
  });

  const riversideBillingProvider = await prisma.billingProvider.create({
    data: {
      practiceId: riverside.id,
      name: "Riverside Family Practice PLLC",
      npi: "1699887766",
      taxId: "22-1234567",
      addressLine1: "18 Harbor Lane",
      city: "Riverton",
      state: "NJ",
      zip: "08077",
    },
  });

  await prisma.superbillTemplate.create({
    data: {
      practiceId: riverside.id,
      name: "Family medicine — common visits",
      items: {
        create: [
          { cptCode: "99213", description: "Office visit, established, low MDM", amountCents: 12500, order: 0 },
          { cptCode: "99214", description: "Office visit, established, moderate MDM", amountCents: 18500, order: 1 },
          { cptCode: "99396", description: "Preventive visit, established, 40-64y", amountCents: 21000, order: 2 },
          { cptCode: "36415", description: "Venipuncture", amountCents: 1500, order: 3 },
        ],
      },
    },
  });

  const [maya, james, priya, alex] = await Promise.all([
    prisma.user.create({
      data: {
        practiceId: riverside.id,
        name: "Maya Chen, MD",
        email: "maya.chen@carehub.local",
        role: "CLINICIAN",
        passwordHash: DEMO_PASSWORD_HASH,
        npi: "1234567890",
        specialty: "Family Medicine",
      },
    }),
    prisma.user.create({
      data: {
        practiceId: riverside.id,
        name: "James Okonkwo, PA-C",
        email: "james.okonkwo@carehub.local",
        role: "CLINICIAN",
        passwordHash: DEMO_PASSWORD_HASH,
        npi: "1987654321",
        specialty: "Internal Medicine",
      },
    }),
    prisma.user.create({
      data: {
        practiceId: riverside.id,
        name: "Priya Shah",
        email: "priya.shah@carehub.local",
        role: "FRONT_DESK",
        passwordHash: DEMO_PASSWORD_HASH,
      },
    }),
    prisma.user.create({
      data: {
        practiceId: riverside.id,
        name: "Alex Rivera",
        email: "alex.rivera@carehub.local",
        role: "BILLER",
        passwordHash: DEMO_PASSWORD_HASH,
      },
    }),
  ]);

  const admin = await prisma.user.create({
    data: {
      practiceId: riverside.id,
      name: "System Admin",
      email: "admin@carehub.local",
      role: "ADMIN",
      passwordHash: DEMO_PASSWORD_HASH,
    },
  });

  await prisma.membership.createMany({
    data: [
      { userId: maya.id, practiceId: riverside.id, role: "CLINICIAN" },
      { userId: james.id, practiceId: riverside.id, role: "CLINICIAN" },
      { userId: priya.id, practiceId: riverside.id, role: "FRONT_DESK" },
      { userId: alex.id, practiceId: riverside.id, role: "BILLER" },
      { userId: admin.id, practiceId: riverside.id, role: "ADMIN" },
    ],
  });

  const patients = await Promise.all([
    prisma.patient.create({
      data: {
        practiceId: riverside.id,
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
        referringPhysicianId: drFoster.id,
        race: "WHITE",
        ethnicity: "HISPANIC",
        maritalStatus: "MARRIED",
        employmentStatus: "FULL_TIME",
        smokingStatus: "NEVER",
        emergencyContactName: "Marco Vasquez",
        emergencyContactPhone: "555-0143",
        emergencyContactRelationship: "Spouse",
        guarantorName: "Elena Vasquez",
        guarantorRelationship: "Self",
        guarantorPhone: "555-0142",
        insurances: {
          create: {
            payerId: horizonBcbs.id,
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
        practiceId: riverside.id,
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
            payerId: aetna.id,
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
        practiceId: riverside.id,
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
            payerId: medicare.id,
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
        practiceId: riverside.id,
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
            payerId: ibx.id,
            memberId: "IBX-229001",
            planName: "Keystone HMO",
            isPrimary: true,
          },
        },
      },
    }),
  ]);

  const [elena, marcus, ruth, jamal] = patients;

  const sofia = await prisma.patient.create({
    data: {
      practiceId: riverside.id,
      mrn: "CH-100687",
      firstName: "Sofia",
      lastName: "Vasquez",
      dob: new Date("2012-09-02"),
      sex: "F",
      city: "Riverton",
      state: "NJ",
      zip: "08077",
      guarantorPatientId: elena.id,
      guarantorRelationship: "Mother",
      insurances: {
        create: {
          payerId: horizonBcbs.id,
          memberId: "HBC-882910",
          groupNumber: "GRP-441",
          planName: "PPO Gold",
          isPrimary: true,
        },
      },
    },
  });

  const sofiaEncounter = await prisma.encounter.create({
    data: {
      practiceId: riverside.id,
      patientId: sofia.id,
      providerId: maya.id,
      type: "OFFICE",
      status: "SIGNED",
      chiefComplaint: "Well-child check",
      billingProviderId: riversideBillingProvider.id,
    },
  });
  const sofiaCharge = await prisma.charge.create({
    data: {
      practiceId: riverside.id,
      encounterId: sofiaEncounter.id,
      cptCode: "99392",
      description: "Preventive visit, established, 1-4y",
      amountCents: 17500,
    },
  });
  await prisma.claim.create({
    data: {
      chargeId: sofiaCharge.id,
      payerName: "Horizon Blue Cross",
      status: "PARTIAL",
      billedCents: 17500,
      paidCents: 14000,
      submittedAt: new Date(),
      balanceResponsibility: "PATIENT",
    },
  });

  const weekdays = [1, 2, 3, 4, 5];
  await prisma.providerAvailability.createMany({
    data: weekdays.flatMap((dayOfWeek) => [
      { practiceId: riverside.id, providerId: maya.id, locationId: riversideMain.id, dayOfWeek, startTime: "09:00", endTime: "17:00" },
      { practiceId: riverside.id, providerId: james.id, locationId: riversideMain.id, dayOfWeek, startTime: "10:00", endTime: "18:00" },
    ]),
  });

  await prisma.reservedTime.create({
    data: {
      practiceId: riverside.id,
      providerId: maya.id,
      locationId: riversideMain.id,
      title: "Lunch",
      startsAt: atHour(0, 12, 0),
      endsAt: atHour(0, 13, 0),
    },
  });

  const appts = await Promise.all([
    prisma.appointment.create({
      data: {
        practiceId: riverside.id,
        locationId: riversideMain.id,
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
        practiceId: riverside.id,
        locationId: riversideMain.id,
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
        practiceId: riverside.id,
        locationId: riversideMain.id,
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
        practiceId: riverside.id,
        locationId: riversideMain.id,
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
      practiceId: riverside.id,
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
      billingProviderId: riversideBillingProvider.id,
    },
  });

  await prisma.encounter.update({
    where: { id: encounter.id },
    data: { patientStatus: "ESTABLISHED", mdmLevel: "MODERATE" },
  });

  const encounterDx1 = await prisma.encounterDiagnosis.create({
    data: { encounterId: encounter.id, icd10: "E11.9", description: "Type 2 diabetes mellitus", priority: 1 },
  });
  await prisma.encounterDiagnosis.create({
    data: { encounterId: encounter.id, icd10: "I10", description: "Essential hypertension", priority: 2 },
  });

  const charge = await prisma.charge.create({
    data: {
      practiceId: riverside.id,
      encounterId: encounter.id,
      cptCode: "99214",
      description: "Office visit, established, moderate MDM",
      units: 1,
      amountCents: 18500,
      modifiers: "25",
      diagnosisPointers: encounterDx1.id,
    },
  });

  const elenaClaim = await prisma.claim.create({
    data: {
      chargeId: charge.id,
      payerName: "Horizon Blue Cross",
      status: "PARTIAL",
      billedCents: 18500,
      paidCents: 14000,
      submittedAt: new Date(),
      balanceResponsibility: "PATIENT",
    },
  });

  const horizonDeposit = await prisma.deposit.create({
    data: {
      practiceId: riverside.id,
      payerType: "INSURANCE",
      payerName: "Horizon Blue Cross",
      paymentMethod: "EFT",
      checkNumber: "EFT-88213",
      totalCents: 14000,
      unappliedCents: 0,
      note: "ERA batch 2026-09",
    },
  });

  await prisma.paymentApplication.create({
    data: { depositId: horizonDeposit.id, claimId: elenaClaim.id, amountCents: 14000, type: "PAYMENT" },
  });

  // Wound care demo: diabetic foot ulcer for Elena, tracked across three
  // assessments to show BWAT/PUSH scoring and a healing trend.
  const footUlcer = await prisma.wound.create({
    data: {
      practiceId: riverside.id,
      patientId: elena.id,
      label: "Left plantar diabetic foot ulcer",
      location: "Left plantar surface, first metatarsal head",
      etiology: "DIABETIC_NEUROPATHIC",
      onsetDate: atHour(-42, 9),
      status: "ACTIVE",
    },
  });

  await prisma.woundAssessment.create({
    data: {
      woundId: footUlcer.id,
      encounterId: encounter.id,
      assessedById: maya.id,
      assessedAt: atHour(-42, 9),
      lengthCm: 3.2,
      widthCm: 2.4,
      depthCm: 0.6,
      areaCm2: 3.2 * 2.4,
      stage: "NA",
      granulationPct: 40,
      sloughPct: 50,
      escharPct: 0,
      epithelialPct: 10,
      exudateAmount: "MODERATE",
      exudateType: "SEROSANGUINEOUS",
      periwoundSkin: "Macerated, mild erythema",
      painLevel: 3,
      pushExudateAmount: "MODERATE",
      pushTissueType: "SLOUGH",
      pushSurfaceAreaScore: 6,
      pushExudateScore: 2,
      pushTissueScore: 3,
      pushTotal: 11,
      notes: "Initial assessment. Off-loading footwear ordered. Weekly sharp debridement planned.",
    },
  });

  const secondAssessment = await prisma.woundAssessment.create({
    data: {
      woundId: footUlcer.id,
      encounterId: encounter.id,
      assessedById: maya.id,
      assessedAt: atHour(-21, 9),
      lengthCm: 2.5,
      widthCm: 1.8,
      depthCm: 0.4,
      areaCm2: 2.5 * 1.8,
      stage: "NA",
      granulationPct: 65,
      sloughPct: 25,
      escharPct: 0,
      epithelialPct: 10,
      exudateAmount: "SMALL",
      exudateType: "SEROUS",
      periwoundSkin: "Improving, mild dryness",
      painLevel: 2,
      pushExudateAmount: "LIGHT",
      pushTissueType: "GRANULATION",
      pushSurfaceAreaScore: 5,
      pushExudateScore: 1,
      pushTissueScore: 2,
      pushTotal: 8,
      notes: "Good progress. Continue off-loading and weekly sharp debridement.",
    },
  });

  await prisma.debridement.create({
    data: {
      woundAssessmentId: secondAssessment.id,
      method: "SHARP",
      tissueRemoved: "Devitalized slough at wound margins",
      cptCode: "97597",
      performedById: maya.id,
    },
  });

  await prisma.woundAssessment.create({
    data: {
      woundId: footUlcer.id,
      encounterId: encounter.id,
      assessedById: maya.id,
      assessedAt: atHour(-7, 9),
      lengthCm: 1.6,
      widthCm: 1.1,
      depthCm: 0.2,
      areaCm2: 1.6 * 1.1,
      stage: "NA",
      granulationPct: 85,
      sloughPct: 5,
      escharPct: 0,
      epithelialPct: 10,
      exudateAmount: "SCANT",
      exudateType: "SEROUS",
      periwoundSkin: "Intact",
      painLevel: 1,
      pushExudateAmount: "LIGHT",
      pushTissueType: "GRANULATION",
      pushSurfaceAreaScore: 3,
      pushExudateScore: 1,
      pushTissueScore: 2,
      pushTotal: 6,
      notes: "Wound closing nicely. Continue current plan of care.",
    },
  });

  // --- Practice 2: Lakeside Pediatrics (proves tenant isolation) ---
  const lakeside = await prisma.practice.create({
    data: { name: "Lakeside Pediatrics", slug: "lakeside" },
  });

  const lakesideMain = await prisma.location.create({
    data: {
      practiceId: lakeside.id,
      name: "Lakeside Clinic",
      addressLine1: "42 Shoreline Dr",
      city: "Willowbrook",
      state: "NJ",
      zip: "08050",
      phone: "555-0200",
    },
  });

  const cigna = await prisma.payer.create({
    data: { practiceId: lakeside.id, name: "Cigna", payerCode: "CIG01" },
  });

  const dana = await prisma.user.create({
    data: {
      practiceId: lakeside.id,
      name: "Dana Whitfield, MD",
      email: "dana.whitfield@carehub.local",
      role: "CLINICIAN",
      passwordHash: DEMO_PASSWORD_HASH,
      npi: "1122334455",
      specialty: "Pediatrics",
    },
  });

  const lakesideAdmin = await prisma.user.create({
    data: {
      practiceId: lakeside.id,
      name: "Lakeside Admin",
      email: "admin@lakeside.local",
      role: "ADMIN",
      passwordHash: DEMO_PASSWORD_HASH,
    },
  });

  await prisma.membership.createMany({
    data: [
      { userId: dana.id, practiceId: lakeside.id, role: "CLINICIAN" },
      { userId: lakesideAdmin.id, practiceId: lakeside.id, role: "ADMIN" },
      // Alex's home practice is Riverside, but Lakeside has also granted them
      // billing access — this is the account to sign in with to see the
      // practice switcher in the top bar.
      { userId: alex.id, practiceId: lakeside.id, role: "BILLER" },
    ],
  });

  const oliver = await prisma.patient.create({
    data: {
      practiceId: lakeside.id,
      mrn: "LK-100001",
      firstName: "Oliver",
      lastName: "Bennett",
      dob: new Date("2016-05-09"),
      sex: "M",
      phone: "555-0311",
      city: "Willowbrook",
      state: "NJ",
      zip: "08050",
      insurances: {
        create: {
          payerId: cigna.id,
          memberId: "CIG-773311",
          planName: "PPO Family",
          isPrimary: true,
        },
      },
    },
  });

  await prisma.appointment.create({
    data: {
      practiceId: lakeside.id,
      locationId: lakesideMain.id,
      patientId: oliver.id,
      providerId: dana.id,
      startsAt: atHour(0, 13, 0),
      endsAt: atHour(0, 13, 20),
      visitType: "WELL",
      status: "SCHEDULED",
      reason: "Well-child check, age 9",
    },
  });

  console.log("Seeded 2 demo practices.");
  console.log({
    riverside: {
      admin: "admin@carehub.local",
      providers: [maya.email, james.email],
      frontDesk: priya.email,
      biller: alex.email,
    },
    lakeside: {
      admin: "admin@lakeside.local",
      provider: dana.email,
    },
    multiPracticeDemo: "alex.rivera@carehub.local is BILLER at both Riverside and Lakeside — sign in to see the practice switcher",
    password: "carehub123 (all seeded accounts)",
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
