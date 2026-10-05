-- CreateTable
CREATE TABLE "MasterCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codeSet" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "shortDescription" TEXT,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "edition" TEXT,
    "loadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "MasterCode_codeSet_billable_idx" ON "MasterCode"("codeSet", "billable");

-- CreateIndex
CREATE UNIQUE INDEX "MasterCode_codeSet_code_key" ON "MasterCode"("codeSet", "code");

