-- AlterTable
ALTER TABLE "Insurance" ADD COLUMN "authRequired" TEXT;
ALTER TABLE "Insurance" ADD COLUMN "coveragePercent" INTEGER;
ALTER TABLE "Insurance" ADD COLUMN "deductibleCents" INTEGER;
ALTER TABLE "Insurance" ADD COLUMN "deductibleMetCents" INTEGER;
ALTER TABLE "Insurance" ADD COLUMN "groupName" TEXT;
ALTER TABLE "Insurance" ADD COLUMN "insuredMiddleName" TEXT;
ALTER TABLE "Insurance" ADD COLUMN "insuredPhone" TEXT;
ALTER TABLE "Insurance" ADD COLUMN "priorAuthRequired" TEXT;
ALTER TABLE "Insurance" ADD COLUMN "verifiedAt" DATETIME;
ALTER TABLE "Insurance" ADD COLUMN "verifiedWith" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    CONSTRAINT "Patient_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Patient_referringPhysicianId_fkey" FOREIGN KEY ("referringPhysicianId") REFERENCES "RenderingProvider" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Patient_guarantorPatientId_fkey" FOREIGN KEY ("guarantorPatientId") REFERENCES "Patient" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Patient" ("addressLine1", "city", "createdAt", "dob", "email", "emergencyContactName", "emergencyContactPhone", "emergencyContactRelationship", "employmentStatus", "ethnicity", "firstName", "guarantorName", "guarantorPatientId", "guarantorPhone", "guarantorRelationship", "id", "lastName", "maritalStatus", "mrn", "phone", "practiceId", "preferredLanguage", "race", "referringPhysicianId", "sex", "smokingStatus", "state", "status", "updatedAt", "zip") SELECT "addressLine1", "city", "createdAt", "dob", "email", "emergencyContactName", "emergencyContactPhone", "emergencyContactRelationship", "employmentStatus", "ethnicity", "firstName", "guarantorName", "guarantorPatientId", "guarantorPhone", "guarantorRelationship", "id", "lastName", "maritalStatus", "mrn", "phone", "practiceId", "preferredLanguage", "race", "referringPhysicianId", "sex", "smokingStatus", "state", "status", "updatedAt", "zip" FROM "Patient";
DROP TABLE "Patient";
ALTER TABLE "new_Patient" RENAME TO "Patient";
CREATE UNIQUE INDEX "Patient_practiceId_mrn_key" ON "Patient"("practiceId", "mrn");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

