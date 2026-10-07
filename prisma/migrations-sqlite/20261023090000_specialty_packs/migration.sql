-- AlterTable
ALTER TABLE "CareRule" ADD COLUMN "specialty" TEXT;

-- AlterTable
ALTER TABLE "ChartWorkflow" ADD COLUMN "specialty" TEXT;

-- AlterTable
ALTER TABLE "DocumentTemplate" ADD COLUMN "specialty" TEXT;

-- AlterTable
ALTER TABLE "OrderCatalogItem" ADD COLUMN "specialty" TEXT;

-- AlterTable
ALTER TABLE "VisitType" ADD COLUMN "specialty" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PracticeSettings" (
    "specialties" TEXT NOT NULL DEFAULT 'WOUND_CARE',
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "payToName" TEXT,
    "payToAddress1" TEXT,
    "payToAddress2" TEXT,
    "payToCity" TEXT,
    "payToState" TEXT,
    "payToZip" TEXT,
    "payeeName" TEXT,
    "payeeAddress1" TEXT,
    "payeeAddress2" TEXT,
    "payeeCity" TEXT,
    "payeeState" TEXT,
    "payeeZip" TEXT,
    "remitName" TEXT,
    "remitAddress1" TEXT,
    "remitAddress2" TEXT,
    "remitCity" TEXT,
    "remitState" TEXT,
    "remitZip" TEXT,
    "physicalName" TEXT,
    "physicalAddress1" TEXT,
    "physicalAddress2" TEXT,
    "physicalCity" TEXT,
    "physicalState" TEXT,
    "physicalZip" TEXT,
    "yearEndMonth" INTEGER NOT NULL DEFAULT 12,
    "taxIdSource" TEXT NOT NULL DEFAULT 'ACCOUNT',
    "practiceTaxId" TEXT,
    "useVisitNumbers" BOOLEAN NOT NULL DEFAULT false,
    "cutoffDay" INTEGER,
    "cutoffLastDay" BOOLEAN NOT NULL DEFAULT false,
    "cutoffMonth" TEXT NOT NULL DEFAULT 'FOLLOWING',
    "billingPhone" TEXT,
    "allowZeroChargeClaims" BOOLEAN NOT NULL DEFAULT false,
    "includeEmergencyFlag" BOOLEAN NOT NULL DEFAULT false,
    "allowEdiVoid" BOOLEAN NOT NULL DEFAULT true,
    "enableClaimRules" BOOLEAN NOT NULL DEFAULT true,
    "suppressSecondaryEraAdjustments" BOOLEAN NOT NULL DEFAULT false,
    "holdClaimsForCredentialing" BOOLEAN NOT NULL DEFAULT false,
    "clearinghouse" TEXT NOT NULL DEFAULT 'MOCK',
    "documentAiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "faxNumber" TEXT,
    "faxProvider" TEXT NOT NULL DEFAULT 'MOCK',
    "updatedAt" DATETIME NOT NULL,
    "eligibilityAuto" BOOLEAN NOT NULL DEFAULT false,
    "referralFollowUpDays" INTEGER NOT NULL DEFAULT 30,
    CONSTRAINT "PracticeSettings_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PracticeSettings" ("allowEdiVoid", "allowZeroChargeClaims", "billingPhone", "clearinghouse", "cutoffDay", "cutoffLastDay", "cutoffMonth", "documentAiEnabled", "eligibilityAuto", "enableClaimRules", "faxNumber", "faxProvider", "holdClaimsForCredentialing", "id", "includeEmergencyFlag", "payToAddress1", "payToAddress2", "payToCity", "payToName", "payToState", "payToZip", "payeeAddress1", "payeeAddress2", "payeeCity", "payeeName", "payeeState", "payeeZip", "physicalAddress1", "physicalAddress2", "physicalCity", "physicalName", "physicalState", "physicalZip", "practiceId", "practiceTaxId", "referralFollowUpDays", "remitAddress1", "remitAddress2", "remitCity", "remitName", "remitState", "remitZip", "suppressSecondaryEraAdjustments", "taxIdSource", "updatedAt", "useVisitNumbers", "yearEndMonth") SELECT "allowEdiVoid", "allowZeroChargeClaims", "billingPhone", "clearinghouse", "cutoffDay", "cutoffLastDay", "cutoffMonth", "documentAiEnabled", "eligibilityAuto", "enableClaimRules", "faxNumber", "faxProvider", "holdClaimsForCredentialing", "id", "includeEmergencyFlag", "payToAddress1", "payToAddress2", "payToCity", "payToName", "payToState", "payToZip", "payeeAddress1", "payeeAddress2", "payeeCity", "payeeName", "payeeState", "payeeZip", "physicalAddress1", "physicalAddress2", "physicalCity", "physicalName", "physicalState", "physicalZip", "practiceId", "practiceTaxId", "referralFollowUpDays", "remitAddress1", "remitAddress2", "remitCity", "remitName", "remitState", "remitZip", "suppressSecondaryEraAdjustments", "taxIdSource", "updatedAt", "useVisitNumbers", "yearEndMonth" FROM "PracticeSettings";
DROP TABLE "PracticeSettings";
ALTER TABLE "new_PracticeSettings" RENAME TO "PracticeSettings";
CREATE UNIQUE INDEX "PracticeSettings_practiceId_key" ON "PracticeSettings"("practiceId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


-- Tag the standard wound-care content that practices already have (see src/lib/specialties.ts).
UPDATE "VisitType" SET "specialty" = 'WOUND_CARE' WHERE "specialty" IS NULL AND "code" IN ('INIT_WOUND','EST_WOUND','WOUND_CARE','ACTIGRAFT','ABI','PROV_MIST','NPWCN_MIST','NON_PROVIDER','SURVEILLANCE','TELE_INIT','TELE_EST');
UPDATE "DocumentTemplate" SET "specialty" = 'WOUND_CARE' WHERE "specialty" IS NULL AND "standard" = 1 AND ("key" IN ('wounds','physician_orders','treatment_notes','ctp','lower_extremity','lymphedema','npwt','offloading','pneumatic_compression','braden','plan_of_care','debridement','unna_boot','wound_assessment_details','treatment_goals','wound_management_plan','wound_product_supplier','telehealth_plans') OR "key" GLOB '*_v[0-9]*' AND substr("key", 1, instr("key", '_v') - 1) IN ('physician_orders','ctp','lower_extremity','plan_of_care'));
UPDATE "ChartWorkflow" SET "specialty" = 'WOUND_CARE' WHERE "specialty" IS NULL AND "name" IN ('Wound Care Visit','Non-Provider Treatment Visit','Initial Wound Care','Established Wound Care','Surveillance Visit','Provider Ultrasound Mist Therapy','Actigraft Application','Ankle Brachial Index Assessment');
UPDATE "CareRule" SET "specialty" = 'WOUND_CARE' WHERE "specialty" IS NULL AND "standard" = 1 AND "key" IN ('braden','nutrition','vascular_abi');
UPDATE "OrderCatalogItem" SET "specialty" = 'WOUND_CARE' WHERE "specialty" IS NULL AND "code" IN ('1751-7','14338-8','1988-5','4537-7','6462-6','635-3','22634-0','2276-4','5763-8','73630','73610','73590','73718','73720','73700','78315','93922','93925','93970');
