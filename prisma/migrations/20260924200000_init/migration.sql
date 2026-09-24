-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Practice" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Practice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CLINICIAN',
    "passwordHash" TEXT NOT NULL,
    "npi" TEXT,
    "specialty" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderAvailability" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservedTime" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "locationId" TEXT,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservedTime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activePracticeId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "mrn" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dob" TIMESTAMP(3) NOT NULL,
    "sex" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "addressLine1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "preferredLanguage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Insurance" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "payerName" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "groupNumber" TEXT,
    "planName" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Insurance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allergy" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "allergen" TEXT NOT NULL,
    "reaction" TEXT NOT NULL,
    "severity" TEXT NOT NULL,

    CONSTRAINT "Allergy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Problem" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "icd10" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "onsetDate" TIMESTAMP(3),

    CONSTRAINT "Problem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Medication" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "prescriberId" TEXT,
    "name" TEXT NOT NULL,
    "sig" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "discontinuedAt" TIMESTAMP(3),

    CONSTRAINT "Medication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "visitType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Encounter" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL DEFAULT 'OFFICE',
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "chiefComplaint" TEXT,
    "subjective" TEXT,
    "objective" TEXT,
    "assessment" TEXT,
    "plan" TEXT,
    "patientStatus" TEXT,
    "mdmLevel" TEXT,
    "hospice" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Encounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncounterDiagnosis" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "icd10" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EncounterDiagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vitals" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "heightCm" DOUBLE PRECISION,
    "weightKg" DOUBLE PRECISION,
    "tempC" DOUBLE PRECISION,
    "heartRate" INTEGER,
    "respRate" INTEGER,
    "bpSystolic" INTEGER,
    "bpDiastolic" INTEGER,
    "spo2" INTEGER,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vitals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabOrder" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "orderedById" TEXT NOT NULL,
    "testName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ORDERED',
    "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabResult" (
    "id" TEXT NOT NULL,
    "labOrderId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "unit" TEXT,
    "referenceRange" TEXT,
    "flag" TEXT NOT NULL DEFAULT 'NORMAL',
    "resultedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "cptCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "amountCents" INTEGER NOT NULL,
    "modifiers" TEXT,
    "diagnosisPointers" TEXT,

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "payerName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "billedCents" INTEGER NOT NULL,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "adjustedCents" INTEGER NOT NULL DEFAULT 0,
    "denialReason" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PAYMENT',
    "note" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wound" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "etiology" TEXT NOT NULL,
    "onsetDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "healedDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WoundAssessment" (
    "id" TEXT NOT NULL,
    "woundId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lengthCm" DOUBLE PRECISION,
    "widthCm" DOUBLE PRECISION,
    "depthCm" DOUBLE PRECISION,
    "areaCm2" DOUBLE PRECISION,
    "underminingCm" DOUBLE PRECISION,
    "underminingClock" TEXT,
    "tunnelingCm" DOUBLE PRECISION,
    "tunnelingClock" TEXT,
    "stage" TEXT,
    "granulationPct" INTEGER,
    "sloughPct" INTEGER,
    "escharPct" INTEGER,
    "epithelialPct" INTEGER,
    "exudateAmount" TEXT,
    "exudateType" TEXT,
    "periwoundSkin" TEXT,
    "odor" BOOLEAN NOT NULL DEFAULT false,
    "painLevel" INTEGER,
    "pushExudateAmount" TEXT,
    "pushTissueType" TEXT,
    "pushSurfaceAreaScore" INTEGER,
    "pushExudateScore" INTEGER,
    "pushTissueScore" INTEGER,
    "pushTotal" INTEGER,
    "bwatItems" TEXT,
    "bwatTotal" INTEGER,
    "photoUrl" TEXT,
    "notes" TEXT,
    "assessedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WoundAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Debridement" (
    "id" TEXT NOT NULL,
    "woundAssessmentId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "tissueRemoved" TEXT,
    "cptCode" TEXT,
    "chargeId" TEXT,
    "performedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Debridement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Practice_slug_key" ON "Practice"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_practiceId_key" ON "Membership"("userId", "practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_practiceId_mrn_key" ON "Patient"("practiceId", "mrn");

-- CreateIndex
CREATE UNIQUE INDEX "Encounter_appointmentId_key" ON "Encounter"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Vitals_encounterId_key" ON "Vitals"("encounterId");

-- CreateIndex
CREATE UNIQUE INDEX "LabResult_labOrderId_key" ON "LabResult"("labOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_chargeId_key" ON "Claim"("chargeId");

-- CreateIndex
CREATE UNIQUE INDEX "Debridement_woundAssessmentId_key" ON "Debridement"("woundAssessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Debridement_chargeId_key" ON "Debridement"("chargeId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAvailability" ADD CONSTRAINT "ProviderAvailability_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAvailability" ADD CONSTRAINT "ProviderAvailability_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAvailability" ADD CONSTRAINT "ProviderAvailability_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservedTime" ADD CONSTRAINT "ReservedTime_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservedTime" ADD CONSTRAINT "ReservedTime_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservedTime" ADD CONSTRAINT "ReservedTime_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_activePracticeId_fkey" FOREIGN KEY ("activePracticeId") REFERENCES "Practice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insurance" ADD CONSTRAINT "Insurance_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allergy" ADD CONSTRAINT "Allergy_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_prescriberId_fkey" FOREIGN KEY ("prescriberId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncounterDiagnosis" ADD CONSTRAINT "EncounterDiagnosis_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vitals" ADD CONSTRAINT "Vitals_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_orderedById_fkey" FOREIGN KEY ("orderedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_labOrderId_fkey" FOREIGN KEY ("labOrderId") REFERENCES "LabOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wound" ADD CONSTRAINT "Wound_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wound" ADD CONSTRAINT "Wound_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WoundAssessment" ADD CONSTRAINT "WoundAssessment_woundId_fkey" FOREIGN KEY ("woundId") REFERENCES "Wound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WoundAssessment" ADD CONSTRAINT "WoundAssessment_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WoundAssessment" ADD CONSTRAINT "WoundAssessment_assessedById_fkey" FOREIGN KEY ("assessedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debridement" ADD CONSTRAINT "Debridement_woundAssessmentId_fkey" FOREIGN KEY ("woundAssessmentId") REFERENCES "WoundAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debridement" ADD CONSTRAINT "Debridement_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debridement" ADD CONSTRAINT "Debridement_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

