-- AlterTable
ALTER TABLE "EligibilityCheck" ADD COLUMN "checkedById" TEXT;
ALTER TABLE "EligibilityCheck" ADD COLUMN "insuranceId" TEXT;

-- AlterTable
ALTER TABLE "Insurance" ADD COLUMN "notes" TEXT;

-- AlterTable
ALTER TABLE "PatientDocument" ADD COLUMN "encounterId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "patientDashboard" TEXT;

-- CreateTable
CREATE TABLE "InsuranceAuthorization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "insuranceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ENCOUNTER',
    "reason" TEXT,
    "procedureCode" TEXT,
    "authNumber" TEXT,
    "authorizedCount" INTEGER,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "insuranceContact" TEXT,
    "verifiedAt" DATETIME,
    "verifiedBy" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InsuranceAuthorization_insuranceId_fkey" FOREIGN KEY ("insuranceId") REFERENCES "Insurance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "InsuranceAuthorization_patientId_idx" ON "InsuranceAuthorization"("patientId");

