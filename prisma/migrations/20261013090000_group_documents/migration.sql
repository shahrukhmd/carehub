-- CreateTable
CREATE TABLE "GroupDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billingProviderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "issueDate" DATETIME,
    "expiryDate" DATETIME,
    "supersededAt" DATETIME,
    "uploadedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupDocument_billingProviderId_fkey" FOREIGN KEY ("billingProviderId") REFERENCES "BillingProvider" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "GroupDocument_billingProviderId_idx" ON "GroupDocument"("billingProviderId");

