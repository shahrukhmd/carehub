-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GroupPayerEnrollment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billingProviderId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "planSegment" TEXT NOT NULL DEFAULT 'COMMERCIAL',
    "planType" TEXT,
    "groupStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "ediStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "eftStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "effectiveDate" DATETIME,
    "payerGroupId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GroupPayerEnrollment_billingProviderId_fkey" FOREIGN KEY ("billingProviderId") REFERENCES "BillingProvider" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupPayerEnrollment_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GroupPayerEnrollment" ("billingProviderId", "createdAt", "ediStatus", "effectiveDate", "eftStatus", "groupStatus", "id", "notes", "payerGroupId", "payerId", "planType", "updatedAt") SELECT "billingProviderId", "createdAt", "ediStatus", "effectiveDate", "eftStatus", "groupStatus", "id", "notes", "payerGroupId", "payerId", "planType", "updatedAt" FROM "GroupPayerEnrollment";
DROP TABLE "GroupPayerEnrollment";
ALTER TABLE "new_GroupPayerEnrollment" RENAME TO "GroupPayerEnrollment";
CREATE UNIQUE INDEX "GroupPayerEnrollment_billingProviderId_payerId_planSegment_key" ON "GroupPayerEnrollment"("billingProviderId", "payerId", "planSegment");
CREATE TABLE "new_Practice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "state" TEXT,
    "organizationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Practice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Practice" ("createdAt", "id", "name", "slug") SELECT "createdAt", "id", "name", "slug" FROM "Practice";
DROP TABLE "Practice";
ALTER TABLE "new_Practice" RENAME TO "Practice";
CREATE UNIQUE INDEX "Practice_slug_key" ON "Practice"("slug");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "isMaster" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CLINICIAN',
    "passwordHash" TEXT NOT NULL,
    "npi" TEXT,
    "specialty" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_User" ("active", "createdAt", "email", "id", "name", "npi", "passwordHash", "practiceId", "role", "specialty") SELECT "active", "createdAt", "email", "id", "name", "npi", "passwordHash", "practiceId", "role", "specialty" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

