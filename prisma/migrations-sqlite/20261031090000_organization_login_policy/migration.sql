-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legalName" TEXT,
    "taxId" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "accountManager" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "terminatedAt" DATETIME,
    "feePercent" REAL,
    "minimumMonthlyCents" INTEGER,
    "invoiceDay" INTEGER NOT NULL DEFAULT 1,
    "onboarding" TEXT,
    "notes" TEXT,
    "maxFailedLogins" INTEGER NOT NULL DEFAULT 5,
    "lockoutMinutes" INTEGER NOT NULL DEFAULT 15,
    "passwordMaxAgeDays" INTEGER NOT NULL DEFAULT 0,
    "twoFactorRequired" BOOLEAN NOT NULL DEFAULT false,
    "idleTimeoutMinutes" INTEGER NOT NULL DEFAULT 0,
    "ipAllowlist" TEXT,
    "ipAllowlistExempt" TEXT
);
INSERT INTO "new_Organization" ("createdAt", "id", "name") SELECT "createdAt", "id", "name" FROM "Organization";
DROP TABLE "Organization";
ALTER TABLE "new_Organization" RENAME TO "Organization";
CREATE TABLE "new_Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "activePracticeId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "twoFactorPending" BOOLEAN NOT NULL DEFAULT false,
    "otpHash" TEXT,
    "otpExpiresAt" DATETIME,
    "otpAttempts" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Session_activePracticeId_fkey" FOREIGN KEY ("activePracticeId") REFERENCES "Practice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Session" ("activePracticeId", "createdAt", "expiresAt", "id", "userId") SELECT "activePracticeId", "createdAt", "expiresAt", "id", "userId" FROM "Session";
DROP TABLE "Session";
ALTER TABLE "new_Session" RENAME TO "Session";
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
    "signatureImage" TEXT,
    "signatureUpdatedAt" DATETIME,
    "patientDashboard" TEXT,
    "dashboardTiles" TEXT,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "passwordChangedAt" DATETIME,
    "twoFactorMethod" TEXT NOT NULL DEFAULT 'NONE',
    CONSTRAINT "User_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_User" ("active", "createdAt", "dashboardTiles", "email", "id", "isMaster", "name", "npi", "passwordHash", "patientDashboard", "practiceId", "role", "signatureImage", "signatureUpdatedAt", "specialty", "username") SELECT "active", "createdAt", "dashboardTiles", "email", "id", "isMaster", "name", "npi", "passwordHash", "patientDashboard", "practiceId", "role", "signatureImage", "signatureUpdatedAt", "specialty", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

