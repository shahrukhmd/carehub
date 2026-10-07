-- CreateTable
CREATE TABLE "PayerRuleSet" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "submissionType" TEXT NOT NULL DEFAULT 'ELECTRONIC',
    "paperForm" TEXT NOT NULL DEFAULT 'CMS1500',
    "claimPayerId" TEXT,
    "eligibilityPayerId" TEXT,
    "statusPayerId" TEXT,
    "crossover" TEXT NOT NULL DEFAULT 'AUTO',
    "renderingRule" TEXT NOT NULL DEFAULT 'ALWAYS',
    "serviceLocationRule" TEXT NOT NULL DEFAULT 'ALWAYS',
    "homeBound" BOOLEAN NOT NULL DEFAULT false,
    "hold" BOOLEAN NOT NULL DEFAULT false,
    "holdReason" TEXT,
    "holdUntil" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayerRuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayerBillingOverride" (
    "id" TEXT NOT NULL,
    "ruleSetId" TEXT NOT NULL,
    "locationId" TEXT,
    "renderingProviderId" TEXT,
    "billUnder" TEXT NOT NULL DEFAULT 'PRACTICE',
    "taxIdType" TEXT NOT NULL DEFAULT 'EIN',
    "payTo" TEXT NOT NULL DEFAULT 'PRACTICE',
    "payToName" TEXT,
    "payToLine1" TEXT,
    "payToLine2" TEXT,
    "payToCity" TEXT,
    "payToState" TEXT,
    "payToZip" TEXT,
    "taxonomy" TEXT,
    "legacyId" TEXT,

    CONSTRAINT "PayerBillingOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayerRuleSet_practiceId_payerId_effectiveFrom_idx" ON "PayerRuleSet"("practiceId", "payerId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "PayerRuleSet" ADD CONSTRAINT "PayerRuleSet_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayerRuleSet" ADD CONSTRAINT "PayerRuleSet_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayerBillingOverride" ADD CONSTRAINT "PayerBillingOverride_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "PayerRuleSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayerBillingOverride" ADD CONSTRAINT "PayerBillingOverride_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayerBillingOverride" ADD CONSTRAINT "PayerBillingOverride_renderingProviderId_fkey" FOREIGN KEY ("renderingProviderId") REFERENCES "RenderingProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

