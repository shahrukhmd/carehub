-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PatientPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "balanceCents" INTEGER NOT NULL,
    "amountCents" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "provider" TEXT NOT NULL DEFAULT 'TEST',
    "providerRef" TEXT,
    "depositId" TEXT,
    "sentVia" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "paidAt" DATETIME,
    "receiptEmail" TEXT,
    "verifyAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "sessionHash" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PatientPayment_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PatientPayment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PatientPayment" ("amountCents", "balanceCents", "createdAt", "createdById", "depositId", "expiresAt", "id", "paidAt", "patientId", "practiceId", "provider", "providerRef", "receiptEmail", "sentVia", "status", "token") SELECT "amountCents", "balanceCents", "createdAt", "createdById", "depositId", "expiresAt", "id", "paidAt", "patientId", "practiceId", "provider", "providerRef", "receiptEmail", "sentVia", "status", "token" FROM "PatientPayment";
DROP TABLE "PatientPayment";
ALTER TABLE "new_PatientPayment" RENAME TO "PatientPayment";
CREATE UNIQUE INDEX "PatientPayment_token_key" ON "PatientPayment"("token");
CREATE INDEX "PatientPayment_practiceId_status_idx" ON "PatientPayment"("practiceId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

