-- AlterTable
ALTER TABLE "EncounterSignature" ADD COLUMN "signatureImage" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "signatureImage" TEXT;
ALTER TABLE "User" ADD COLUMN "signatureUpdatedAt" DATETIME;

-- CreateTable
CREATE TABLE "PracticeCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "feeCents" INTEGER,
    "modifiers" TEXT,
    "favorite" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PracticeCode_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PracticeCode_practiceId_type_code_key" ON "PracticeCode"("practiceId", "type", "code");
