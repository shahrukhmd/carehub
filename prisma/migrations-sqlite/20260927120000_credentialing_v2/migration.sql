-- DropIndex
DROP INDEX "ProviderCredential_billingProviderId_userId_key";

-- AlterTable
ALTER TABLE "GroupPayerEnrollment" ADD COLUMN "payerGroupId" TEXT;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ProviderCredential";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "RenderingProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "credential" TEXT,
    "npi" TEXT,
    "taxonomy" TEXT,
    "specialty" TEXT,
    "licenseNumber" TEXT,
    "licenseState" TEXT,
    "caqhId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "termDate" DATETIME,
    "supervisingProviderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RenderingProvider_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RenderingProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RenderingProvider_supervisingProviderId_fkey" FOREIGN KEY ("supervisingProviderId") REFERENCES "RenderingProvider" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProviderEnrollment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "renderingProviderId" TEXT NOT NULL,
    "groupPayerEnrollmentId" TEXT NOT NULL,
    "state" TEXT,
    "planTypes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "assignedToId" TEXT,
    "submittedDate" DATETIME,
    "effectiveDate" DATETIME,
    "termDate" DATETIME,
    "revalidationDate" DATETIME,
    "followUpDate" DATETIME,
    "payerProviderId" TEXT,
    "blockingReason" TEXT,
    "nextAction" TEXT,
    "approvalLetterPath" TEXT,
    "approvalLetterName" TEXT,
    "notes" TEXT,
    "statusChangedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProviderEnrollment_renderingProviderId_fkey" FOREIGN KEY ("renderingProviderId") REFERENCES "RenderingProvider" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProviderEnrollment_groupPayerEnrollmentId_fkey" FOREIGN KEY ("groupPayerEnrollmentId") REFERENCES "GroupPayerEnrollment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProviderEnrollment_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EnrollmentActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enrollmentId" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" TEXT NOT NULL,
    "referenceNumber" TEXT,
    "repName" TEXT,
    "note" TEXT NOT NULL,
    "loggedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EnrollmentActivity_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "ProviderEnrollment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EnrollmentActivity_loggedById_fkey" FOREIGN KEY ("loggedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProviderDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "renderingProviderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "issueDate" DATETIME,
    "expiryDate" DATETIME,
    "supersededAt" DATETIME,
    "uploadedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderDocument_renderingProviderId_fkey" FOREIGN KEY ("renderingProviderId") REFERENCES "RenderingProvider" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProviderDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PrimarySourceCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "renderingProviderId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "notes" TEXT,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedById" TEXT,
    CONSTRAINT "PrimarySourceCheck_renderingProviderId_fkey" FOREIGN KEY ("renderingProviderId") REFERENCES "RenderingProvider" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PrimarySourceCheck_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Payer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payerCode" TEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "portalName" TEXT,
    "parentPayerId" TEXT,
    CONSTRAINT "Payer_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payer_parentPayerId_fkey" FOREIGN KEY ("parentPayerId") REFERENCES "Payer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Payer" ("active", "addressLine1", "city", "createdAt", "id", "name", "payerCode", "phone", "practiceId", "state", "zip") SELECT "active", "addressLine1", "city", "createdAt", "id", "name", "payerCode", "phone", "practiceId", "state", "zip" FROM "Payer";
DROP TABLE "Payer";
ALTER TABLE "new_Payer" RENAME TO "Payer";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "RenderingProvider_userId_key" ON "RenderingProvider"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEnrollment_renderingProviderId_groupPayerEnrollmentId_key" ON "ProviderEnrollment"("renderingProviderId", "groupPayerEnrollmentId");

