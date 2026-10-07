-- CreateTable
CREATE TABLE "GroupPayerEnrollment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billingProviderId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "planType" TEXT,
    "groupStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "ediStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "eftStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "effectiveDate" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GroupPayerEnrollment_billingProviderId_fkey" FOREIGN KEY ("billingProviderId") REFERENCES "BillingProvider" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupPayerEnrollment_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProviderCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billingProviderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "assignedToId" TEXT,
    "submittedDate" DATETIME,
    "followUpDate" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProviderCredential_billingProviderId_fkey" FOREIGN KEY ("billingProviderId") REFERENCES "BillingProvider" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProviderCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProviderCredential_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupPayerEnrollment_billingProviderId_payerId_key" ON "GroupPayerEnrollment"("billingProviderId", "payerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCredential_billingProviderId_userId_key" ON "ProviderCredential"("billingProviderId", "userId");
