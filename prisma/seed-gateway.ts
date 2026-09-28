// Patient Gateway demo data for the Riverside demo practice: one user per team and a case at every stage.
//
// Runs as part of `prisma db seed`, and can be run on its own against an existing database:
//   npx tsx prisma/seed-gateway.ts
// It does nothing if the practice already has gateway cases.
import { Prisma, PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const daysAhead = (n: number) => new Date(Date.now() + n * DAY);

export async function seedGateway(prisma: PrismaClient, practiceId: string, passwordHash: string) {
  if (await prisma.intakeCase.count({ where: { practiceId } })) return false;

  const teamUsers = [
    { name: "Grace Kim", email: "grace.kim@carehub.local", role: "INTAKE" },
    { name: "Victor Hale", email: "victor.hale@carehub.local", role: "VERIFICATION" },
    { name: "Sam Ortiz", email: "sam.ortiz@carehub.local", role: "SCHEDULER" },
  ];
  const users: Record<string, string> = {};
  for (const u of teamUsers) {
    const user =
      (await prisma.user.findUnique({ where: { email: u.email } })) ??
      (await prisma.user.create({ data: { practiceId, name: u.name, email: u.email, role: u.role, passwordHash } }));
    await prisma.membership.upsert({
      where: { userId_practiceId: { userId: user.id, practiceId } },
      update: {},
      create: { userId: user.id, practiceId, role: u.role },
    });
    users[u.role] = user.id;
  }

  const payer = async (name: string) => (await prisma.payer.findFirst({ where: { practiceId, name } }))?.id ?? null;
  const provider = async (lastName: string) =>
    (
      await prisma.renderingProvider.findFirst({
        where: { practiceId, isRendering: true, OR: [{ lastName }, { name: { contains: lastName } }] },
      })
    )?.id ?? null;
  const patient = async (mrn: string) => prisma.patient.findFirst({ where: { practiceId, mrn }, include: { insurances: true } });

  const [horizon, medicare, aetna, ibx] = await Promise.all(
    ["Horizon Blue Cross", "Medicare", "Aetna", "Independence Blue Cross"].map(payer)
  );
  const [chen, okonkwo] = await Promise.all(["Chen", "Okonkwo"].map(provider));
  const foster = await prisma.renderingProvider.findFirst({ where: { practiceId, isReferring: true } });

  // Two brand-new referrals waiting on data entry.
  const harold = await prisma.patient.create({
    data: {
      practiceId,
      mrn: "CH-100733",
      firstName: "Harold",
      lastName: "Price",
      dob: new Date("1946-09-03"),
      sex: "M",
      phone: "555-0171",
      insurances: { create: { payerId: medicare!, memberId: "1EG4-TE5-MK72", isPrimary: true } },
    },
  });
  const denise = await prisma.patient.create({
    data: {
      practiceId,
      mrn: "CH-100741",
      firstName: "Denise",
      lastName: "Carter",
      dob: new Date("1959-02-17"),
      sex: "F",
      phone: "555-0188",
      addressLine1: "41 Birch Lane",
      city: "Willowbrook",
      state: "NJ",
      zip: "08050",
      referringPhysicianId: foster?.id ?? null,
      insurances: { create: { payerId: horizon!, memberId: "HZN448812903", isPrimary: true } },
    },
  });

  const [elena, marcus, ruth, jamal, sofia] = await Promise.all(
    ["CH-100241", "CH-100318", "CH-100407", "CH-100512", "CH-100687"].map(patient)
  );

  type Seed = Prisma.IntakeCaseUncheckedCreateInput;
  const base = (patientId: string, stage: string, days: number): Seed =>
    ({ practiceId, patientId, stage, stageChangedAt: daysAgo(days), createdAt: daysAgo(days + 2), referralDate: daysAgo(days + 2) }) as Seed;

  const cases: { data: Seed; log: { role: string; stage: string; action: string; note: string; days: number }[] }[] = [
    {
      data: {
        ...base(harold.id, "DATA_ENTRY", 1),
        priority: "URGENT",
        ownerId: users.INTAKE,
        referralSourceType: "HOSPITAL",
        referralSourceName: "Riverside General — discharge planning",
        referralContactName: "Tanya (case manager)",
        referralContactPhone: "555-0900",
        servicesRequested: "Wound care — sacral pressure injury, stage 3",
        payerId: medicare,
        memberId: "1EG4-TE5-MK72",
      },
      log: [{ role: "INTAKE", stage: "DATA_ENTRY", action: "OPENED", note: "Discharge referral faxed in; address still needed", days: 1 }],
    },
    {
      data: {
        ...base(denise.id, "DATA_ENTRY", 0),
        referralSourceType: "PHYSICIAN",
        referralSourceName: "Foster Podiatry",
        servicesRequested: "Diabetic foot ulcer, R plantar",
        payerId: horizon,
        memberId: "HZN448812903",
      },
      log: [{ role: "INTAKE", stage: "DATA_ENTRY", action: "OPENED", note: "Intake case opened", days: 0 }],
    },
    {
      data: {
        ...base(elena!.id, "VERIFICATION", 2),
        ownerId: users.VERIFICATION,
        referralSourceType: "PHYSICIAN",
        referralSourceName: "Foster Podiatry",
        servicesRequested: "Venous leg ulcer follow-up",
        dataEntryCompletedAt: daysAgo(2),
        payerId: horizon,
        planSegment: "COMMERCIAL",
        memberId: elena!.insurances[0]?.memberId ?? null,
        eligibilityStatus: "ACTIVE",
        coverageEffectiveDate: new Date("2026-01-01"),
        copayCents: 3500,
        deductibleCents: 150000,
        deductibleMetCents: 42000,
        coinsurancePercent: 20,
        verifiedAt: daysAgo(1),
        verifiedWith: "Availity + rep Maria",
        verificationReference: "CALL-55821",
        assignedProviderId: okonkwo,
      },
      log: [
        { role: "INTAKE", stage: "DATA_ENTRY", action: "SEND_TO_VERIFICATION", note: "Sent to verification", days: 2 },
        { role: "VERIFICATION", stage: "VERIFICATION", action: "VERIFICATION_SAVED", note: "Eligibility: Active coverage", days: 1 },
      ],
    },
    {
      data: {
        ...base(marcus!.id, "AUTH_PENDING", 4),
        ownerId: users.VERIFICATION,
        referralSourceType: "PAYER",
        referralSourceName: "Aetna case management",
        servicesRequested: "Pulmonary rehab evaluation",
        dataEntryCompletedAt: daysAgo(6),
        payerId: aetna,
        planSegment: "COMMERCIAL",
        memberId: marcus!.insurances[0]?.memberId ?? null,
        eligibilityStatus: "ACTIVE",
        verifiedAt: daysAgo(5),
        verifiedWith: "Aetna portal",
        authRequired: "YES",
        authStatus: "SUBMITTED",
        authSubmittedAt: daysAgo(4),
        authNotes: "Clinicals faxed 555-0199; TAT 5-7 business days",
        referralRequired: "NO",
        referralStatus: "NOT_REQUIRED",
        assignedProviderId: chen,
      },
      log: [{ role: "VERIFICATION", stage: "VERIFICATION", action: "AUTH_UPDATED", note: "Submitted", days: 4 }],
    },
    {
      data: {
        ...base(ruth!.id, "PCC_REFERRAL", 3),
        referralSourceType: "SNF",
        referralSourceName: "Maple Grove Senior Living",
        servicesRequested: "Arterial ulcer L heel",
        dataEntryCompletedAt: daysAgo(5),
        payerId: medicare,
        planSegment: "MEDICARE",
        memberId: ruth!.insurances[0]?.memberId ?? null,
        eligibilityStatus: "ACTIVE",
        verifiedAt: daysAgo(4),
        verifiedWith: "Novitas IVR",
        authRequired: "NO",
        authStatus: "NOT_REQUIRED",
        referralRequired: "YES",
        referralStatus: "SENT_TO_PCC",
        pccSentAt: daysAgo(3),
        pccNotes: "PCP Dr. Alvarez, fax 555-0144. Need referral for wound care eval + 6 visits.",
        assignedProviderId: chen,
      },
      log: [{ role: "VERIFICATION", stage: "VERIFICATION", action: "SENT_TO_PCC", note: "With PCC team", days: 3 }],
    },
    {
      data: {
        ...base(jamal!.id, "SCHEDULING", 1),
        ownerId: users.SCHEDULER,
        referralSourceType: "SELF",
        referralSourceName: "Patient self-referral",
        servicesRequested: "Surgical wound check",
        dataEntryCompletedAt: daysAgo(6),
        payerId: ibx,
        memberId: jamal!.insurances[0]?.memberId ?? null,
        eligibilityStatus: "ACTIVE",
        verifiedAt: daysAgo(3),
        verifiedWith: "IBX NaviNet",
        authRequired: "YES",
        authStatus: "APPROVED",
        authNumber: "IBX-A-7734102",
        authSubmittedAt: daysAgo(5),
        authDecisionAt: daysAgo(2),
        authStartDate: daysAgo(2),
        authEndDate: daysAhead(10),
        authVisitsApproved: 6,
        referralRequired: "NO",
        referralStatus: "NOT_REQUIRED",
        assignedProviderId: chen,
        networkOverrideNote: "Single-case agreement approved by IBX (ref SCA-2291)",
        approvedForServiceAt: daysAgo(1),
        consentTreatment: true,
        consentHipaa: true,
        pcpName: "Dr. Priya Nair",
        pcpPhone: "555-0122",
        referralAppStatus: "IN_PROGRESS",
      },
      log: [
        { role: "VERIFICATION", stage: "VERIFICATION", action: "AUTH_APPROVED", note: "Auth approved · #IBX-A-7734102", days: 2 },
        { role: "VERIFICATION", stage: "VERIFICATION", action: "APPROVE_FOR_SERVICE", note: "Approved for service", days: 1 },
      ],
    },
    {
      data: {
        ...base(sofia!.id, "SCHEDULED", 5),
        ownerId: users.SCHEDULER,
        referralSourceType: "PHYSICIAN",
        referralSourceName: "Riverside Pediatrics",
        servicesRequested: "Follow-up care",
        dataEntryCompletedAt: daysAgo(12),
        payerId: horizon,
        planSegment: "COMMERCIAL",
        memberId: sofia!.insurances[0]?.memberId ?? null,
        eligibilityStatus: "ACTIVE",
        copayCents: 2500,
        verifiedAt: daysAgo(10),
        verifiedWith: "Availity",
        authRequired: "NO",
        authStatus: "NOT_REQUIRED",
        referralRequired: "NO",
        referralStatus: "NOT_REQUIRED",
        assignedProviderId: chen,
        approvedForServiceAt: daysAgo(8),
        consentTreatment: true,
        consentHipaa: true,
        consentFinancial: true,
        consentAssignment: true,
        consentsCompletedAt: daysAgo(6),
        referralAppStatus: "NOT_NEEDED",
        scheduledAt: daysAgo(5),
        careStatus: "ACTIVE",
        providerBrief: "Guardian (mother) attends all visits. Copay $25 collected at check-in. Prefers morning slots.",
      },
      log: [{ role: "SCHEDULER", stage: "SCHEDULING", action: "MARK_SCHEDULED", note: "Scheduled", days: 5 }],
    },
  ];

  for (const c of cases) {
    const created = await prisma.intakeCase.create({ data: c.data });
    for (const a of c.log) {
      await prisma.intakeActivity.create({
        data: { caseId: created.id, userId: users[a.role], stage: a.stage, action: a.action, note: a.note, createdAt: daysAgo(a.days) },
      });
    }
  }
  return true;
}

if (require.main === module) {
  const prisma = new PrismaClient();
  (async () => {
    const practice = await prisma.practice.findUnique({ where: { slug: "riverside" } });
    if (!practice) throw new Error("Riverside demo practice not found — run the main seed first");
    const done = await seedGateway(prisma, practice.id, hashPassword("carehub123"));
    console.log(done ? "Seeded Patient Gateway demo cases." : "Gateway cases already exist; nothing to do.");
  })()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
