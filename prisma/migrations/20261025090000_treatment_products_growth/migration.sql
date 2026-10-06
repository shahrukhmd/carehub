-- AlterTable
ALTER TABLE "Vitals" ADD COLUMN "headCircumferenceCm" REAL;

-- CreateTable
CREATE TABLE "WoundProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "productType" TEXT NOT NULL DEFAULT 'PRIMARY',
    "hcpcsCode" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'each',
    "size" TEXT,
    "instructions" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "standard" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WoundProduct_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TreatmentStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productTypes" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "standard" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    CONSTRAINT "TreatmentStep_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WoundTreatment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "woundId" TEXT NOT NULL,
    "performedById" TEXT,
    "notes" TEXT,
    "billedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WoundTreatment_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WoundTreatment_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WoundTreatment_woundId_fkey" FOREIGN KEY ("woundId") REFERENCES "Wound" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WoundTreatment_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WoundTreatmentLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "treatmentId" TEXT NOT NULL,
    "stepId" TEXT,
    "stepName" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'each',
    "instructions" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "WoundTreatmentLine_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "WoundTreatment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WoundTreatmentLine_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "TreatmentStep" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WoundTreatmentLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "WoundProduct" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WoundProduct_practiceId_productType_idx" ON "WoundProduct"("practiceId", "productType");

-- CreateIndex
CREATE UNIQUE INDEX "WoundTreatment_encounterId_woundId_key" ON "WoundTreatment"("encounterId", "woundId");

