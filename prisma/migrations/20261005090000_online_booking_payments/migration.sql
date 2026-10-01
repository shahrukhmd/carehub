-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "bookingNote" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "bookingSource" TEXT;

-- CreateTable
CREATE TABLE "PatientPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "balanceCents" INTEGER NOT NULL,
    "amountCents" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "provider" TEXT NOT NULL DEFAULT 'TEST',
    "providerRef" TEXT,
    "depositId" TEXT,
    "sentVia" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "paidAt" DATETIME,
    "receiptEmail" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PatientPayment_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PatientPayment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    CONSTRAINT "ConnectSettings_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ConnectSettings" ("accentColor", "brandColor", "displayName", "emailProvider", "id", "languages", "linkDays", "logo", "practiceId", "smsProvider", "supportPhone", "updatedAt", "welcomeText") SELECT "accentColor", "brandColor", "displayName", "emailProvider", "id", "languages", "linkDays", "logo", "practiceId", "smsProvider", "supportPhone", "updatedAt", "welcomeText" FROM "ConnectSettings";
DROP TABLE "ConnectSettings";
ALTER TABLE "new_ConnectSettings" RENAME TO "ConnectSettings";
CREATE UNIQUE INDEX "ConnectSettings_practiceId_key" ON "ConnectSettings"("practiceId");
CREATE UNIQUE INDEX "ConnectSettings_bookingToken_key" ON "ConnectSettings"("bookingToken");
CREATE TABLE "new_EraFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "payerName" TEXT NOT NULL,
    "payerId" TEXT,
    "payeeName" TEXT,
    "payeeNpi" TEXT,
    "paymentMethod" TEXT NOT NULL,
    "traceNumber" TEXT,
    "paymentDate" DATETIME,
    "totalCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IMPORTED',
    "depositId" TEXT,
    "raw" TEXT NOT NULL,
    "importedById" TEXT,
    "postedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "plbCents" INTEGER NOT NULL DEFAULT 0,
    "plbDetail" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "EraFile_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EraFile" ("createdAt", "depositId", "fileName", "id", "importedById", "payeeName", "payeeNpi", "payerId", "payerName", "paymentDate", "paymentMethod", "postedAt", "practiceId", "raw", "status", "totalCents", "traceNumber") SELECT "createdAt", "depositId", "fileName", "id", "importedById", "payeeName", "payeeNpi", "payerId", "payerName", "paymentDate", "paymentMethod", "postedAt", "practiceId", "raw", "status", "totalCents", "traceNumber" FROM "EraFile";
DROP TABLE "EraFile";
ALTER TABLE "new_EraFile" RENAME TO "EraFile";
CREATE INDEX "EraFile_practiceId_createdAt_idx" ON "EraFile"("practiceId", "createdAt");
CREATE TABLE "new_VisitType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationMin" INTEGER,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "textColor" TEXT NOT NULL DEFAULT '#ffffff',
    "bgColor" TEXT NOT NULL DEFAULT '#2f5fa8',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "onlineBooking" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "VisitType_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VisitType" ("active", "bgColor", "billable", "code", "createdAt", "durationMin", "id", "name", "practiceId", "sortOrder", "textColor") SELECT "active", "bgColor", "billable", "code", "createdAt", "durationMin", "id", "name", "practiceId", "sortOrder", "textColor" FROM "VisitType";
DROP TABLE "VisitType";
ALTER TABLE "new_VisitType" RENAME TO "VisitType";
CREATE UNIQUE INDEX "VisitType_practiceId_code_key" ON "VisitType"("practiceId", "code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PatientPayment_token_key" ON "PatientPayment"("token");

-- CreateIndex
CREATE INDEX "PatientPayment_practiceId_status_idx" ON "PatientPayment"("practiceId", "status");

