-- AlterTable
ALTER TABLE "Claim" ADD COLUMN     "lastStatementAt" TIMESTAMP(3),
ADD COLUMN     "statementCycle" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "statementHold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "statementHoldReason" TEXT,
ADD COLUMN     "statementHoldUntil" TIMESTAMP(3),
ADD COLUMN     "statementPreference" TEXT NOT NULL DEFAULT 'PAPER';

-- AlterTable
ALTER TABLE "PracticeSettings" ADD COLUMN     "statementCycles" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "statementMessage1" TEXT,
ADD COLUMN     "statementMessage2" TEXT,
ADD COLUMN     "statementMessage3" TEXT,
ADD COLUMN     "statementMinCents" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN     "statementMinDays" INTEGER NOT NULL DEFAULT 28;

-- AlterTable
ALTER TABLE "Statement" ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'PAPER',
ADD COLUMN     "cycle" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "deliveryNote" TEXT,
ADD COLUMN     "message" TEXT,
ADD COLUMN     "runId" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'GENERATED';

-- CreateTable
CREATE TABLE "StatementRun" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "count" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "StatementRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentPlan" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "installmentCents" INTEGER NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'MONTHLY',
    "method" TEXT NOT NULL DEFAULT 'MANUAL',
    "cardRef" TEXT,
    "nextDueAt" TIMESTAMP(3),
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "missed" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentPlanInstallment" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DUE',
    "paidAt" TIMESTAMP(3),
    "receiptId" TEXT,

    CONSTRAINT "PaymentPlanInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionsCase" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "balanceCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REVIEW',
    "agency" TEXT,
    "referredAt" TIMESTAMP(3),
    "note" TEXT,
    "outcome" TEXT,
    "createdById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionsCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentPlan_practiceId_status_idx" ON "PaymentPlan"("practiceId", "status");

-- CreateIndex
CREATE INDEX "CollectionsCase_practiceId_status_idx" ON "CollectionsCase"("practiceId", "status");

-- AddForeignKey
ALTER TABLE "Statement" ADD CONSTRAINT "Statement_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StatementRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementRun" ADD CONSTRAINT "StatementRun_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPlanInstallment" ADD CONSTRAINT "PaymentPlanInstallment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PaymentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionsCase" ADD CONSTRAINT "CollectionsCase_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionsCase" ADD CONSTRAINT "CollectionsCase_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

