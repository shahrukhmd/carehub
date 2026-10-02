-- CreateTable
CREATE TABLE "Disclosure" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "disclosedAt" DATETIME NOT NULL,
    "recipient" TEXT NOT NULL,
    "recipientAddress" TEXT,
    "purpose" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "method" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Disclosure_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Disclosure_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AmendmentRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "requestedAt" DATETIME NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "requestText" TEXT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "dueAt" DATETIME NOT NULL,
    "decidedAt" DATETIME,
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "denialReason" TEXT,
    "patientNotifiedAt" DATETIME,
    "disagreement" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AmendmentRequest_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AmendmentRequest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmergencyAccess" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "grantedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "reviewNote" TEXT,
    CONSTRAINT "EmergencyAccess_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EmergencyAccess_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CareTeamMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "specialty" TEXT,
    "organization" TEXT,
    "phone" TEXT,
    "fax" TEXT,
    "email" TEXT,
    "userId" TEXT,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CareTeamMember_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CareTeamMember_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HealthConcern" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "concern" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'CLINICAL',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "notes" TEXT,
    "createdById" TEXT,
    CONSTRAINT "HealthConcern_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HealthConcern_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PatientGoal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PROVIDER',
    "concernId" TEXT,
    "interventions" TEXT,
    "targetDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "progressNote" TEXT,
    "closedAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PatientGoal_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PatientGoal_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PatientGoal_concernId_fkey" FOREIGN KEY ("concernId") REFERENCES "HealthConcern" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImplantableDevice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "udi" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "lotNumber" TEXT,
    "serialNumber" TEXT,
    "site" TEXT,
    "implantedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "removedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImplantableDevice_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImplantableDevice_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SdohScreening" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "screenedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "declined" BOOLEAN NOT NULL DEFAULT false,
    "answers" TEXT NOT NULL DEFAULT '{}',
    "needs" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "screenedById" TEXT,
    CONSTRAINT "SdohScreening_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SdohScreening_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomField" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'TEXT',
    "options" TEXT,
    "helpText" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomField_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VaccineLot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "vaccine" TEXT NOT NULL,
    "cvxCode" TEXT,
    "manufacturer" TEXT,
    "lotNumber" TEXT NOT NULL,
    "expirationDate" DATETIME,
    "dosesReceived" INTEGER NOT NULL,
    "dosesOnHand" INTEGER NOT NULL,
    "funding" TEXT NOT NULL DEFAULT 'PRIVATE',
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "VaccineLot_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ConnectSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "displayName" TEXT,
    "brandColor" TEXT NOT NULL DEFAULT '#171342',
    "accentColor" TEXT NOT NULL DEFAULT '#4f9c60',
    "logo" TEXT,
    "welcomeText" TEXT,
    "supportPhone" TEXT,
    "smsProvider" TEXT NOT NULL DEFAULT 'MOCK',
    "emailProvider" TEXT NOT NULL DEFAULT 'MOCK',
    "linkDays" INTEGER NOT NULL DEFAULT 14,
    "languages" TEXT NOT NULL DEFAULT 'en',
    "updatedAt" DATETIME NOT NULL,
    "bookingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bookingToken" TEXT,
    "bookingApproval" BOOLEAN NOT NULL DEFAULT true,
    "bookingNewPatients" BOOLEAN NOT NULL DEFAULT true,
    "bookingLeadHours" INTEGER NOT NULL DEFAULT 24,
    "bookingWindowDays" INTEGER NOT NULL DEFAULT 30,
    "bookingMessage" TEXT,
    "paymentsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "paymentProvider" TEXT NOT NULL DEFAULT 'TEST',
    "requireTextConsent" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ConnectSettings_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ConnectSettings" ("accentColor", "bookingApproval", "bookingEnabled", "bookingLeadHours", "bookingMessage", "bookingNewPatients", "bookingToken", "bookingWindowDays", "brandColor", "displayName", "emailProvider", "id", "languages", "linkDays", "logo", "paymentProvider", "paymentsEnabled", "practiceId", "smsProvider", "supportPhone", "updatedAt", "welcomeText") SELECT "accentColor", "bookingApproval", "bookingEnabled", "bookingLeadHours", "bookingMessage", "bookingNewPatients", "bookingToken", "bookingWindowDays", "brandColor", "displayName", "emailProvider", "id", "languages", "linkDays", "logo", "paymentProvider", "paymentsEnabled", "practiceId", "smsProvider", "supportPhone", "updatedAt", "welcomeText" FROM "ConnectSettings";
DROP TABLE "ConnectSettings";
ALTER TABLE "new_ConnectSettings" RENAME TO "ConnectSettings";
CREATE UNIQUE INDEX "ConnectSettings_practiceId_key" ON "ConnectSettings"("practiceId");
CREATE UNIQUE INDEX "ConnectSettings_bookingToken_key" ON "ConnectSettings"("bookingToken");
CREATE TABLE "new_Encounter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    "billingProviderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "statusChangedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "placeOfService" TEXT,
    "clinicalStaffId" TEXT,
    "supervisingProviderId" TEXT,
    "submittedToCdsAt" DATETIME,
    "cdsQueryNote" TEXT,
    "codedById" TEXT,
    "codedAt" DATETIME,
    "finalizedAt" DATETIME,
    "holdReason" TEXT,
    "holdFromStatus" TEXT,
    "billingStatus" TEXT NOT NULL DEFAULT 'OPEN',
    "workflowId" TEXT,
    "medsReconciledAt" DATETIME,
    "allergiesReconciledAt" DATETIME,
    "problemsReconciledAt" DATETIME,
    "reconciledById" TEXT,
    "transferOfCare" BOOLEAN NOT NULL DEFAULT false,
    "copiedFromEncounterId" TEXT,
    CONSTRAINT "Encounter_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Encounter_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Encounter_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Encounter_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Encounter_billingProviderId_fkey" FOREIGN KEY ("billingProviderId") REFERENCES "BillingProvider" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Encounter_clinicalStaffId_fkey" FOREIGN KEY ("clinicalStaffId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Encounter_supervisingProviderId_fkey" FOREIGN KEY ("supervisingProviderId") REFERENCES "RenderingProvider" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Encounter_codedById_fkey" FOREIGN KEY ("codedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Encounter_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "ChartWorkflow" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Encounter" ("appointmentId", "assessment", "billingProviderId", "billingStatus", "cdsQueryNote", "chiefComplaint", "clinicalStaffId", "codedAt", "codedById", "createdAt", "date", "finalizedAt", "holdFromStatus", "holdReason", "hospice", "id", "mdmLevel", "objective", "patientId", "patientStatus", "placeOfService", "plan", "practiceId", "providerId", "status", "statusChangedAt", "subjective", "submittedToCdsAt", "supervisingProviderId", "type", "updatedAt", "workflowId") SELECT "appointmentId", "assessment", "billingProviderId", "billingStatus", "cdsQueryNote", "chiefComplaint", "clinicalStaffId", "codedAt", "codedById", "createdAt", "date", "finalizedAt", "holdFromStatus", "holdReason", "hospice", "id", "mdmLevel", "objective", "patientId", "patientStatus", "placeOfService", "plan", "practiceId", "providerId", "status", "statusChangedAt", "subjective", "submittedToCdsAt", "supervisingProviderId", "type", "updatedAt", "workflowId" FROM "Encounter";
DROP TABLE "Encounter";
ALTER TABLE "new_Encounter" RENAME TO "Encounter";
CREATE UNIQUE INDEX "Encounter_appointmentId_key" ON "Encounter"("appointmentId");
CREATE TABLE "new_Immunization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "vaccine" TEXT NOT NULL,
    "cvxCode" TEXT,
    "administeredAt" DATETIME NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ADMINISTERED',
    "lotNumber" TEXT,
    "manufacturer" TEXT,
    "expirationDate" DATETIME,
    "site" TEXT,
    "route" TEXT,
    "doseMl" REAL,
    "administeredById" TEXT,
    "refusalReason" TEXT,
    "visDate" DATETIME,
    "notes" TEXT,
    "reportedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lotId" TEXT,
    CONSTRAINT "Immunization_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Immunization_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Immunization_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "VaccineLot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Immunization" ("administeredAt", "administeredById", "createdAt", "cvxCode", "doseMl", "encounterId", "expirationDate", "id", "lotNumber", "manufacturer", "notes", "patientId", "practiceId", "refusalReason", "reportedAt", "route", "site", "source", "vaccine", "visDate") SELECT "administeredAt", "administeredById", "createdAt", "cvxCode", "doseMl", "encounterId", "expirationDate", "id", "lotNumber", "manufacturer", "notes", "patientId", "practiceId", "refusalReason", "reportedAt", "route", "site", "source", "vaccine", "visDate" FROM "Immunization";
DROP TABLE "Immunization";
ALTER TABLE "new_Immunization" RENAME TO "Immunization";
CREATE INDEX "Immunization_practiceId_administeredAt_idx" ON "Immunization"("practiceId", "administeredAt");
CREATE TABLE "new_Patient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "mrn" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dob" DATETIME NOT NULL,
    "sex" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "addressLine1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "preferredLanguage" TEXT,
    "referringPhysicianId" TEXT,
    "race" TEXT,
    "ethnicity" TEXT,
    "maritalStatus" TEXT,
    "employmentStatus" TEXT,
    "smokingStatus" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "emergencyContactRelationship" TEXT,
    "guarantorName" TEXT,
    "guarantorRelationship" TEXT,
    "guarantorPhone" TEXT,
    "guarantorPatientId" TEXT,
    "guarantorAddress" TEXT,
    "preferredName" TEXT,
    "middleName" TEXT,
    "suffix" TEXT,
    "ssnLast4" TEXT,
    "genderIdentity" TEXT,
    "sexualOrientation" TEXT,
    "pronoun" TEXT,
    "races" TEXT,
    "religion" TEXT,
    "tribalAffiliation" TEXT,
    "interpreterNeeded" BOOLEAN NOT NULL DEFAULT false,
    "preferredCommunication" TEXT,
    "careCenterId" TEXT,
    "previousFirstName" TEXT,
    "previousMiddleName" TEXT,
    "previousLastName" TEXT,
    "nameChangedAt" DATETIME,
    "occupation" TEXT,
    "occupationIndustry" TEXT,
    "phoneType" TEXT,
    "phone2" TEXT,
    "phone2Type" TEXT,
    "noEmail" BOOLEAN NOT NULL DEFAULT false,
    "currentAddress" TEXT NOT NULL DEFAULT 'PRIMARY',
    "addressLine2" TEXT,
    "county" TEXT,
    "secondaryAddress" TEXT,
    "previousAddress" TEXT,
    "siteOfServiceId" TEXT,
    "admissionDate" DATETIME,
    "consult" BOOLEAN NOT NULL DEFAULT false,
    "palliativeCare" BOOLEAN NOT NULL DEFAULT false,
    "medicareAdmission" TEXT,
    "nonWoundDiagnosis" BOOLEAN NOT NULL DEFAULT false,
    "howHeard" TEXT,
    "onsetDate" DATETIME,
    "autoAccident" BOOLEAN NOT NULL DEFAULT false,
    "autoAccidentState" TEXT,
    "autoAccidentDate" DATETIME,
    "woundCarePhysicianId" TEXT,
    "primaryCarePhysicianId" TEXT,
    "supervisingPhysicianId" TEXT,
    "referralDate" DATETIME,
    "externalProviders" TEXT,
    "pharmacyName" TEXT,
    "pharmacyPhone" TEXT,
    "pharmacyFax" TEXT,
    "pharmacyAddress" TEXT,
    "emergencyContactEmail" TEXT,
    "emergencyContactAddress" TEXT,
    "emergencyContactGuardian" BOOLEAN NOT NULL DEFAULT false,
    "emergencyContactGuardianAdLitem" BOOLEAN NOT NULL DEFAULT false,
    "motherFirstName" TEXT,
    "motherMaidenName" TEXT,
    "homeHealthNurse" TEXT,
    "homeHealthCompany" TEXT,
    "portalRepresentatives" TEXT,
    "registrationNotes" TEXT,
    "photoPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "restrictedReason" TEXT,
    "textConsent" TEXT,
    "voiceConsent" TEXT,
    "consentRecordedAt" DATETIME,
    "consentMethod" TEXT,
    "consentRecordedById" TEXT,
    "customFields" TEXT,
    CONSTRAINT "Patient_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Patient_referringPhysicianId_fkey" FOREIGN KEY ("referringPhysicianId") REFERENCES "RenderingProvider" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Patient_guarantorPatientId_fkey" FOREIGN KEY ("guarantorPatientId") REFERENCES "Patient" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Patient" ("addressLine1", "addressLine2", "admissionDate", "autoAccident", "autoAccidentDate", "autoAccidentState", "careCenterId", "city", "consult", "county", "createdAt", "currentAddress", "dob", "email", "emergencyContactAddress", "emergencyContactEmail", "emergencyContactGuardian", "emergencyContactGuardianAdLitem", "emergencyContactName", "emergencyContactPhone", "emergencyContactRelationship", "employmentStatus", "ethnicity", "externalProviders", "firstName", "genderIdentity", "guarantorAddress", "guarantorName", "guarantorPatientId", "guarantorPhone", "guarantorRelationship", "homeHealthCompany", "homeHealthNurse", "howHeard", "id", "interpreterNeeded", "lastName", "maritalStatus", "medicareAdmission", "middleName", "motherFirstName", "motherMaidenName", "mrn", "nameChangedAt", "noEmail", "nonWoundDiagnosis", "occupation", "occupationIndustry", "onsetDate", "palliativeCare", "pharmacyAddress", "pharmacyFax", "pharmacyName", "pharmacyPhone", "phone", "phone2", "phone2Type", "phoneType", "photoPath", "portalRepresentatives", "practiceId", "preferredCommunication", "preferredLanguage", "preferredName", "previousAddress", "previousFirstName", "previousLastName", "previousMiddleName", "primaryCarePhysicianId", "pronoun", "race", "races", "referralDate", "referringPhysicianId", "registrationNotes", "religion", "secondaryAddress", "sex", "sexualOrientation", "siteOfServiceId", "smokingStatus", "ssnLast4", "state", "status", "suffix", "supervisingPhysicianId", "tribalAffiliation", "updatedAt", "woundCarePhysicianId", "zip") SELECT "addressLine1", "addressLine2", "admissionDate", "autoAccident", "autoAccidentDate", "autoAccidentState", "careCenterId", "city", "consult", "county", "createdAt", "currentAddress", "dob", "email", "emergencyContactAddress", "emergencyContactEmail", "emergencyContactGuardian", "emergencyContactGuardianAdLitem", "emergencyContactName", "emergencyContactPhone", "emergencyContactRelationship", "employmentStatus", "ethnicity", "externalProviders", "firstName", "genderIdentity", "guarantorAddress", "guarantorName", "guarantorPatientId", "guarantorPhone", "guarantorRelationship", "homeHealthCompany", "homeHealthNurse", "howHeard", "id", "interpreterNeeded", "lastName", "maritalStatus", "medicareAdmission", "middleName", "motherFirstName", "motherMaidenName", "mrn", "nameChangedAt", "noEmail", "nonWoundDiagnosis", "occupation", "occupationIndustry", "onsetDate", "palliativeCare", "pharmacyAddress", "pharmacyFax", "pharmacyName", "pharmacyPhone", "phone", "phone2", "phone2Type", "phoneType", "photoPath", "portalRepresentatives", "practiceId", "preferredCommunication", "preferredLanguage", "preferredName", "previousAddress", "previousFirstName", "previousLastName", "previousMiddleName", "primaryCarePhysicianId", "pronoun", "race", "races", "referralDate", "referringPhysicianId", "registrationNotes", "religion", "secondaryAddress", "sex", "sexualOrientation", "siteOfServiceId", "smokingStatus", "ssnLast4", "state", "status", "suffix", "supervisingPhysicianId", "tribalAffiliation", "updatedAt", "woundCarePhysicianId", "zip" FROM "Patient";
DROP TABLE "Patient";
ALTER TABLE "new_Patient" RENAME TO "Patient";
CREATE UNIQUE INDEX "Patient_practiceId_mrn_key" ON "Patient"("practiceId", "mrn");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Disclosure_practiceId_disclosedAt_idx" ON "Disclosure"("practiceId", "disclosedAt");

-- CreateIndex
CREATE INDEX "Disclosure_patientId_idx" ON "Disclosure"("patientId");

-- CreateIndex
CREATE INDEX "AmendmentRequest_practiceId_status_idx" ON "AmendmentRequest"("practiceId", "status");

-- CreateIndex
CREATE INDEX "AmendmentRequest_patientId_idx" ON "AmendmentRequest"("patientId");

-- CreateIndex
CREATE INDEX "EmergencyAccess_practiceId_grantedAt_idx" ON "EmergencyAccess"("practiceId", "grantedAt");

-- CreateIndex
CREATE INDEX "EmergencyAccess_patientId_userId_idx" ON "EmergencyAccess"("patientId", "userId");

-- CreateIndex
CREATE INDEX "CareTeamMember_patientId_idx" ON "CareTeamMember"("patientId");

-- CreateIndex
CREATE INDEX "HealthConcern_patientId_idx" ON "HealthConcern"("patientId");

-- CreateIndex
CREATE INDEX "PatientGoal_patientId_idx" ON "PatientGoal"("patientId");

-- CreateIndex
CREATE INDEX "ImplantableDevice_patientId_idx" ON "ImplantableDevice"("patientId");

-- CreateIndex
CREATE INDEX "SdohScreening_patientId_screenedAt_idx" ON "SdohScreening"("patientId", "screenedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomField_practiceId_key_key" ON "CustomField"("practiceId", "key");

-- CreateIndex
CREATE INDEX "VaccineLot_practiceId_active_idx" ON "VaccineLot"("practiceId", "active");

