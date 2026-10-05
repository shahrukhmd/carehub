-- CreateTable
CREATE TABLE "PayerCatalogEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clearinghouse" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relatedNames" TEXT,
    "payerClass" TEXT,
    "professional" BOOLEAN NOT NULL DEFAULT true,
    "institutional" BOOLEAN NOT NULL DEFAULT false,
    "remits" BOOLEAN NOT NULL DEFAULT false,
    "eligibility" BOOLEAN NOT NULL DEFAULT false,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "phone" TEXT,
    "loadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "PayerCatalogEntry_clearinghouse_payerId_idx" ON "PayerCatalogEntry"("clearinghouse", "payerId");

-- CreateIndex
CREATE INDEX "PayerCatalogEntry_clearinghouse_name_idx" ON "PayerCatalogEntry"("clearinghouse", "name");

