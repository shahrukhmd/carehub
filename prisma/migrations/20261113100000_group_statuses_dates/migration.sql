-- Group lines use the same six statuses as provider enrollments, can follow a parent payer, and both carry the
-- dates each status asks for.
ALTER TABLE "GroupPayerEnrollment" ADD COLUMN "followsPayerId" TEXT;
ALTER TABLE "GroupPayerEnrollment" ADD COLUMN "submittedDate" TIMESTAMP(3);
ALTER TABLE "GroupPayerEnrollment" ADD COLUMN "requestedDate" TIMESTAMP(3);
ALTER TABLE "GroupPayerEnrollment" ADD COLUMN "inquiryDate" TIMESTAMP(3);
ALTER TABLE "GroupPayerEnrollment" ADD COLUMN "followUpDate" TIMESTAMP(3);
ALTER TABLE "GroupPayerEnrollment" ADD CONSTRAINT "GroupPayerEnrollment_followsPayerId_fkey" FOREIGN KEY ("followsPayerId") REFERENCES "Payer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProviderEnrollment" ADD COLUMN "requestedDate" TIMESTAMP(3);
ALTER TABLE "ProviderEnrollment" ADD COLUMN "inquiryDate" TIMESTAMP(3);

UPDATE "GroupPayerEnrollment" SET "groupStatus" = 'SUBMITTED' WHERE "groupStatus" = 'IN_PROCESS';
UPDATE "GroupPayerEnrollment" SET "groupStatus" = 'NOT_STARTED' WHERE "groupStatus" = 'REMARKS';
UPDATE "GroupPayerEnrollment" SET "groupStatus" = 'PANEL_CLOSED' WHERE "groupStatus" = 'DENIED';
-- "Follows Medicare" becomes "follows parent payer" with the practice's Medicare payer as the parent.
UPDATE "GroupPayerEnrollment" g SET "followsPayerId" = (
  SELECT p."id" FROM "Payer" p JOIN "BillingProvider" b ON b."practiceId" = p."practiceId"
  WHERE b."id" = g."billingProviderId" AND p."id" <> g."payerId" AND p."name" ILIKE 'medicare%'
  ORDER BY p."name" LIMIT 1
) WHERE g."groupStatus" = 'FOLLOWS_MEDICARE';
UPDATE "GroupPayerEnrollment" SET "groupStatus" = 'FOLLOWS_PARENT' WHERE "groupStatus" = 'FOLLOWS_MEDICARE';
