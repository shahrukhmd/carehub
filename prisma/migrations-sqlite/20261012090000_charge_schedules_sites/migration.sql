-- CreateTable
CREATE TABLE "ServiceType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceType_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChargeSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "locationIds" TEXT NOT NULL DEFAULT '[]',
    "providerIds" TEXT NOT NULL DEFAULT '[]',
    "payerIds" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChargeSchedule_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChargeScheduleItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "revenueCode" TEXT,
    CONSTRAINT "ChargeScheduleItem_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ChargeSchedule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "serviceTypeId" TEXT,
    "addressLine2" TEXT,
    "fax" TEXT,
    "email" TEXT,
    "placeOfService" TEXT,
    "taxId" TEXT,
    "groupNpi" TEXT,
    "ptan" TEXT,
    "facilityBilling" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Location_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Location_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Location" ("addressLine1", "city", "createdAt", "id", "name", "npi", "officeHours", "phone", "practiceId", "promptOutsideHours", "showNonOfficeHours", "slotMinutes", "state", "zip") SELECT "addressLine1", "city", "createdAt", "id", "name", "npi", "officeHours", "phone", "practiceId", "promptOutsideHours", "showNonOfficeHours", "slotMinutes", "state", "zip" FROM "Location";
DROP TABLE "Location";
ALTER TABLE "new_Location" RENAME TO "Location";
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
    "woundAnalytics" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "VisitType_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VisitType" ("active", "bgColor", "billable", "code", "createdAt", "durationMin", "id", "name", "onlineBooking", "practiceId", "sortOrder", "textColor") SELECT "active", "bgColor", "billable", "code", "createdAt", "durationMin", "id", "name", "onlineBooking", "practiceId", "sortOrder", "textColor" FROM "VisitType";
DROP TABLE "VisitType";
ALTER TABLE "new_VisitType" RENAME TO "VisitType";
CREATE UNIQUE INDEX "VisitType_practiceId_code_key" ON "VisitType"("practiceId", "code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ServiceType_practiceId_name_key" ON "ServiceType"("practiceId", "name");

-- CreateIndex
CREATE INDEX "ChargeSchedule_practiceId_active_idx" ON "ChargeSchedule"("practiceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeScheduleItem_scheduleId_code_key" ON "ChargeScheduleItem"("scheduleId", "code");

