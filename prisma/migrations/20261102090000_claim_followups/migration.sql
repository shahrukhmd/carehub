-- AlterTable
ALTER TABLE "Payer" ADD COLUMN     "outstandingDays" INTEGER;

-- AlterTable
ALTER TABLE "PracticeSettings" ADD COLUMN     "underpaymentToleranceCents" INTEGER NOT NULL DEFAULT 500;

-- CreateTable
CREATE TABLE "ClaimFollowUp" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "lastAction" TEXT,
    "ownerId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "expectedCents" INTEGER,
    "paidCents" INTEGER,
    "tickleAt" TIMESTAMP(3),
    "tickles" INTEGER NOT NULL DEFAULT 0,
    "slaDueAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "resolvedReason" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "lastActionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaimFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClaimFollowUp_practiceId_status_priority_idx" ON "ClaimFollowUp"("practiceId", "status", "priority");

-- CreateIndex
CREATE INDEX "ClaimFollowUp_claimId_idx" ON "ClaimFollowUp"("claimId");

-- AddForeignKey
ALTER TABLE "ClaimFollowUp" ADD CONSTRAINT "ClaimFollowUp_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimFollowUp" ADD CONSTRAINT "ClaimFollowUp_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimFollowUp" ADD CONSTRAINT "ClaimFollowUp_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

