-- CreateTable
CREATE TABLE "VisitType" (
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
    CONSTRAINT "VisitType_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SchedulerSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "colorMode" TEXT NOT NULL DEFAULT 'STATUS',
    "statusColors" TEXT NOT NULL DEFAULT '{}',
    "physicianColors" TEXT NOT NULL DEFAULT '{}',
    "previewFields" TEXT NOT NULL DEFAULT '["primaryInsurance","authCount","authRemaining","authStart","authEnd","copay"]',
    "defaultLocationId" TEXT,
    "showWeekends" BOOLEAN NOT NULL DEFAULT false,
    "showPosDropdown" BOOLEAN NOT NULL DEFAULT true,
    "autoCheckIn" BOOLEAN NOT NULL DEFAULT false,
    "autoCheckInMinutes" INTEGER NOT NULL DEFAULT 15,
    "showCapacityView" BOOLEAN NOT NULL DEFAULT true,
    "startTimeMode" TEXT NOT NULL DEFAULT 'FIXED',
    "startTimeFixed" TEXT NOT NULL DEFAULT '07:30',
    "showConflicts" BOOLEAN NOT NULL DEFAULT true,
    "allowCrossSiteConflicts" BOOLEAN NOT NULL DEFAULT false,
    "defaultAuthorizations" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SchedulerSettings_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CancellationReason" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CancellationReason_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CalendarFilterSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "locationId" TEXT,
    "providerIds" TEXT,
    "visitTypes" TEXT,
    "view" TEXT NOT NULL DEFAULT 'day',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CalendarFilterSet_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SchedulerResource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxUnits" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SchedulerResource_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SchedulerResource_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SystemMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "activeFrom" DATETIME,
    "activeTo" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SystemMessage_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Fax" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "faxNumber" TEXT NOT NULL,
    "recipientName" TEXT,
    "pages" INTEGER,
    "contentType" TEXT,
    "viewId" TEXT,
    "encounterId" TEXT,
    "appointmentId" TEXT,
    "patientId" TEXT,
    "documentId" TEXT,
    "notes" TEXT,
    "error" TEXT,
    "providerRef" TEXT,
    "userId" TEXT,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Fax_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Fax_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Appointment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "visitType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "placeOfService" TEXT,
    "room" TEXT,
    "clinicalStaffId" TEXT,
    "supervisingProviderId" TEXT,
    "intakeCaseId" TEXT,
    "seriesId" TEXT,
    "conflictNote" TEXT,
    "collaboratingProviderId" TEXT,
    "accountNumber" TEXT,
    "resourceId" TEXT,
    "cancelReason" TEXT,
    "cancelledAt" DATETIME,
    "createdById" TEXT,
    CONSTRAINT "Appointment_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Appointment_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_clinicalStaffId_fkey" FOREIGN KEY ("clinicalStaffId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Appointment_supervisingProviderId_fkey" FOREIGN KEY ("supervisingProviderId") REFERENCES "RenderingProvider" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Appointment_intakeCaseId_fkey" FOREIGN KEY ("intakeCaseId") REFERENCES "IntakeCase" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Appointment_collaboratingProviderId_fkey" FOREIGN KEY ("collaboratingProviderId") REFERENCES "RenderingProvider" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Appointment_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "SchedulerResource" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Appointment" ("clinicalStaffId", "conflictNote", "createdAt", "endsAt", "id", "intakeCaseId", "locationId", "patientId", "placeOfService", "practiceId", "providerId", "reason", "room", "seriesId", "startsAt", "status", "supervisingProviderId", "visitType") SELECT "clinicalStaffId", "conflictNote", "createdAt", "endsAt", "id", "intakeCaseId", "locationId", "patientId", "placeOfService", "practiceId", "providerId", "reason", "room", "seriesId", "startsAt", "status", "supervisingProviderId", "visitType" FROM "Appointment";
DROP TABLE "Appointment";
ALTER TABLE "new_Appointment" RENAME TO "Appointment";
CREATE TABLE "new_Location" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "phone" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "npi" TEXT,
    "officeHours" TEXT,
    "slotMinutes" INTEGER NOT NULL DEFAULT 15,
    "showNonOfficeHours" BOOLEAN NOT NULL DEFAULT false,
    "promptOutsideHours" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Location_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Location" ("addressLine1", "city", "createdAt", "id", "name", "npi", "phone", "practiceId", "state", "zip") SELECT "addressLine1", "city", "createdAt", "id", "name", "npi", "phone", "practiceId", "state", "zip" FROM "Location";
DROP TABLE "Location";
ALTER TABLE "new_Location" RENAME TO "Location";
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
    CONSTRAINT "PracticeSettings_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PracticeSettings" ("allowEdiVoid", "allowZeroChargeClaims", "billingPhone", "clearinghouse", "cutoffDay", "cutoffLastDay", "cutoffMonth", "documentAiEnabled", "enableClaimRules", "holdClaimsForCredentialing", "id", "includeEmergencyFlag", "payToAddress1", "payToAddress2", "payToCity", "payToName", "payToState", "payToZip", "payeeAddress1", "payeeAddress2", "payeeCity", "payeeName", "payeeState", "payeeZip", "physicalAddress1", "physicalAddress2", "physicalCity", "physicalName", "physicalState", "physicalZip", "practiceId", "practiceTaxId", "remitAddress1", "remitAddress2", "remitCity", "remitName", "remitState", "remitZip", "suppressSecondaryEraAdjustments", "taxIdSource", "updatedAt", "useVisitNumbers", "yearEndMonth") SELECT "allowEdiVoid", "allowZeroChargeClaims", "billingPhone", "clearinghouse", "cutoffDay", "cutoffLastDay", "cutoffMonth", "documentAiEnabled", "enableClaimRules", "holdClaimsForCredentialing", "id", "includeEmergencyFlag", "payToAddress1", "payToAddress2", "payToCity", "payToName", "payToState", "payToZip", "payeeAddress1", "payeeAddress2", "payeeCity", "payeeName", "payeeState", "payeeZip", "physicalAddress1", "physicalAddress2", "physicalCity", "physicalName", "physicalState", "physicalZip", "practiceId", "practiceTaxId", "remitAddress1", "remitAddress2", "remitCity", "remitName", "remitState", "remitZip", "suppressSecondaryEraAdjustments", "taxIdSource", "updatedAt", "useVisitNumbers", "yearEndMonth" FROM "PracticeSettings";
DROP TABLE "PracticeSettings";
ALTER TABLE "new_PracticeSettings" RENAME TO "PracticeSettings";
CREATE UNIQUE INDEX "PracticeSettings_practiceId_key" ON "PracticeSettings"("practiceId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "VisitType_practiceId_code_key" ON "VisitType"("practiceId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulerSettings_practiceId_key" ON "SchedulerSettings"("practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CancellationReason_practiceId_name_key" ON "CancellationReason"("practiceId", "name");

-- CreateIndex
CREATE INDEX "Fax_practiceId_direction_createdAt_idx" ON "Fax"("practiceId", "direction", "createdAt");

