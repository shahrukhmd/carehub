-- Insurance types: "Group health plan" becomes Commercial and "FECA / Black Lung" becomes Federal Program.
UPDATE "Payer" SET "insuranceType" = 'COMMERCIAL' WHERE "insuranceType" = 'GROUP_HEALTH';
UPDATE "Payer" SET "insuranceType" = 'FEDERAL_PROGRAM' WHERE "insuranceType" = 'FECA';
