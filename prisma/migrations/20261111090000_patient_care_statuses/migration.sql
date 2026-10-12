-- Patient Gateway boards: the patient care (PCC) statuses replace the old care statuses, and a VOB denial now shows
-- as "Unable to see" (on the VOB and Patient care boards) instead of a closed case. Data only; no schema change.

-- Old care statuses map onto the new ones: follow-up scheduling -> Confirmed, inactive -> Discharged,
-- limited services -> Active (the limited scope stays recorded in the VOB decision).
UPDATE "IntakeCase"
SET "careStatus" = CASE "careStatus"
  WHEN 'FOLLOW_UP' THEN 'CONFIRMED'
  WHEN 'INACTIVE' THEN 'DISCHARGED'
  WHEN 'LIMITED' THEN 'ACTIVE'
  ELSE "careStatus"
END
WHERE "careStatus" IN ('FOLLOW_UP', 'INACTIVE', 'LIMITED');

-- Every scheduled patient has a patient care status; one without starts at Confirmed.
UPDATE "IntakeCase"
SET "careStatus" = 'CONFIRMED'
WHERE "stage" = 'SCHEDULED'
  AND ("careStatus" IS NULL OR "careStatus" NOT IN ('CONFIRMED', 'RESCHEDULED', 'ACTIVE', 'ACTIVE_HOSPITALIZED', 'PENDING_DISCHARGE', 'DISCHARGED', 'UNSEEN_HOSPITALIZED'));

-- Before scheduling a case has no patient care status.
UPDATE "IntakeCase"
SET "careStatus" = NULL
WHERE "stage" IN ('DATA_ENTRY', 'VERIFICATION', 'AUTH_PENDING', 'PCC_REFERRAL', 'SCHEDULING');

-- Patients the VOB team denied show as Unable to see.
UPDATE "IntakeCase"
SET "stage" = 'UNABLE_TO_SEE'
WHERE "stage" = 'CLOSED' AND "vobDecision" = 'DENIED';
