-- AlterTable
ALTER TABLE "BillingProvider" ADD COLUMN "phone" TEXT;
ALTER TABLE "BillingProvider" ADD COLUMN "taxonomy" TEXT;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN "npi" TEXT;

-- CreateTable
CREATE TABLE "ClaimLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "chargeId" TEXT,
    "lineNumber" INTEGER NOT NULL,
    "dosFrom" DATETIME NOT NULL,
    "dosTo" DATETIME NOT NULL,
    "placeOfService" TEXT NOT NULL,
    "emergency" BOOLEAN NOT NULL DEFAULT false,
    "cptCode" TEXT NOT NULL,
    "modifiers" TEXT,
    "pointers" TEXT NOT NULL,
    "units" REAL NOT NULL DEFAULT 1,
    "chargeCents" INTEGER NOT NULL,
    "ndcCode" TEXT,
    "ndcQuantity" REAL,
    "ndcUnit" TEXT,
    "lineNote" TEXT,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "adjustedCents" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ClaimLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClaimLine_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClaimDiagnosis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "icd10" TEXT NOT NULL,
    "description" TEXT,
    CONSTRAINT "ClaimDiagnosis_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClaimEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClaimEvent_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClaimEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Claim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "payerRank" TEXT NOT NULL DEFAULT 'PRIMARY',
    "insuranceId" TEXT,
    "payerId" TEXT,
    "payerName" TEXT NOT NULL,
    "formType" TEXT NOT NULL DEFAULT 'CMS1500',
    "frequencyCode" TEXT NOT NULL DEFAULT '1',
    "originalReference" TEXT,
    "replacesClaimId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "placeOfService" TEXT,
    "billingProviderId" TEXT,
    "renderingProviderId" TEXT,
    "referringProviderId" TEXT,
    "supervisingProviderId" TEXT,
    "orderingProviderId" TEXT,
    "serviceLocationId" TEXT,
    "priorAuthNumber" TEXT,
    "referralNumber" TEXT,
    "patientAccountNumber" TEXT,
    "acceptAssignment" BOOLEAN NOT NULL DEFAULT true,
    "employmentRelated" BOOLEAN NOT NULL DEFAULT false,
    "autoAccident" BOOLEAN NOT NULL DEFAULT false,
    "autoAccidentState" TEXT,
    "otherAccident" BOOLEAN NOT NULL DEFAULT false,
    "onsetDate" DATETIME,
    "initialTreatmentDate" DATETIME,
    "unableToWorkFrom" DATETIME,
    "unableToWorkTo" DATETIME,
    "hospitalFrom" DATETIME,
    "hospitalTo" DATETIME,
    "claimNote" TEXT,
    "outsideLab" BOOLEAN NOT NULL DEFAULT false,
    "outsideLabChargesCents" INTEGER,
    "cliaNumber" TEXT,
    "delayReasonCode" TEXT,
    "billedCents" INTEGER NOT NULL DEFAULT 0,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "adjustedCents" INTEGER NOT NULL DEFAULT 0,
    "balanceResponsibility" TEXT NOT NULL DEFAULT 'INSURANCE',
    "denialReason" TEXT,
    "statusNote" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "clearinghouseStatus" TEXT,
    "clearinghouseClaimId" TEXT,
    "rejectionReason" TEXT,
    CONSTRAINT "Claim_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Claim_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Claim_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Claim_insuranceId_fkey" FOREIGN KEY ("insuranceId") REFERENCES "Insurance" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Claim_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Claim_billingProviderId_fkey" FOREIGN KEY ("billingProviderId") REFERENCES "BillingProvider" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Claim_renderingProviderId_fkey" FOREIGN KEY ("renderingProviderId") REFERENCES "RenderingProvider" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Claim_referringProviderId_fkey" FOREIGN KEY ("referringProviderId") REFERENCES "RenderingProvider" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Claim_supervisingProviderId_fkey" FOREIGN KEY ("supervisingProviderId") REFERENCES "RenderingProvider" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Claim_orderingProviderId_fkey" FOREIGN KEY ("orderingProviderId") REFERENCES "RenderingProvider" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Claim_serviceLocationId_fkey" FOREIGN KEY ("serviceLocationId") REFERENCES "Location" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
-- Existing claims were one per charge line; each becomes a claim on its visit with that charge as line 1.
INSERT INTO "new_Claim" ("id", "practiceId", "encounterId", "patientId", "payerRank", "insuranceId", "payerId", "payerName",
  "status", "placeOfService", "billingProviderId", "referringProviderId", "supervisingProviderId", "patientAccountNumber",
  "billedCents", "paidCents", "adjustedCents", "balanceResponsibility", "denialReason", "statusNote", "attempt",
  "submittedAt", "createdAt", "updatedAt", "clearinghouseStatus", "clearinghouseClaimId", "rejectionReason")
SELECT c."id", ch."practiceId", ch."encounterId", e."patientId", 'PRIMARY',
  (SELECT i."id" FROM "Insurance" i WHERE i."patientId" = e."patientId" ORDER BY i."isPrimary" DESC LIMIT 1),
  (SELECT i."payerId" FROM "Insurance" i WHERE i."patientId" = e."patientId" ORDER BY i."isPrimary" DESC LIMIT 1),
  c."payerName", c."status", ch."placeOfService", e."billingProviderId", p."referringPhysicianId", e."supervisingProviderId", p."mrn",
  c."billedCents", c."paidCents", c."adjustedCents", c."balanceResponsibility", c."denialReason", c."statusNote", c."attempt",
  c."submittedAt", c."createdAt", CURRENT_TIMESTAMP, c."clearinghouseStatus", c."clearinghouseClaimId", c."rejectionReason"
FROM "Claim" c
JOIN "Charge" ch ON ch."id" = c."chargeId"
JOIN "Encounter" e ON e."id" = ch."encounterId"
JOIN "Patient" p ON p."id" = e."patientId";

INSERT INTO "ClaimLine" ("id", "claimId", "chargeId", "lineNumber", "dosFrom", "dosTo", "placeOfService", "cptCode", "modifiers", "pointers", "units", "chargeCents")
SELECT 'cl_' || c."id", c."id", ch."id", 1, e."date", e."date", ch."placeOfService", ch."cptCode", ch."modifiers", '', ch."units", ch."amountCents"
FROM "Claim" c
JOIN "Charge" ch ON ch."id" = c."chargeId"
JOIN "Encounter" e ON e."id" = ch."encounterId";

INSERT INTO "ClaimDiagnosis" ("id", "claimId", "sequence", "icd10", "description")
SELECT 'cd_' || c."id" || '_' || d."id", c."id",
  (SELECT count(*) FROM "EncounterDiagnosis" d2 WHERE d2."encounterId" = d."encounterId" AND (d2."priority" < d."priority" OR (d2."priority" = d."priority" AND d2."id" < d."id"))),
  d."icd10", d."description"
FROM "Claim" c
JOIN "Charge" ch ON ch."id" = c."chargeId"
JOIN "EncounterDiagnosis" d ON d."encounterId" = ch."encounterId";

-- Charge diagnosis pointers were diagnosis ids; on the claim they are letters A-L.
UPDATE "ClaimLine" SET "pointers" = COALESCE((
  SELECT group_concat(char(65 + cd."sequence"), ',')
  FROM "ClaimDiagnosis" cd
  WHERE cd."claimId" = "ClaimLine"."claimId"
    AND instr(',' || COALESCE((SELECT ch."diagnosisPointers" FROM "Charge" ch WHERE ch."id" = "ClaimLine"."chargeId"), '') || ',',
              ',' || substr(cd."id", length('cd_' || "ClaimLine"."claimId" || '_') + 1) || ',') > 0
), '');

DROP TABLE "Claim";
ALTER TABLE "new_Claim" RENAME TO "Claim";
CREATE INDEX "Claim_practiceId_status_idx" ON "Claim"("practiceId", "status");
CREATE INDEX "Claim_encounterId_idx" ON "Claim"("encounterId");
CREATE TABLE "new_Encounter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL DEFAULT 'OFFICE',
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "chiefComplaint" TEXT,
    "subjective" TEXT,
    "objective" TEXT,
    "assessment" TEXT,
    "plan" TEXT,
    "patientStatus" TEXT,
    "mdmLevel" TEXT,
    "hospice" BOOLEAN NOT NULL DEFAULT false,
    "billingProviderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "statusChangedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "placeOfService" TEXT,
    "clinicalStaffId" TEXT,
    "supervisingProviderId" TEXT,
    "submittedToCdsAt" DATETIME,
    "cdsQueryNote" TEXT,
    "codedById" TEXT,
    "codedAt" DATETIME,
    "finalizedAt" DATETIME,
    "holdReason" TEXT,
    "holdFromStatus" TEXT,
    "billingStatus" TEXT NOT NULL DEFAULT 'OPEN',
    CONSTRAINT "Encounter_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Encounter_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Encounter_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Encounter_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Encounter_billingProviderId_fkey" FOREIGN KEY ("billingProviderId") REFERENCES "BillingProvider" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Encounter_clinicalStaffId_fkey" FOREIGN KEY ("clinicalStaffId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Encounter_supervisingProviderId_fkey" FOREIGN KEY ("supervisingProviderId") REFERENCES "RenderingProvider" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Encounter_codedById_fkey" FOREIGN KEY ("codedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Encounter" ("appointmentId", "assessment", "billingProviderId", "cdsQueryNote", "chiefComplaint", "clinicalStaffId", "codedAt", "codedById", "createdAt", "date", "finalizedAt", "holdFromStatus", "holdReason", "hospice", "id", "mdmLevel", "objective", "patientId", "patientStatus", "placeOfService", "plan", "practiceId", "providerId", "status", "statusChangedAt", "subjective", "submittedToCdsAt", "supervisingProviderId", "type", "updatedAt") SELECT "appointmentId", "assessment", "billingProviderId", "cdsQueryNote", "chiefComplaint", "clinicalStaffId", "codedAt", "codedById", "createdAt", "date", "finalizedAt", "holdFromStatus", "holdReason", "hospice", "id", "mdmLevel", "objective", "patientId", "patientStatus", "placeOfService", "plan", "practiceId", "providerId", "status", "statusChangedAt", "subjective", "submittedToCdsAt", "supervisingProviderId", "type", "updatedAt" FROM "Encounter";
DROP TABLE "Encounter";
ALTER TABLE "new_Encounter" RENAME TO "Encounter";
CREATE UNIQUE INDEX "Encounter_appointmentId_key" ON "Encounter"("appointmentId");
CREATE TABLE "new_Insurance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "groupNumber" TEXT,
    "planName" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "rank" TEXT NOT NULL DEFAULT 'PRIMARY',
    "relationshipToInsured" TEXT NOT NULL DEFAULT '18',
    "insuredFirstName" TEXT,
    "insuredLastName" TEXT,
    "insuredDob" DATETIME,
    "insuredSex" TEXT,
    "insuredAddressLine1" TEXT,
    "insuredCity" TEXT,
    "insuredState" TEXT,
    "insuredZip" TEXT,
    "effectiveDate" DATETIME,
    "terminationDate" DATETIME,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Insurance_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Insurance_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Insurance" ("groupNumber", "id", "isPrimary", "memberId", "patientId", "payerId", "planName") SELECT "groupNumber", "id", "isPrimary", "memberId", "patientId", "payerId", "planName" FROM "Insurance";
DROP TABLE "Insurance";
ALTER TABLE "new_Insurance" RENAME TO "Insurance";
UPDATE "Insurance" SET "rank" = CASE WHEN "isPrimary" THEN 'PRIMARY' ELSE 'SECONDARY' END;
UPDATE "Encounter" SET "billingStatus" = CASE
  WHEN EXISTS (SELECT 1 FROM "Claim" c WHERE c."encounterId" = "Encounter"."id") THEN 'CLAIM_CREATED_PRIMARY'
  WHEN "status" IN ('READY_FOR_BILLING', 'BILLED') THEN 'READY_FOR_CLAIM'
  ELSE 'OPEN' END;
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ClaimDiagnosis_claimId_sequence_key" ON "ClaimDiagnosis"("claimId", "sequence");
