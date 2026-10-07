-- CreateTable
CREATE TABLE "PatientAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'WARNING',
    "message" TEXT NOT NULL,
    "showOn" TEXT NOT NULL,
    "activeFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeTo" DATETIME,
    "assignedToId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedById" TEXT,
    "resolvedAt" DATETIME,
    "resolveComment" TEXT,
    CONSTRAINT "PatientAlert_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PatientAlert_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PatientAlert_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PatientAlert_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PatientAlert_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AlertAcknowledgement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "alertId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "placement" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AlertAcknowledgement_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "PatientAlert" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AlertAcknowledgement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PracticeSettings" (
    "specialties" TEXT NOT NULL DEFAULT 'WOUND_CARE',
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "payToName" TEXT,
    "payToAddress1" TEXT,
    "payToAddress2" TEXT,
    "payToCity" TEXT,
    "payToState" TEXT,
    "payToZip" TEXT,
    "payeeName" TEXT,
    "payeeAddress1" TEXT,
    "payeeAddress2" TEXT,
    "payeeCity" TEXT,
    "payeeState" TEXT,
    "payeeZip" TEXT,
    "remitName" TEXT,
    "remitAddress1" TEXT,
    "remitAddress2" TEXT,
    "remitCity" TEXT,
    "remitState" TEXT,
    "remitZip" TEXT,
    "physicalName" TEXT,
    "physicalAddress1" TEXT,
    "physicalAddress2" TEXT,
    "physicalCity" TEXT,
    "physicalState" TEXT,
    "physicalZip" TEXT,
    "yearEndMonth" INTEGER NOT NULL DEFAULT 12,
    "taxIdSource" TEXT NOT NULL DEFAULT 'ACCOUNT',
    "practiceTaxId" TEXT,
    "useVisitNumbers" BOOLEAN NOT NULL DEFAULT false,
    "cutoffDay" INTEGER,
    "cutoffLastDay" BOOLEAN NOT NULL DEFAULT false,
    "cutoffMonth" TEXT NOT NULL DEFAULT 'FOLLOWING',
    "billingPhone" TEXT,
    "allowZeroChargeClaims" BOOLEAN NOT NULL DEFAULT false,
    "includeEmergencyFlag" BOOLEAN NOT NULL DEFAULT false,
    "allowEdiVoid" BOOLEAN NOT NULL DEFAULT true,
    "enableClaimRules" BOOLEAN NOT NULL DEFAULT true,
    "suppressSecondaryEraAdjustments" BOOLEAN NOT NULL DEFAULT false,
    "holdClaimsForCredentialing" BOOLEAN NOT NULL DEFAULT false,
    "bookingRequiresGateway" BOOLEAN NOT NULL DEFAULT false,
    "bookingChecksCredentialing" BOOLEAN NOT NULL DEFAULT false,
    "chartRequiresCheckIn" BOOLEAN NOT NULL DEFAULT false,
    "enforceVobScope" BOOLEAN NOT NULL DEFAULT false,
    "separateDuties" BOOLEAN NOT NULL DEFAULT true,
    "clearinghouse" TEXT NOT NULL DEFAULT 'MOCK',
    "closedThrough" DATETIME,
    "documentAiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "faxNumber" TEXT,
    "faxProvider" TEXT NOT NULL DEFAULT 'MOCK',
    "updatedAt" DATETIME NOT NULL,
    "eligibilityAuto" BOOLEAN NOT NULL DEFAULT false,
    "referralFollowUpDays" INTEGER NOT NULL DEFAULT 30,
    "smallBalanceCents" INTEGER NOT NULL DEFAULT 500,
    "alertBalanceCents" INTEGER NOT NULL DEFAULT 10000,
    "appealAlertDays" INTEGER NOT NULL DEFAULT 14,
    CONSTRAINT "PracticeSettings_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PracticeSettings" ("allowEdiVoid", "allowZeroChargeClaims", "appealAlertDays", "billingPhone", "bookingChecksCredentialing", "bookingRequiresGateway", "chartRequiresCheckIn", "clearinghouse", "closedThrough", "cutoffDay", "cutoffLastDay", "cutoffMonth", "documentAiEnabled", "eligibilityAuto", "enableClaimRules", "enforceVobScope", "faxNumber", "faxProvider", "holdClaimsForCredentialing", "id", "includeEmergencyFlag", "payToAddress1", "payToAddress2", "payToCity", "payToName", "payToState", "payToZip", "payeeAddress1", "payeeAddress2", "payeeCity", "payeeName", "payeeState", "payeeZip", "physicalAddress1", "physicalAddress2", "physicalCity", "physicalName", "physicalState", "physicalZip", "practiceId", "practiceTaxId", "referralFollowUpDays", "remitAddress1", "remitAddress2", "remitCity", "remitName", "remitState", "remitZip", "separateDuties", "smallBalanceCents", "specialties", "suppressSecondaryEraAdjustments", "taxIdSource", "updatedAt", "useVisitNumbers", "yearEndMonth") SELECT "allowEdiVoid", "allowZeroChargeClaims", "appealAlertDays", "billingPhone", "bookingChecksCredentialing", "bookingRequiresGateway", "chartRequiresCheckIn", "clearinghouse", "closedThrough", "cutoffDay", "cutoffLastDay", "cutoffMonth", "documentAiEnabled", "eligibilityAuto", "enableClaimRules", "enforceVobScope", "faxNumber", "faxProvider", "holdClaimsForCredentialing", "id", "includeEmergencyFlag", "payToAddress1", "payToAddress2", "payToCity", "payToName", "payToState", "payToZip", "payeeAddress1", "payeeAddress2", "payeeCity", "payeeName", "payeeState", "payeeZip", "physicalAddress1", "physicalAddress2", "physicalCity", "physicalName", "physicalState", "physicalZip", "practiceId", "practiceTaxId", "referralFollowUpDays", "remitAddress1", "remitAddress2", "remitCity", "remitName", "remitState", "remitZip", "separateDuties", "smallBalanceCents", "specialties", "suppressSecondaryEraAdjustments", "taxIdSource", "updatedAt", "useVisitNumbers", "yearEndMonth" FROM "PracticeSettings";
DROP TABLE "PracticeSettings";
ALTER TABLE "new_PracticeSettings" RENAME TO "PracticeSettings";
CREATE UNIQUE INDEX "PracticeSettings_practiceId_key" ON "PracticeSettings"("practiceId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PatientAlert_practiceId_patientId_status_idx" ON "PatientAlert"("practiceId", "patientId", "status");

-- CreateIndex
CREATE INDEX "AlertAcknowledgement_alertId_userId_createdAt_idx" ON "AlertAcknowledgement"("alertId", "userId", "createdAt");

