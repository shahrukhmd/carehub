-- AlterTable
ALTER TABLE "Payer" ADD COLUMN "appealLimitDays" INTEGER;

-- CreateTable
CREATE TABLE "ClaimDenial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "deniedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "groupCode" TEXT,
    "code" TEXT,
    "remarks" TEXT,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "reason" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedAt" DATETIME,
    "recoveredCents" INTEGER NOT NULL DEFAULT 0,
    "ownerId" TEXT,
    "followUpAt" DATETIME,
    "workNote" TEXT,
    "appealDueAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClaimDenial_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClaimDenial_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClaimAppeal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "denialId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "letterBody" TEXT NOT NULL,
    "dueAt" DATETIME,
    "filedAt" DATETIME,
    "filedVia" TEXT,
    "faxId" TEXT,
    "letterDocumentId" TEXT,
    "payerReference" TEXT,
    "decisionAt" DATETIME,
    "recoveredCents" INTEGER NOT NULL DEFAULT 0,
    "outcomeNote" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClaimAppeal_denialId_fkey" FOREIGN KEY ("denialId") REFERENCES "ClaimDenial" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ClaimDenial_practiceId_status_idx" ON "ClaimDenial"("practiceId", "status");

-- CreateIndex
CREATE INDEX "ClaimDenial_claimId_idx" ON "ClaimDenial"("claimId");

-- CreateIndex
CREATE INDEX "ClaimAppeal_practiceId_status_idx" ON "ClaimAppeal"("practiceId", "status");

