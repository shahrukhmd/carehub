-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "copayDueCents" INTEGER;

-- AlterTable
ALTER TABLE "Deposit" ADD COLUMN "patientId" TEXT;

-- AlterTable
ALTER TABLE "Insurance" ADD COLUMN "copayCents" INTEGER;

-- CreateTable
CREATE TABLE "OrderProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "fax" TEXT,
    "accountNumber" TEXT,
    "sendMethod" TEXT NOT NULL DEFAULT 'FAX',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderProvider_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderCatalogItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "providerId" TEXT,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "specimen" TEXT,
    "fasting" BOOLEAN NOT NULL DEFAULT false,
    "favorite" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "OrderCatalogItem_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderCatalogItem_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "OrderProvider" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClinicalOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "kind" TEXT NOT NULL,
    "providerId" TEXT,
    "orderedById" TEXT NOT NULL,
    "requisition" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "priority" TEXT NOT NULL DEFAULT 'ROUTINE',
    "diagnosisCodes" TEXT,
    "clinicalNotes" TEXT,
    "fasting" BOOLEAN NOT NULL DEFAULT false,
    "collectedAt" DATETIME,
    "collectedBy" TEXT,
    "scheduledFor" DATETIME,
    "sentVia" TEXT,
    "sentAt" DATETIME,
    "faxId" TEXT,
    "signedAt" DATETIME,
    "cancelledReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClinicalOrder_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClinicalOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClinicalOrder_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "OrderProvider" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClinicalOrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specimen" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ORDERED',
    CONSTRAINT "ClinicalOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ClinicalOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClinicalResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "value" TEXT,
    "unit" TEXT,
    "referenceRange" TEXT,
    "flag" TEXT NOT NULL DEFAULT 'NORMAL',
    "reportText" TEXT,
    "documentId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "resultedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "reviewNote" TEXT,
    CONSTRAINT "ClinicalResult_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ClinicalOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "encounterId" TEXT,
    "depositId" TEXT,
    "number" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "collectedById" TEXT,
    "voidedAt" DATETIME,
    "voidReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Receipt_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Receipt_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'GENERAL',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "patientId" TEXT,
    "assignedToId" TEXT,
    "assignedRole" TEXT,
    "createdById" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "dueAt" DATETIME,
    "link" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "completedAt" DATETIME,
    "completedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "userId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OutgoingReferral" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "toProviderId" TEXT,
    "toName" TEXT NOT NULL,
    "toSpecialty" TEXT,
    "toFax" TEXT,
    "toPhone" TEXT,
    "reason" TEXT NOT NULL,
    "diagnosisCodes" TEXT,
    "notes" TEXT,
    "urgency" TEXT NOT NULL DEFAULT 'ROUTINE',
    "authNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sentVia" TEXT,
    "sentAt" DATETIME,
    "faxId" TEXT,
    "letterDocumentId" TEXT,
    "appointmentAt" DATETIME,
    "consultDocumentId" TEXT,
    "consultReceivedAt" DATETIME,
    "followUpDays" INTEGER NOT NULL DEFAULT 30,
    "closedReason" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OutgoingReferral_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OutgoingReferral_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "mapping" TEXT NOT NULL DEFAULT '{}',
    "rows" TEXT NOT NULL DEFAULT '[]',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "createdIds" TEXT NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedAt" DATETIME,
    CONSTRAINT "ImportBatch_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PracticeSettings" (
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
    "clearinghouse" TEXT NOT NULL DEFAULT 'MOCK',
    "documentAiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "faxNumber" TEXT,
    "faxProvider" TEXT NOT NULL DEFAULT 'MOCK',
    "updatedAt" DATETIME NOT NULL,
    "eligibilityAuto" BOOLEAN NOT NULL DEFAULT false,
    "referralFollowUpDays" INTEGER NOT NULL DEFAULT 30,
    CONSTRAINT "PracticeSettings_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PracticeSettings" ("allowEdiVoid", "allowZeroChargeClaims", "billingPhone", "clearinghouse", "cutoffDay", "cutoffLastDay", "cutoffMonth", "documentAiEnabled", "enableClaimRules", "faxNumber", "faxProvider", "holdClaimsForCredentialing", "id", "includeEmergencyFlag", "payToAddress1", "payToAddress2", "payToCity", "payToName", "payToState", "payToZip", "payeeAddress1", "payeeAddress2", "payeeCity", "payeeName", "payeeState", "payeeZip", "physicalAddress1", "physicalAddress2", "physicalCity", "physicalName", "physicalState", "physicalZip", "practiceId", "practiceTaxId", "remitAddress1", "remitAddress2", "remitCity", "remitName", "remitState", "remitZip", "suppressSecondaryEraAdjustments", "taxIdSource", "updatedAt", "useVisitNumbers", "yearEndMonth") SELECT "allowEdiVoid", "allowZeroChargeClaims", "billingPhone", "clearinghouse", "cutoffDay", "cutoffLastDay", "cutoffMonth", "documentAiEnabled", "enableClaimRules", "faxNumber", "faxProvider", "holdClaimsForCredentialing", "id", "includeEmergencyFlag", "payToAddress1", "payToAddress2", "payToCity", "payToName", "payToState", "payToZip", "payeeAddress1", "payeeAddress2", "payeeCity", "payeeName", "payeeState", "payeeZip", "physicalAddress1", "physicalAddress2", "physicalCity", "physicalName", "physicalState", "physicalZip", "practiceId", "practiceTaxId", "remitAddress1", "remitAddress2", "remitCity", "remitName", "remitState", "remitZip", "suppressSecondaryEraAdjustments", "taxIdSource", "updatedAt", "useVisitNumbers", "yearEndMonth" FROM "PracticeSettings";
DROP TABLE "PracticeSettings";
ALTER TABLE "new_PracticeSettings" RENAME TO "PracticeSettings";
CREATE UNIQUE INDEX "PracticeSettings_practiceId_key" ON "PracticeSettings"("practiceId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalOrder_requisition_key" ON "ClinicalOrder"("requisition");

-- CreateIndex
CREATE INDEX "ClinicalOrder_practiceId_status_idx" ON "ClinicalOrder"("practiceId", "status");

-- CreateIndex
CREATE INDEX "Receipt_practiceId_createdAt_idx" ON "Receipt"("practiceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_practiceId_number_key" ON "Receipt"("practiceId", "number");

-- CreateIndex
CREATE INDEX "Task_practiceId_status_assignedToId_idx" ON "Task"("practiceId", "status", "assignedToId");

-- CreateIndex
CREATE INDEX "OutgoingReferral_practiceId_status_idx" ON "OutgoingReferral"("practiceId", "status");

