-- AlterTable
ALTER TABLE "Payer" ADD COLUMN "planSegment" TEXT;

-- CreateTable
CREATE TABLE "PayerPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "planSegment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REVIEW',
    "source" TEXT NOT NULL DEFAULT 'CREDENTIALING',
    "notes" TEXT,
    "seenCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" DATETIME,
    "decidedById" TEXT,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PayerPlan_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PayerPlan_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PayerPlan_practiceId_status_idx" ON "PayerPlan"("practiceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayerPlan_payerId_nameKey_key" ON "PayerPlan"("payerId", "nameKey");

