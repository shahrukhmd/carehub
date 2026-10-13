-- Enrollment statuses: six remain (Not started, Additional docs required, Submitted / in process, Approved,
-- Approved — follows parent payer, Panel closed). The rest are mapped onto them.
ALTER TABLE "ProviderEnrollment" ADD COLUMN "followsPayerId" TEXT;
ALTER TABLE "ProviderEnrollment" ADD CONSTRAINT "ProviderEnrollment_followsPayerId_fkey" FOREIGN KEY ("followsPayerId") REFERENCES "Payer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "ProviderEnrollment" SET "status" = 'SUBMITTED' WHERE "status" = 'PAYER_FOLLOW_UP';
UPDATE "ProviderEnrollment" SET "status" = 'DOCUMENTS_PENDING' WHERE "status" = 'BLOCKED';
UPDATE "ProviderEnrollment" SET "status" = 'APPROVED' WHERE "status" = 'REVALIDATION_DUE';
UPDATE "ProviderEnrollment" SET "status" = 'PANEL_CLOSED' WHERE "status" IN ('DENIED', 'TERMED', 'NOT_APPLICABLE');

-- Rows that already followed a parent take the parent payer of their line's payer.
UPDATE "ProviderEnrollment" e SET "followsPayerId" = p."parentPayerId"
FROM "GroupPayerEnrollment" g JOIN "Payer" p ON p."id" = g."payerId"
WHERE e."groupPayerEnrollmentId" = g."id" AND e."status" = 'FOLLOWS_PARENT' AND e."followsPayerId" IS NULL AND p."parentPayerId" IS NOT NULL;
