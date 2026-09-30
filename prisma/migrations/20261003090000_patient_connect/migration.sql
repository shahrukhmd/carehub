-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "confirmToken" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "confirmedAt" DATETIME;
ALTER TABLE "Appointment" ADD COLUMN "confirmedVia" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "reminderSentAt" DATETIME;

-- CreateTable
CREATE TABLE "IntakePacket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "templateKeys" TEXT NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IntakePacket_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IntakeRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT,
    "appointmentId" TEXT,
    "packetId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "channel" TEXT NOT NULL DEFAULT 'LINK',
    "sentTo" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "openedAt" DATETIME,
    "completedAt" DATETIME,
    "verifyAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "sessionHash" TEXT,
    "answers" TEXT NOT NULL DEFAULT '{}',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "documentId" TEXT,
    "kioskLinkId" TEXT,
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" DATETIME,
    "ruleId" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IntakeRequest_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IntakeRequest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IntakeRequest_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "IntakeRequest_packetId_fkey" FOREIGN KEY ("packetId") REFERENCES "IntakePacket" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT,
    "appointmentId" TEXT,
    "requestId" TEXT,
    "channel" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MOCK',
    "error" TEXT,
    "ruleId" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageLog_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "offsetHours" INTEGER NOT NULL DEFAULT 48,
    "channel" TEXT NOT NULL DEFAULT 'BOTH',
    "packetId" TEXT,
    "onlyNewPatients" BOOLEAN NOT NULL DEFAULT false,
    "visitTypes" TEXT,
    "messageTemplate" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AutomationRule_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AutomationRule_packetId_fkey" FOREIGN KEY ("packetId") REFERENCES "IntakePacket" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SurveyResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "token" TEXT NOT NULL,
    "score" INTEGER,
    "comment" TEXT,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" DATETIME,
    CONSTRAINT "SurveyResponse_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SurveyResponse_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SurveyResponse_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KioskLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "packetId" TEXT NOT NULL,
    "locationId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KioskLink_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KioskLink_packetId_fkey" FOREIGN KEY ("packetId") REFERENCES "IntakePacket" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConnectSettings" (
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
    CONSTRAINT "ConnectSettings_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DocumentTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "section" TEXT NOT NULL DEFAULT 'ADDITIONAL',
    "kind" TEXT NOT NULL DEFAULT 'FORM',
    "builtin" TEXT,
    "perWound" BOOLEAN NOT NULL DEFAULT false,
    "audience" TEXT NOT NULL DEFAULT 'STAFF',
    "fields" TEXT NOT NULL DEFAULT '[]',
    "standard" BOOLEAN NOT NULL DEFAULT false,
    "signatureRequired" BOOLEAN NOT NULL DEFAULT false,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "inProgressNote" BOOLEAN NOT NULL DEFAULT true,
    "noteOrder" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DocumentTemplate_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DocumentTemplate" ("active", "builtin", "createdAt", "critical", "description", "fields", "id", "inProgressNote", "key", "kind", "name", "noteOrder", "perWound", "practiceId", "section", "signatureRequired", "sortOrder", "standard", "updatedAt", "version") SELECT "active", "builtin", "createdAt", "critical", "description", "fields", "id", "inProgressNote", "key", "kind", "name", "noteOrder", "perWound", "practiceId", "section", "signatureRequired", "sortOrder", "standard", "updatedAt", "version" FROM "DocumentTemplate";
DROP TABLE "DocumentTemplate";
ALTER TABLE "new_DocumentTemplate" RENAME TO "DocumentTemplate";
CREATE UNIQUE INDEX "DocumentTemplate_practiceId_key_key" ON "DocumentTemplate"("practiceId", "key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "IntakeRequest_token_key" ON "IntakeRequest"("token");

-- CreateIndex
CREATE INDEX "IntakeRequest_practiceId_status_idx" ON "IntakeRequest"("practiceId", "status");

-- CreateIndex
CREATE INDEX "MessageLog_practiceId_createdAt_idx" ON "MessageLog"("practiceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyResponse_token_key" ON "SurveyResponse"("token");

-- CreateIndex
CREATE UNIQUE INDEX "KioskLink_token_key" ON "KioskLink"("token");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectSettings_practiceId_key" ON "ConnectSettings"("practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_confirmToken_key" ON "Appointment"("confirmToken");

