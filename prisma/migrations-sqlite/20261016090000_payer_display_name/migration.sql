-- AlterTable
ALTER TABLE "Payer" ADD COLUMN "displayName" TEXT;


-- Every insurance gets its display name: the name, plus the type when the name does not already say it.
UPDATE "Payer" SET "displayName" = trim("name");
UPDATE "Payer" SET "displayName" = trim("name") || ' ' || t.label
FROM (
  SELECT 'MEDICARE' AS code, 'Medicare' AS label UNION ALL
  SELECT 'MEDICARE_ADVANTAGE', 'Medicare Advantage' UNION ALL
  SELECT 'MEDICARE_SUPPLEMENTAL', 'Medicare Supplemental' UNION ALL
  SELECT 'MEDICAID', 'Medicaid' UNION ALL
  SELECT 'MEDICAID_MCO', 'Medicaid MCO' UNION ALL
  SELECT 'COMMERCIAL', 'Commercial' UNION ALL
  SELECT 'TRICARE', 'TRICARE' UNION ALL
  SELECT 'CHAMPVA', 'CHAMPVA' UNION ALL
  SELECT 'FEDERAL_PROGRAM', 'Federal Program' UNION ALL
  SELECT 'WORKERS_COMP', 'Workers'' Compensation' UNION ALL
  SELECT 'AUTO', 'Auto'
) AS t
WHERE "Payer"."insuranceType" = t.code AND instr(lower("Payer"."name"), lower(t.label)) = 0;
