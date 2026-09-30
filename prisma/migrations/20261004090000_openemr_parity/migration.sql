-- CreateTable
CREATE TABLE "EraFile" (
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
    CONSTRAINT "EraFile_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EraClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eraFileId" TEXT NOT NULL,
    "claimId" TEXT,
    "controlNumber" TEXT NOT NULL,
    "statusCode" TEXT NOT NULL,
    "billedCents" INTEGER NOT NULL,
    "paidCents" INTEGER NOT NULL,
    "patientRespCents" INTEGER NOT NULL DEFAULT 0,
    "payerClaimNumber" TEXT,
    "patientName" TEXT,
    "memberId" TEXT,
    "adjustments" TEXT NOT NULL DEFAULT '[]',
    "lines" TEXT NOT NULL DEFAULT '[]',
    "remarks" TEXT,
    "matchStatus" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "note" TEXT,
    "postedAt" DATETIME,
    CONSTRAINT "EraClaim_eraFileId_fkey" FOREIGN KEY ("eraFileId") REFERENCES "EraFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppointmentEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appointmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "room" TEXT,
    "userId" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppointmentEvent_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Recall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "providerId" TEXT,
    "locationId" TEXT,
    "visitType" TEXT,
    "dueDate" DATETIME NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "appointmentId" TEXT,
    "contactCount" INTEGER NOT NULL DEFAULT 0,
    "lastContactAt" DATETIME,
    "lastContactVia" TEXT,
    "notes" TEXT,
    "closedReason" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Recall_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Recall_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Recall_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CareRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "criteria" TEXT NOT NULL DEFAULT '{}',
    "satisfiedBy" TEXT NOT NULL,
    "intervalDays" INTEGER NOT NULL DEFAULT 365,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'ALERT',
    "source" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "standard" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CareRule_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CareRuleOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruleId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "until" DATETIME,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CareRuleOverride_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CareRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CareRuleOverride_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DuplicateDismissal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "pairKey" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DuplicateDismissal_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "prescriberId" TEXT NOT NULL,
    "drug" TEXT NOT NULL,
    "strength" TEXT,
    "form" TEXT,
    "route" TEXT,
    "sig" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "quantityUnit" TEXT,
    "refills" INTEGER NOT NULL DEFAULT 0,
    "daysSupply" INTEGER,
    "dispenseAsWritten" BOOLEAN NOT NULL DEFAULT false,
    "controlled" BOOLEAN NOT NULL DEFAULT false,
    "diagnosisCode" TEXT,
    "pharmacyName" TEXT,
    "pharmacyPhone" TEXT,
    "pharmacyFax" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sentVia" TEXT,
    "sentAt" DATETIME,
    "faxId" TEXT,
    "signedAt" DATETIME,
    "signedName" TEXT,
    "medicationId" TEXT,
    "allergyOverride" TEXT,
    "cancelledReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Prescription_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Prescription_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Immunization" (
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
    CONSTRAINT "Immunization_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Immunization_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LetterTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "standard" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LetterTemplate_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClinicClosure" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "locationId" TEXT,
    "date" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'HOLIDAY',
    "allowBooking" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClinicClosure_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApiClient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT 'patient/*.read',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiClient_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "EraFile_practiceId_createdAt_idx" ON "EraFile"("practiceId", "createdAt");

-- CreateIndex
CREATE INDEX "AppointmentEvent_appointmentId_at_idx" ON "AppointmentEvent"("appointmentId", "at");

-- CreateIndex
CREATE INDEX "Recall_practiceId_status_dueDate_idx" ON "Recall"("practiceId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "CareRule_practiceId_key_key" ON "CareRule"("practiceId", "key");

-- CreateIndex
CREATE INDEX "CareRuleOverride_patientId_ruleId_idx" ON "CareRuleOverride"("patientId", "ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "DuplicateDismissal_practiceId_pairKey_key" ON "DuplicateDismissal"("practiceId", "pairKey");

-- CreateIndex
CREATE INDEX "Prescription_practiceId_patientId_idx" ON "Prescription"("practiceId", "patientId");

-- CreateIndex
CREATE INDEX "Immunization_practiceId_administeredAt_idx" ON "Immunization"("practiceId", "administeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "LetterTemplate_practiceId_key_key" ON "LetterTemplate"("practiceId", "key");

-- CreateIndex
CREATE INDEX "ClinicClosure_practiceId_date_idx" ON "ClinicClosure"("practiceId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ApiClient_tokenHash_key" ON "ApiClient"("tokenHash");

