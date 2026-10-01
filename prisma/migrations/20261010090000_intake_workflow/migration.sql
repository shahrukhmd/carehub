-- AlterTable
ALTER TABLE "EligibilityCheck" ADD COLUMN "benefits" TEXT;
ALTER TABLE "EligibilityCheck" ADD COLUMN "intakeCaseId" TEXT;
ALTER TABLE "EligibilityCheck" ADD COLUMN "raw" TEXT;

-- AlterTable
ALTER TABLE "IntakeCase" ADD COLUMN "consentRequestId" TEXT;
ALTER TABLE "IntakeCase" ADD COLUMN "consentsSentAt" DATETIME;
ALTER TABLE "IntakeCase" ADD COLUMN "dataVerifiedAt" DATETIME;
ALTER TABLE "IntakeCase" ADD COLUMN "dataVerifiedById" TEXT;
ALTER TABLE "IntakeCase" ADD COLUMN "eligibilityCheckId" TEXT;
ALTER TABLE "IntakeCase" ADD COLUMN "eligibilityCheckedAt" DATETIME;
ALTER TABLE "IntakeCase" ADD COLUMN "infoRequestNote" TEXT;
ALTER TABLE "IntakeCase" ADD COLUMN "infoRequestedAt" DATETIME;
ALTER TABLE "IntakeCase" ADD COLUMN "infoRequestedFrom" TEXT;
ALTER TABLE "IntakeCase" ADD COLUMN "vobDecision" TEXT;
ALTER TABLE "IntakeCase" ADD COLUMN "vobDecisionAt" DATETIME;
ALTER TABLE "IntakeCase" ADD COLUMN "vobDecisionById" TEXT;
ALTER TABLE "IntakeCase" ADD COLUMN "vobDecisionNote" TEXT;
ALTER TABLE "IntakeCase" ADD COLUMN "vobDecisionSource" TEXT;
ALTER TABLE "IntakeCase" ADD COLUMN "vobDenyReason" TEXT;

-- CreateTable
CREATE TABLE "VobDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "payerId" TEXT,
    "planSegment" TEXT,
    "planName" TEXT,
    "providerId" TEXT,
    "network" TEXT,
    "decision" TEXT NOT NULL,
    "authRequired" BOOLEAN NOT NULL DEFAULT false,
    "referralRequired" BOOLEAN NOT NULL DEFAULT false,
    "denyReason" TEXT,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'VOB',
    "decidedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VobDecision_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VobDecision_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "IntakeCase" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "VobDecision_practiceId_payerId_planSegment_idx" ON "VobDecision"("practiceId", "payerId", "planSegment");

