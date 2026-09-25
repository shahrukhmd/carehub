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
    CONSTRAINT "Patient_referringPhysicianId_fkey" FOREIGN KEY ("referringPhysicianId") REFERENCES "ReferringPhysician" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Patient_guarantorPatientId_fkey" FOREIGN KEY ("guarantorPatientId") REFERENCES "Patient" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Patient" ("addressLine1", "city", "createdAt", "dob", "email", "emergencyContactName", "emergencyContactPhone", "emergencyContactRelationship", "employmentStatus", "ethnicity", "firstName", "guarantorName", "guarantorPhone", "guarantorRelationship", "id", "lastName", "maritalStatus", "mrn", "phone", "practiceId", "preferredLanguage", "race", "referringPhysicianId", "sex", "smokingStatus", "state", "status", "updatedAt", "zip") SELECT "addressLine1", "city", "createdAt", "dob", "email", "emergencyContactName", "emergencyContactPhone", "emergencyContactRelationship", "employmentStatus", "ethnicity", "firstName", "guarantorName", "guarantorPhone", "guarantorRelationship", "id", "lastName", "maritalStatus", "mrn", "phone", "practiceId", "preferredLanguage", "race", "referringPhysicianId", "sex", "smokingStatus", "state", "status", "updatedAt", "zip" FROM "Patient";
DROP TABLE "Patient";
ALTER TABLE "new_Patient" RENAME TO "Patient";
CREATE UNIQUE INDEX "Patient_practiceId_mrn_key" ON "Patient"("practiceId", "mrn");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
