-- DropTable

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
CREATE TABLE "new_Payer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payerCode" TEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "portalName" TEXT,
    "parentPayerId" TEXT,
    "insuranceType" TEXT,
    "eraPayerId" TEXT,
    "eligibilityPayerId" TEXT,
    "alternatePayerId" TEXT,
    "addressLine2" TEXT,
    "fax" TEXT,
    "contactFirstName" TEXT,
    "contactLastName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "facilityBilling" BOOLEAN NOT NULL DEFAULT false,
    "useGroupNpi" BOOLEAN NOT NULL DEFAULT false,
    "requiresVisitReview" BOOLEAN NOT NULL DEFAULT false,
    "timelyFilingLimit" INTEGER,
    "timelyFilingUnit" TEXT NOT NULL DEFAULT 'DAYS',
    "timelyFilingAlertDays" INTEGER,
    "reimbursementRate" REAL,
    "notes" TEXT,
    CONSTRAINT "Payer_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payer_parentPayerId_fkey" FOREIGN KEY ("parentPayerId") REFERENCES "Payer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Payer_alternatePayerId_fkey" FOREIGN KEY ("alternatePayerId") REFERENCES "Payer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Payer" ("active", "addressLine1", "city", "createdAt", "id", "name", "parentPayerId", "payerCode", "phone", "portalName", "practiceId", "state", "zip") SELECT "active", "addressLine1", "city", "createdAt", "id", "name", "parentPayerId", "payerCode", "phone", "portalName", "practiceId", "state", "zip" FROM "Payer";
DROP TABLE "Payer";
ALTER TABLE "new_Payer" RENAME TO "Payer";
CREATE TABLE "new_RenderingProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "firstName" TEXT,
    "middleName" TEXT,
    "lastName" TEXT,
    "suffix" TEXT,
    "isReferring" BOOLEAN NOT NULL DEFAULT false,
    "isClinician" BOOLEAN NOT NULL DEFAULT false,
    "isRendering" BOOLEAN NOT NULL DEFAULT false,
    "isSupervising" BOOLEAN NOT NULL DEFAULT false,
    "tin" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "phone" TEXT,
    "fax" TEXT,
    "pager" TEXT,
    "email" TEXT,
    "signatureOnFile" BOOLEAN NOT NULL DEFAULT false,
    "primarySupervising" BOOLEAN NOT NULL DEFAULT false,
    "groupName" TEXT,
    "acceptsAssignment" BOOLEAN NOT NULL DEFAULT false,
    "requiresSupervision" BOOLEAN NOT NULL DEFAULT false,
    "deaNumber" TEXT,
    "ePrescribe" BOOLEAN NOT NULL DEFAULT false,
    "interfaceId" TEXT,
    "credential" TEXT,
    "npi" TEXT,
    "taxonomy" TEXT,
    "specialty" TEXT,
    "licenseNumber" TEXT,
    "licenseState" TEXT,
    "caqhId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "termDate" DATETIME,
    "supervisingProviderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RenderingProvider_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RenderingProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RenderingProvider_supervisingProviderId_fkey" FOREIGN KEY ("supervisingProviderId") REFERENCES "RenderingProvider" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RenderingProvider" ("caqhId", "createdAt", "credential", "id", "licenseNumber", "licenseState", "name", "npi", "practiceId", "specialty", "status", "supervisingProviderId", "taxonomy", "termDate", "userId") SELECT "caqhId", "createdAt", "credential", "id", "licenseNumber", "licenseState", "name", "npi", "practiceId", "specialty", "status", "supervisingProviderId", "taxonomy", "termDate", "userId" FROM "RenderingProvider";
DROP TABLE "RenderingProvider";
ALTER TABLE "new_RenderingProvider" RENAME TO "RenderingProvider";

-- Existing providers were all credentialing (rendering) records; those with a login are clinicians.
UPDATE "RenderingProvider" SET "isRendering" = true, "isClinician" = ("userId" IS NOT NULL);

-- Fold referring physicians into the unified provider table, keeping their ids so
-- Patient.referringPhysicianId stays valid.
INSERT INTO "RenderingProvider" ("id", "practiceId", "name", "npi", "specialty", "phone", "fax", "addressLine1", "city", "state", "zip", "isReferring", "status", "createdAt")
SELECT "id", "practiceId", "name", "npi", "specialty", "phone", "fax", "addressLine1", "city", "state", "zip", true,
       CASE WHEN "active" THEN 'ACTIVE' ELSE 'TERMED' END, "createdAt"
FROM "ReferringPhysician";

DROP TABLE "ReferringPhysician";
CREATE UNIQUE INDEX "RenderingProvider_userId_key" ON "RenderingProvider"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

