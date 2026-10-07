-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legalName" TEXT,
    "taxId" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "accountManager" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "terminatedAt" TIMESTAMP(3),
    "feePercent" DOUBLE PRECISION,
    "minimumMonthlyCents" INTEGER,
    "invoiceDay" INTEGER NOT NULL DEFAULT 1,
    "onboarding" TEXT,
    "notes" TEXT,
    "maxFailedLogins" INTEGER NOT NULL DEFAULT 5,
    "lockoutMinutes" INTEGER NOT NULL DEFAULT 15,
    "passwordMaxAgeDays" INTEGER NOT NULL DEFAULT 0,
    "twoFactorRequired" BOOLEAN NOT NULL DEFAULT false,
    "idleTimeoutMinutes" INTEGER NOT NULL DEFAULT 0,
    "ipAllowlist" TEXT,
    "ipAllowlistExempt" TEXT,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Practice" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "state" TEXT,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Practice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "permissions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "npi" TEXT,
    "officeHours" TEXT,
    "slotMinutes" INTEGER NOT NULL DEFAULT 15,
    "showNonOfficeHours" BOOLEAN NOT NULL DEFAULT false,
    "promptOutsideHours" BOOLEAN NOT NULL DEFAULT true,
    "serviceTypeId" TEXT,
    "addressLine2" TEXT,
    "fax" TEXT,
    "email" TEXT,
    "placeOfService" TEXT,
    "taxId" TEXT,
    "groupNpi" TEXT,
    "ptan" TEXT,
    "facilityBilling" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "isMaster" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CLINICIAN',
    "passwordHash" TEXT NOT NULL,
    "npi" TEXT,
    "specialty" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signatureImage" TEXT,
    "signatureUpdatedAt" TIMESTAMP(3),
    "patientDashboard" TEXT,
    "dashboardTiles" TEXT,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "passwordChangedAt" TIMESTAMP(3),
    "twoFactorMethod" TEXT NOT NULL DEFAULT 'NONE',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderAvailability" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservedTime" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "locationId" TEXT,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservedTime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activePracticeId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "twoFactorPending" BOOLEAN NOT NULL DEFAULT false,
    "otpHash" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "otpAttempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "mrn" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dob" TIMESTAMP(3) NOT NULL,
    "sex" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "addressLine1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "preferredLanguage" TEXT,
    "referringPhysicianId" TEXT,
    "race" TEXT,
    "ethnicity" TEXT,
    "maritalStatus" TEXT,
    "employmentStatus" TEXT,
    "smokingStatus" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "emergencyContactRelationship" TEXT,
    "guarantorName" TEXT,
    "guarantorRelationship" TEXT,
    "guarantorPhone" TEXT,
    "guarantorPatientId" TEXT,
    "guarantorAddress" TEXT,
    "preferredName" TEXT,
    "middleName" TEXT,
    "suffix" TEXT,
    "ssnLast4" TEXT,
    "genderIdentity" TEXT,
    "sexualOrientation" TEXT,
    "pronoun" TEXT,
    "races" TEXT,
    "religion" TEXT,
    "tribalAffiliation" TEXT,
    "interpreterNeeded" BOOLEAN NOT NULL DEFAULT false,
    "preferredCommunication" TEXT,
    "careCenterId" TEXT,
    "previousFirstName" TEXT,
    "previousMiddleName" TEXT,
    "previousLastName" TEXT,
    "nameChangedAt" TIMESTAMP(3),
    "occupation" TEXT,
    "occupationIndustry" TEXT,
    "phoneType" TEXT,
    "phone2" TEXT,
    "phone2Type" TEXT,
    "noEmail" BOOLEAN NOT NULL DEFAULT false,
    "currentAddress" TEXT NOT NULL DEFAULT 'PRIMARY',
    "addressLine2" TEXT,
    "county" TEXT,
    "secondaryAddress" TEXT,
    "previousAddress" TEXT,
    "siteOfServiceId" TEXT,
    "admissionDate" TIMESTAMP(3),
    "consult" BOOLEAN NOT NULL DEFAULT false,
    "palliativeCare" BOOLEAN NOT NULL DEFAULT false,
    "medicareAdmission" TEXT,
    "nonWoundDiagnosis" BOOLEAN NOT NULL DEFAULT false,
    "howHeard" TEXT,
    "onsetDate" TIMESTAMP(3),
    "autoAccident" BOOLEAN NOT NULL DEFAULT false,
    "autoAccidentState" TEXT,
    "autoAccidentDate" TIMESTAMP(3),
    "woundCarePhysicianId" TEXT,
    "primaryCarePhysicianId" TEXT,
    "supervisingPhysicianId" TEXT,
    "referralDate" TIMESTAMP(3),
    "externalProviders" TEXT,
    "pharmacyName" TEXT,
    "pharmacyPhone" TEXT,
    "pharmacyFax" TEXT,
    "pharmacyAddress" TEXT,
    "emergencyContactEmail" TEXT,
    "emergencyContactAddress" TEXT,
    "emergencyContactGuardian" BOOLEAN NOT NULL DEFAULT false,
    "emergencyContactGuardianAdLitem" BOOLEAN NOT NULL DEFAULT false,
    "motherFirstName" TEXT,
    "motherMaidenName" TEXT,
    "homeHealthNurse" TEXT,
    "homeHealthCompany" TEXT,
    "portalRepresentatives" TEXT,
    "registrationNotes" TEXT,
    "photoPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "restrictedReason" TEXT,
    "textConsent" TEXT,
    "voiceConsent" TEXT,
    "consentRecordedAt" TIMESTAMP(3),
    "consentMethod" TEXT,
    "consentRecordedById" TEXT,
    "customFields" TEXT,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Insurance" (
    "id" TEXT NOT NULL,
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
    "insuredDob" TIMESTAMP(3),
    "insuredSex" TEXT,
    "insuredAddressLine1" TEXT,
    "insuredCity" TEXT,
    "insuredState" TEXT,
    "insuredZip" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "terminationDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "copayCents" INTEGER,
    "groupName" TEXT,
    "insuredMiddleName" TEXT,
    "insuredPhone" TEXT,
    "deductibleCents" INTEGER,
    "deductibleMetCents" INTEGER,
    "coveragePercent" INTEGER,
    "verifiedAt" TIMESTAMP(3),
    "verifiedWith" TEXT,
    "authRequired" TEXT,
    "priorAuthRequired" TEXT,
    "notes" TEXT,

    CONSTRAINT "Insurance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payer" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payerCode" TEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "portalName" TEXT,
    "parentPayerId" TEXT,
    "insuranceType" TEXT,
    "displayName" TEXT,
    "eraPayerId" TEXT,
    "eligibilityPayerId" TEXT,
    "alternatePayerId" TEXT,
    "addressLine2" TEXT,
    "fax" TEXT,
    "contactFirstName" TEXT,
    "contactLastName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "facilityBilling" BOOLEAN NOT NULL DEFAULT false,
    "useGroupNpi" BOOLEAN NOT NULL DEFAULT false,
    "requiresVisitReview" BOOLEAN NOT NULL DEFAULT false,
    "timelyFilingLimit" INTEGER,
    "timelyFilingUnit" TEXT NOT NULL DEFAULT 'DAYS',
    "timelyFilingAlertDays" INTEGER,
    "appealLimitDays" INTEGER,
    "reimbursementRate" DOUBLE PRECISION,
    "notes" TEXT,
    "planSegment" TEXT,

    CONSTRAINT "Payer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingProvider" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "npi" TEXT,
    "taxId" TEXT,
    "addressLine1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taxonomy" TEXT,
    "phone" TEXT,

    CONSTRAINT "BillingProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupPayerEnrollment" (
    "id" TEXT NOT NULL,
    "billingProviderId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "planSegment" TEXT NOT NULL DEFAULT 'COMMERCIAL',
    "planType" TEXT,
    "groupStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "ediStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "eftStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "effectiveDate" TIMESTAMP(3),
    "payerGroupId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupPayerEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenderingProvider" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "firstName" TEXT,
    "middleName" TEXT,
    "lastName" TEXT,
    "suffix" TEXT,
    "isReferring" BOOLEAN NOT NULL DEFAULT false,
    "isClinician" BOOLEAN NOT NULL DEFAULT false,
    "isRendering" BOOLEAN NOT NULL DEFAULT false,
    "isSupervising" BOOLEAN NOT NULL DEFAULT false,
    "tin" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "phone" TEXT,
    "fax" TEXT,
    "pager" TEXT,
    "email" TEXT,
    "signatureOnFile" BOOLEAN NOT NULL DEFAULT false,
    "primarySupervising" BOOLEAN NOT NULL DEFAULT false,
    "groupName" TEXT,
    "acceptsAssignment" BOOLEAN NOT NULL DEFAULT false,
    "requiresSupervision" BOOLEAN NOT NULL DEFAULT false,
    "deaNumber" TEXT,
    "ePrescribe" BOOLEAN NOT NULL DEFAULT false,
    "interfaceId" TEXT,
    "credential" TEXT,
    "npi" TEXT,
    "taxonomy" TEXT,
    "specialty" TEXT,
    "licenseNumber" TEXT,
    "licenseState" TEXT,
    "caqhId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "termDate" TIMESTAMP(3),
    "supervisingProviderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenderingProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderEnrollment" (
    "id" TEXT NOT NULL,
    "renderingProviderId" TEXT NOT NULL,
    "groupPayerEnrollmentId" TEXT NOT NULL,
    "state" TEXT,
    "planTypes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "assignedToId" TEXT,
    "submittedDate" TIMESTAMP(3),
    "effectiveDate" TIMESTAMP(3),
    "termDate" TIMESTAMP(3),
    "revalidationDate" TIMESTAMP(3),
    "followUpDate" TIMESTAMP(3),
    "payerProviderId" TEXT,
    "blockingReason" TEXT,
    "nextAction" TEXT,
    "approvalLetterPath" TEXT,
    "approvalLetterName" TEXT,
    "notes" TEXT,
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrollmentActivity" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" TEXT NOT NULL,
    "referenceNumber" TEXT,
    "repName" TEXT,
    "note" TEXT NOT NULL,
    "loggedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrollmentActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderDocument" (
    "id" TEXT NOT NULL,
    "renderingProviderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrimarySourceCheck" (
    "id" TEXT NOT NULL,
    "renderingProviderId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "notes" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedById" TEXT,

    CONSTRAINT "PrimarySourceCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allergy" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "allergen" TEXT NOT NULL,
    "reaction" TEXT NOT NULL,
    "severity" TEXT NOT NULL,

    CONSTRAINT "Allergy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Problem" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "icd10" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "onsetDate" TIMESTAMP(3),
    "sendToSuperbill" BOOLEAN NOT NULL DEFAULT true,
    "verificationStatus" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "resolvedDate" TIMESTAMP(3),

    CONSTRAINT "Problem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Medication" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "prescriberId" TEXT,
    "name" TEXT NOT NULL,
    "sig" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "discontinuedAt" TIMESTAMP(3),

    CONSTRAINT "Medication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "visitType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "placeOfService" TEXT,
    "room" TEXT,
    "clinicalStaffId" TEXT,
    "supervisingProviderId" TEXT,
    "intakeCaseId" TEXT,
    "seriesId" TEXT,
    "conflictNote" TEXT,
    "collaboratingProviderId" TEXT,
    "accountNumber" TEXT,
    "resourceId" TEXT,
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT,
    "confirmToken" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "confirmedVia" TEXT,
    "bookingSource" TEXT,
    "bookingNote" TEXT,
    "copayDueCents" INTEGER,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Encounter" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "placeOfService" TEXT,
    "clinicalStaffId" TEXT,
    "supervisingProviderId" TEXT,
    "submittedToCdsAt" TIMESTAMP(3),
    "cdsQueryNote" TEXT,
    "codingQueryNote" TEXT,
    "codedById" TEXT,
    "codedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "holdReason" TEXT,
    "holdFromStatus" TEXT,
    "billingStatus" TEXT NOT NULL DEFAULT 'OPEN',
    "workflowId" TEXT,
    "medsReconciledAt" TIMESTAMP(3),
    "allergiesReconciledAt" TIMESTAMP(3),
    "problemsReconciledAt" TIMESTAMP(3),
    "reconciledById" TEXT,
    "transferOfCare" BOOLEAN NOT NULL DEFAULT false,
    "copiedFromEncounterId" TEXT,

    CONSTRAINT "Encounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncounterDiagnosis" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "icd10" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EncounterDiagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vitals" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "headCircumferenceCm" DOUBLE PRECISION,
    "heightCm" DOUBLE PRECISION,
    "weightKg" DOUBLE PRECISION,
    "tempC" DOUBLE PRECISION,
    "heartRate" INTEGER,
    "respRate" INTEGER,
    "bpSystolic" INTEGER,
    "bpDiastolic" INTEGER,
    "spo2" INTEGER,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vitals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabOrder" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "orderedById" TEXT NOT NULL,
    "testName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ORDERED',
    "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabResult" (
    "id" TEXT NOT NULL,
    "labOrderId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "unit" TEXT,
    "referenceRange" TEXT,
    "flag" TEXT NOT NULL DEFAULT 'NORMAL',
    "resultedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "cptCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "amountCents" INTEGER NOT NULL,
    "modifiers" TEXT,
    "diagnosisPointers" TEXT,
    "placeOfService" TEXT NOT NULL DEFAULT '11',

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
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
    "onsetDate" TIMESTAMP(3),
    "initialTreatmentDate" TIMESTAMP(3),
    "unableToWorkFrom" TIMESTAMP(3),
    "unableToWorkTo" TIMESTAMP(3),
    "hospitalFrom" TIMESTAMP(3),
    "hospitalTo" TIMESTAMP(3),
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
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clearinghouseStatus" TEXT,
    "clearinghouseClaimId" TEXT,
    "rejectionReason" TEXT,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuperbillTemplate" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuperbillTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuperbillTemplateItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "cptCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "modifiers" TEXT,
    "amountCents" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SuperbillTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Statement" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Statement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatementLine" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "balanceCents" INTEGER NOT NULL,

    CONSTRAINT "StatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "payerType" TEXT NOT NULL,
    "payerName" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "checkNumber" TEXT,
    "totalCents" INTEGER NOT NULL,
    "unappliedCents" INTEGER NOT NULL,
    "note" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "patientId" TEXT,

    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentApplication" (
    "id" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PAYMENT',
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wound" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "etiology" TEXT NOT NULL,
    "onsetDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "healedDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WoundAssessment" (
    "id" TEXT NOT NULL,
    "woundId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lengthCm" DOUBLE PRECISION,
    "widthCm" DOUBLE PRECISION,
    "depthCm" DOUBLE PRECISION,
    "areaCm2" DOUBLE PRECISION,
    "underminingCm" DOUBLE PRECISION,
    "underminingClock" TEXT,
    "tunnelingCm" DOUBLE PRECISION,
    "tunnelingClock" TEXT,
    "stage" TEXT,
    "granulationPct" INTEGER,
    "sloughPct" INTEGER,
    "escharPct" INTEGER,
    "epithelialPct" INTEGER,
    "exudateAmount" TEXT,
    "exudateType" TEXT,
    "periwoundSkin" TEXT,
    "odor" BOOLEAN NOT NULL DEFAULT false,
    "painLevel" INTEGER,
    "pushExudateAmount" TEXT,
    "pushTissueType" TEXT,
    "pushSurfaceAreaScore" INTEGER,
    "pushExudateScore" INTEGER,
    "pushTissueScore" INTEGER,
    "pushTotal" INTEGER,
    "bwatItems" TEXT,
    "bwatTotal" INTEGER,
    "photoUrl" TEXT,
    "notes" TEXT,
    "assessedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WoundAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Debridement" (
    "id" TEXT NOT NULL,
    "woundAssessmentId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "tissueRemoved" TEXT,
    "cptCode" TEXT,
    "chargeId" TEXT,
    "performedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Debridement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibilityCheck" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "payerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "planName" TEXT,
    "copayCents" INTEGER,
    "coinsurancePercent" INTEGER,
    "deductibleRemainingCents" INTEGER,
    "outOfPocketRemainingCents" INTEGER,
    "payerMessage" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "insuranceId" TEXT,
    "checkedById" TEXT,
    "intakeCaseId" TEXT,
    "benefits" TEXT,
    "raw" TEXT,

    CONSTRAINT "EligibilityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VobDecision" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "payerId" TEXT,
    "planSegment" TEXT,
    "planName" TEXT,
    "providerId" TEXT,
    "network" TEXT,
    "decision" TEXT NOT NULL,
    "authRequired" BOOLEAN NOT NULL DEFAULT false,
    "referralRequired" BOOLEAN NOT NULL DEFAULT false,
    "denyReason" TEXT,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'VOB',
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VobDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeCase" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'DATA_ENTRY',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "ownerId" TEXT,
    "holdReason" TEXT,
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referralDate" TIMESTAMP(3),
    "referralSourceType" TEXT,
    "referralSourceName" TEXT,
    "referralContactName" TEXT,
    "referralContactPhone" TEXT,
    "referralContactFax" TEXT,
    "servicesRequested" TEXT,
    "referralNotes" TEXT,
    "dataEntryCompletedAt" TIMESTAMP(3),
    "infoRequestedAt" TIMESTAMP(3),
    "infoRequestedFrom" TEXT,
    "infoRequestNote" TEXT,
    "eligibilityCheckId" TEXT,
    "eligibilityCheckedAt" TIMESTAMP(3),
    "dataVerifiedAt" TIMESTAMP(3),
    "dataVerifiedById" TEXT,
    "consentRequestId" TEXT,
    "consentsSentAt" TIMESTAMP(3),
    "payerId" TEXT,
    "planSegment" TEXT,
    "memberId" TEXT,
    "eligibilityStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "coverageEffectiveDate" TIMESTAMP(3),
    "coverageTermDate" TIMESTAMP(3),
    "copayCents" INTEGER,
    "deductibleCents" INTEGER,
    "deductibleMetCents" INTEGER,
    "coinsurancePercent" INTEGER,
    "outOfPocketRemainingCents" INTEGER,
    "verifiedAt" TIMESTAMP(3),
    "verifiedWith" TEXT,
    "verificationReference" TEXT,
    "benefitsNotes" TEXT,
    "authRequired" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "authStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "authNumber" TEXT,
    "authSubmittedAt" TIMESTAMP(3),
    "authDecisionAt" TIMESTAMP(3),
    "authStartDate" TIMESTAMP(3),
    "authEndDate" TIMESTAMP(3),
    "authVisitsApproved" INTEGER,
    "authNotes" TEXT,
    "referralRequired" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "referralStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "referralNumber" TEXT,
    "pccSentAt" TIMESTAMP(3),
    "pccNotes" TEXT,
    "assignedProviderId" TEXT,
    "networkOverrideNote" TEXT,
    "approvedForServiceAt" TIMESTAMP(3),
    "vobDecision" TEXT,
    "vobDecisionAt" TIMESTAMP(3),
    "vobDecisionById" TEXT,
    "vobDecisionNote" TEXT,
    "vobDenyReason" TEXT,
    "vobDecisionSource" TEXT,
    "consentTreatment" BOOLEAN NOT NULL DEFAULT false,
    "consentHipaa" BOOLEAN NOT NULL DEFAULT false,
    "consentFinancial" BOOLEAN NOT NULL DEFAULT false,
    "consentAssignment" BOOLEAN NOT NULL DEFAULT false,
    "consentsCompletedAt" TIMESTAMP(3),
    "pcpName" TEXT,
    "pcpPhone" TEXT,
    "pcpFax" TEXT,
    "referralAppStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "scheduledAt" TIMESTAMP(3),
    "careStatus" TEXT,
    "providerBrief" TEXT,
    "closedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakeCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeActivity" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "userId" TEXT,
    "stage" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntakeActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncounterSignature" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "signedName" TEXT NOT NULL,
    "attestation" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signatureImage" TEXT,

    CONSTRAINT "EncounterSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncounterEvent" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "userId" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EncounterEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimLine" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "chargeId" TEXT,
    "lineNumber" INTEGER NOT NULL,
    "dosFrom" TIMESTAMP(3) NOT NULL,
    "dosTo" TIMESTAMP(3) NOT NULL,
    "placeOfService" TEXT NOT NULL,
    "emergency" BOOLEAN NOT NULL DEFAULT false,
    "cptCode" TEXT NOT NULL,
    "modifiers" TEXT,
    "pointers" TEXT NOT NULL,
    "units" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "chargeCents" INTEGER NOT NULL,
    "ndcCode" TEXT,
    "ndcQuantity" DOUBLE PRECISION,
    "ndcUnit" TEXT,
    "lineNote" TEXT,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "adjustedCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ClaimLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimDiagnosis" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "icd10" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "ClaimDiagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimEvent" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimDenial" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "deniedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "groupCode" TEXT,
    "code" TEXT,
    "remarks" TEXT,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "reason" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "recoveredCents" INTEGER NOT NULL DEFAULT 0,
    "ownerId" TEXT,
    "followUpAt" TIMESTAMP(3),
    "workNote" TEXT,
    "appealDueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaimDenial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimAppeal" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "denialId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "letterBody" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "filedAt" TIMESTAMP(3),
    "filedVia" TEXT,
    "faxId" TEXT,
    "letterDocumentId" TEXT,
    "payerReference" TEXT,
    "decisionAt" TIMESTAMP(3),
    "recoveredCents" INTEGER NOT NULL DEFAULT 0,
    "outcomeNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaimAppeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeCode" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "feeCents" INTEGER,
    "modifiers" TEXT,
    "favorite" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "specialty" TEXT,
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "section" TEXT NOT NULL DEFAULT 'ADDITIONAL',
    "kind" TEXT NOT NULL DEFAULT 'FORM',
    "builtin" TEXT,
    "perWound" BOOLEAN NOT NULL DEFAULT false,
    "audience" TEXT NOT NULL DEFAULT 'STAFF',
    "fields" TEXT NOT NULL DEFAULT '[]',
    "standard" BOOLEAN NOT NULL DEFAULT false,
    "signatureRequired" BOOLEAN NOT NULL DEFAULT false,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "inProgressNote" BOOLEAN NOT NULL DEFAULT true,
    "noteOrder" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChartWorkflow" (
    "specialty" TEXT,
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visitTypes" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChartWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChartWorkflowStep" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "requiredToFinalize" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ChartWorkflowStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncounterDocument" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "woundKey" TEXT NOT NULL DEFAULT '',
    "data" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "score" INTEGER,
    "templateVersion" INTEGER NOT NULL DEFAULT 1,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "signedById" TEXT,
    "signedName" TEXT,
    "signedAt" TIMESTAMP(3),
    "signatureImage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EncounterDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncounterAttachment" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'SCAN',
    "title" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EncounterAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentationView" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parts" TEXT NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentationView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeSettings" (
    "specialties" TEXT NOT NULL DEFAULT 'WOUND_CARE',
    "id" TEXT NOT NULL,
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
    "bookingRequiresGateway" BOOLEAN NOT NULL DEFAULT false,
    "bookingChecksCredentialing" BOOLEAN NOT NULL DEFAULT false,
    "chartRequiresCheckIn" BOOLEAN NOT NULL DEFAULT false,
    "enforceVobScope" BOOLEAN NOT NULL DEFAULT false,
    "separateDuties" BOOLEAN NOT NULL DEFAULT true,
    "clearinghouse" TEXT NOT NULL DEFAULT 'MOCK',
    "closedThrough" TIMESTAMP(3),
    "documentAiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "faxNumber" TEXT,
    "faxProvider" TEXT NOT NULL DEFAULT 'MOCK',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "eligibilityAuto" BOOLEAN NOT NULL DEFAULT false,
    "referralFollowUpDays" INTEGER NOT NULL DEFAULT 30,
    "smallBalanceCents" INTEGER NOT NULL DEFAULT 500,
    "alertBalanceCents" INTEGER NOT NULL DEFAULT 10000,
    "appealAlertDays" INTEGER NOT NULL DEFAULT 14,

    CONSTRAINT "PracticeSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientDocument" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT,
    "intakeCaseId" TEXT,
    "name" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "docType" TEXT NOT NULL DEFAULT 'OTHER',
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "readMethod" TEXT,
    "pageCount" INTEGER,
    "extractedText" TEXT,
    "extraction" TEXT,
    "error" TEXT,
    "uploadedById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "encounterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitType" (
    "specialty" TEXT,
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationMin" INTEGER,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "textColor" TEXT NOT NULL DEFAULT '#ffffff',
    "bgColor" TEXT NOT NULL DEFAULT '#2f5fa8',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "onlineBooking" BOOLEAN NOT NULL DEFAULT false,
    "woundAnalytics" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "VisitType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulerSettings" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "colorMode" TEXT NOT NULL DEFAULT 'STATUS',
    "statusColors" TEXT NOT NULL DEFAULT '{}',
    "physicianColors" TEXT NOT NULL DEFAULT '{}',
    "previewFields" TEXT NOT NULL DEFAULT '["primaryInsurance","authCount","authRemaining","authStart","authEnd","copay"]',
    "defaultLocationId" TEXT,
    "showWeekends" BOOLEAN NOT NULL DEFAULT false,
    "showPosDropdown" BOOLEAN NOT NULL DEFAULT true,
    "autoCheckIn" BOOLEAN NOT NULL DEFAULT false,
    "autoCheckInMinutes" INTEGER NOT NULL DEFAULT 15,
    "showCapacityView" BOOLEAN NOT NULL DEFAULT true,
    "startTimeMode" TEXT NOT NULL DEFAULT 'FIXED',
    "startTimeFixed" TEXT NOT NULL DEFAULT '07:30',
    "showConflicts" BOOLEAN NOT NULL DEFAULT true,
    "allowCrossSiteConflicts" BOOLEAN NOT NULL DEFAULT false,
    "defaultAuthorizations" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchedulerSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CancellationReason" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CancellationReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarFilterSet" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "locationId" TEXT,
    "providerIds" TEXT,
    "visitTypes" TEXT,
    "view" TEXT NOT NULL DEFAULT 'day',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarFilterSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulerResource" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxUnits" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchedulerResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemMessage" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "activeFrom" TIMESTAMP(3),
    "activeTo" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fax" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "faxNumber" TEXT NOT NULL,
    "recipientName" TEXT,
    "pages" INTEGER,
    "contentType" TEXT,
    "viewId" TEXT,
    "encounterId" TEXT,
    "appointmentId" TEXT,
    "patientId" TEXT,
    "documentId" TEXT,
    "notes" TEXT,
    "error" TEXT,
    "providerRef" TEXT,
    "userId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fax_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakePacket" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "templateKeys" TEXT NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakePacket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeRequest" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT,
    "appointmentId" TEXT,
    "packetId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "channel" TEXT NOT NULL DEFAULT 'LINK',
    "sentTo" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "verifyAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "sessionHash" TEXT,
    "answers" TEXT NOT NULL DEFAULT '{}',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "documentId" TEXT,
    "kioskLinkId" TEXT,
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "ruleId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT,
    "appointmentId" TEXT,
    "requestId" TEXT,
    "channel" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MOCK',
    "error" TEXT,
    "ruleId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "offsetHours" INTEGER NOT NULL DEFAULT 48,
    "channel" TEXT NOT NULL DEFAULT 'BOTH',
    "packetId" TEXT,
    "onlyNewPatients" BOOLEAN NOT NULL DEFAULT false,
    "visitTypes" TEXT,
    "messageTemplate" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyResponse" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "token" TEXT NOT NULL,
    "score" INTEGER,
    "comment" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskLink" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "packetId" TEXT NOT NULL,
    "locationId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KioskLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectSettings" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "displayName" TEXT,
    "brandColor" TEXT NOT NULL DEFAULT '#171342',
    "accentColor" TEXT NOT NULL DEFAULT '#4f9c60',
    "logo" TEXT,
    "welcomeText" TEXT,
    "supportPhone" TEXT,
    "smsProvider" TEXT NOT NULL DEFAULT 'MOCK',
    "emailProvider" TEXT NOT NULL DEFAULT 'MOCK',
    "linkDays" INTEGER NOT NULL DEFAULT 14,
    "languages" TEXT NOT NULL DEFAULT 'en',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "bookingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bookingToken" TEXT,
    "bookingApproval" BOOLEAN NOT NULL DEFAULT true,
    "bookingNewPatients" BOOLEAN NOT NULL DEFAULT true,
    "bookingLeadHours" INTEGER NOT NULL DEFAULT 24,
    "bookingWindowDays" INTEGER NOT NULL DEFAULT 30,
    "bookingMessage" TEXT,
    "paymentsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "paymentProvider" TEXT NOT NULL DEFAULT 'TEST',
    "requireTextConsent" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ConnectSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EraFile" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "payerName" TEXT NOT NULL,
    "payerId" TEXT,
    "payeeName" TEXT,
    "payeeNpi" TEXT,
    "paymentMethod" TEXT NOT NULL,
    "traceNumber" TEXT,
    "paymentDate" TIMESTAMP(3),
    "totalCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IMPORTED',
    "depositId" TEXT,
    "raw" TEXT NOT NULL,
    "importedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "plbCents" INTEGER NOT NULL DEFAULT 0,
    "plbDetail" TEXT NOT NULL DEFAULT '[]',

    CONSTRAINT "EraFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EraClaim" (
    "id" TEXT NOT NULL,
    "eraFileId" TEXT NOT NULL,
    "claimId" TEXT,
    "controlNumber" TEXT NOT NULL,
    "statusCode" TEXT NOT NULL,
    "billedCents" INTEGER NOT NULL,
    "paidCents" INTEGER NOT NULL,
    "patientRespCents" INTEGER NOT NULL DEFAULT 0,
    "payerClaimNumber" TEXT,
    "patientName" TEXT,
    "memberId" TEXT,
    "adjustments" TEXT NOT NULL DEFAULT '[]',
    "lines" TEXT NOT NULL DEFAULT '[]',
    "remarks" TEXT,
    "matchStatus" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "note" TEXT,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "EraClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentEvent" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "room" TEXT,
    "userId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recall" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "providerId" TEXT,
    "locationId" TEXT,
    "visitType" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "appointmentId" TEXT,
    "contactCount" INTEGER NOT NULL DEFAULT 0,
    "lastContactAt" TIMESTAMP(3),
    "lastContactVia" TEXT,
    "notes" TEXT,
    "closedReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareRule" (
    "specialty" TEXT,
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "criteria" TEXT NOT NULL DEFAULT '{}',
    "satisfiedBy" TEXT NOT NULL,
    "intervalDays" INTEGER NOT NULL DEFAULT 365,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'ALERT',
    "source" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "standard" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareRuleOverride" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "until" TIMESTAMP(3),
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareRuleOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateDismissal" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "pairKey" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuplicateDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "prescriberId" TEXT NOT NULL,
    "drug" TEXT NOT NULL,
    "strength" TEXT,
    "form" TEXT,
    "route" TEXT,
    "sig" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "quantityUnit" TEXT,
    "refills" INTEGER NOT NULL DEFAULT 0,
    "daysSupply" INTEGER,
    "dispenseAsWritten" BOOLEAN NOT NULL DEFAULT false,
    "controlled" BOOLEAN NOT NULL DEFAULT false,
    "diagnosisCode" TEXT,
    "pharmacyName" TEXT,
    "pharmacyPhone" TEXT,
    "pharmacyFax" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sentVia" TEXT,
    "sentAt" TIMESTAMP(3),
    "faxId" TEXT,
    "signedAt" TIMESTAMP(3),
    "signedName" TEXT,
    "medicationId" TEXT,
    "allergyOverride" TEXT,
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Immunization" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "vaccine" TEXT NOT NULL,
    "cvxCode" TEXT,
    "administeredAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ADMINISTERED',
    "lotNumber" TEXT,
    "manufacturer" TEXT,
    "expirationDate" TIMESTAMP(3),
    "site" TEXT,
    "route" TEXT,
    "doseMl" DOUBLE PRECISION,
    "administeredById" TEXT,
    "refusalReason" TEXT,
    "visDate" TIMESTAMP(3),
    "notes" TEXT,
    "reportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lotId" TEXT,

    CONSTRAINT "Immunization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LetterTemplate" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "standard" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LetterTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicClosure" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "locationId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'HOLIDAY',
    "allowBooking" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicClosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiClient" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT 'patient/*.read',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientPayment" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "balanceCents" INTEGER NOT NULL,
    "amountCents" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "provider" TEXT NOT NULL DEFAULT 'TEST',
    "providerRef" TEXT,
    "depositId" TEXT,
    "sentVia" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "receiptEmail" TEXT,
    "verifyAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "sessionHash" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderProvider" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "fax" TEXT,
    "accountNumber" TEXT,
    "sendMethod" TEXT NOT NULL DEFAULT 'FAX',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderCatalogItem" (
    "specialty" TEXT,
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "providerId" TEXT,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "specimen" TEXT,
    "fasting" BOOLEAN NOT NULL DEFAULT false,
    "favorite" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "OrderCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalOrder" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "kind" TEXT NOT NULL,
    "providerId" TEXT,
    "orderedById" TEXT NOT NULL,
    "requisition" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "priority" TEXT NOT NULL DEFAULT 'ROUTINE',
    "diagnosisCodes" TEXT,
    "clinicalNotes" TEXT,
    "fasting" BOOLEAN NOT NULL DEFAULT false,
    "collectedAt" TIMESTAMP(3),
    "collectedBy" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "sentVia" TEXT,
    "sentAt" TIMESTAMP(3),
    "faxId" TEXT,
    "signedAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicalOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specimen" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ORDERED',

    CONSTRAINT "ClinicalOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalResult" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "value" TEXT,
    "unit" TEXT,
    "referenceRange" TEXT,
    "flag" TEXT NOT NULL DEFAULT 'NORMAL',
    "reportText" TEXT,
    "documentId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "resultedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,

    CONSTRAINT "ClinicalResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "encounterId" TEXT,
    "depositId" TEXT,
    "number" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "collectedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'GENERAL',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "patientId" TEXT,
    "assignedToId" TEXT,
    "assignedRole" TEXT,
    "createdById" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "dueAt" TIMESTAMP(3),
    "link" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutgoingReferral" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "toProviderId" TEXT,
    "toName" TEXT NOT NULL,
    "toSpecialty" TEXT,
    "toFax" TEXT,
    "toPhone" TEXT,
    "reason" TEXT NOT NULL,
    "diagnosisCodes" TEXT,
    "notes" TEXT,
    "urgency" TEXT NOT NULL DEFAULT 'ROUTINE',
    "authNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sentVia" TEXT,
    "sentAt" TIMESTAMP(3),
    "faxId" TEXT,
    "letterDocumentId" TEXT,
    "appointmentAt" TIMESTAMP(3),
    "consultDocumentId" TEXT,
    "consultReceivedAt" TIMESTAMP(3),
    "followUpDays" INTEGER NOT NULL DEFAULT 30,
    "closedReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutgoingReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "mapping" TEXT NOT NULL DEFAULT '{}',
    "rows" TEXT NOT NULL DEFAULT '[]',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "createdIds" TEXT NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceAuthorization" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "insuranceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ENCOUNTER',
    "reason" TEXT,
    "procedureCode" TEXT,
    "authNumber" TEXT,
    "authorizedCount" INTEGER,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "insuranceContact" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsuranceAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Disclosure" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "disclosedAt" TIMESTAMP(3) NOT NULL,
    "recipient" TEXT NOT NULL,
    "recipientAddress" TEXT,
    "purpose" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "method" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Disclosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmendmentRequest" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "requestText" TEXT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "denialReason" TEXT,
    "patientNotifiedAt" TIMESTAMP(3),
    "disagreement" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmendmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyAccess" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,

    CONSTRAINT "EmergencyAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareTeamMember" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "specialty" TEXT,
    "organization" TEXT,
    "phone" TEXT,
    "fax" TEXT,
    "email" TEXT,
    "userId" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareTeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthConcern" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "concern" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'CLINICAL',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,

    CONSTRAINT "HealthConcern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientGoal" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PROVIDER',
    "concernId" TEXT,
    "interventions" TEXT,
    "targetDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "progressNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImplantableDevice" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "udi" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "lotNumber" TEXT,
    "serialNumber" TEXT,
    "site" TEXT,
    "implantedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "removedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImplantableDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SdohScreening" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "screenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "declined" BOOLEAN NOT NULL DEFAULT false,
    "answers" TEXT NOT NULL DEFAULT '{}',
    "needs" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "screenedById" TEXT,

    CONSTRAINT "SdohScreening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomField" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'TEXT',
    "options" TEXT,
    "helpText" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaccineLot" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "vaccine" TEXT NOT NULL,
    "cvxCode" TEXT,
    "manufacturer" TEXT,
    "lotNumber" TEXT NOT NULL,
    "expirationDate" TIMESTAMP(3),
    "dosesReceived" INTEGER NOT NULL,
    "dosesOnHand" INTEGER NOT NULL,
    "funding" TEXT NOT NULL DEFAULT 'PRIVATE',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "VaccineLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceType" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeSchedule" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "locationIds" TEXT NOT NULL DEFAULT '[]',
    "providerIds" TEXT NOT NULL DEFAULT '[]',
    "payerIds" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChargeSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeScheduleItem" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "allowedCents" INTEGER,
    "revenueCode" TEXT,

    CONSTRAINT "ChargeScheduleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupDocument" (
    "id" TEXT NOT NULL,
    "billingProviderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayerPlan" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "planSegment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REVIEW',
    "source" TEXT NOT NULL DEFAULT 'CREDENTIALING',
    "notes" TEXT,
    "seenCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayerPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayerCatalogEntry" (
    "id" TEXT NOT NULL,
    "clearinghouse" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relatedNames" TEXT,
    "payerClass" TEXT,
    "institutionalId" TEXT,
    "eraId" TEXT,
    "eligibilityId" TEXT,
    "standardId" TEXT,
    "enrollmentNote" TEXT,
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
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayerCatalogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasterCode" (
    "id" TEXT NOT NULL,
    "codeSet" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "shortDescription" TEXT,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "edition" TEXT,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MasterCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientMessage" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorRole" TEXT,
    "toTeam" TEXT,
    "body" TEXT NOT NULL,
    "needsReply" BOOLEAN NOT NULL DEFAULT false,
    "answeredAt" TIMESTAMP(3),
    "answeredById" TEXT,
    "replyToId" TEXT,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WoundProduct" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "productType" TEXT NOT NULL DEFAULT 'PRIMARY',
    "hcpcsCode" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'each',
    "size" TEXT,
    "instructions" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "standard" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WoundProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreatmentStep" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productTypes" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "standard" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "TreatmentStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WoundTreatment" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "woundId" TEXT NOT NULL,
    "performedById" TEXT,
    "notes" TEXT,
    "billedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WoundTreatment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WoundTreatmentLine" (
    "id" TEXT NOT NULL,
    "treatmentId" TEXT NOT NULL,
    "stepId" TEXT,
    "stepName" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'each',
    "instructions" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WoundTreatmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientAlert" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'WARNING',
    "message" TEXT NOT NULL,
    "showOn" TEXT NOT NULL,
    "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeTo" TIMESTAMP(3),
    "assignedToId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolveComment" TEXT,

    CONSTRAINT "PatientAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertAcknowledgement" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "placement" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Practice_slug_key" ON "Practice"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_practiceId_key" ON "Membership"("userId", "practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_practiceId_mrn_key" ON "Patient"("practiceId", "mrn");

-- CreateIndex
CREATE UNIQUE INDEX "GroupPayerEnrollment_billingProviderId_payerId_planSegment_key" ON "GroupPayerEnrollment"("billingProviderId", "payerId", "planSegment");

-- CreateIndex
CREATE UNIQUE INDEX "RenderingProvider_userId_key" ON "RenderingProvider"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEnrollment_renderingProviderId_groupPayerEnrollment_key" ON "ProviderEnrollment"("renderingProviderId", "groupPayerEnrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_confirmToken_key" ON "Appointment"("confirmToken");

-- CreateIndex
CREATE UNIQUE INDEX "Encounter_appointmentId_key" ON "Encounter"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Vitals_encounterId_key" ON "Vitals"("encounterId");

-- CreateIndex
CREATE UNIQUE INDEX "LabResult_labOrderId_key" ON "LabResult"("labOrderId");

-- CreateIndex
CREATE INDEX "Claim_practiceId_status_idx" ON "Claim"("practiceId", "status");

-- CreateIndex
CREATE INDEX "Claim_encounterId_idx" ON "Claim"("encounterId");

-- CreateIndex
CREATE UNIQUE INDEX "Debridement_woundAssessmentId_key" ON "Debridement"("woundAssessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Debridement_chargeId_key" ON "Debridement"("chargeId");

-- CreateIndex
CREATE INDEX "VobDecision_practiceId_payerId_planSegment_idx" ON "VobDecision"("practiceId", "payerId", "planSegment");

-- CreateIndex
CREATE INDEX "IntakeCase_practiceId_stage_idx" ON "IntakeCase"("practiceId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "EncounterSignature_encounterId_role_key" ON "EncounterSignature"("encounterId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimDiagnosis_claimId_sequence_key" ON "ClaimDiagnosis"("claimId", "sequence");

-- CreateIndex
CREATE INDEX "ClaimDenial_practiceId_status_idx" ON "ClaimDenial"("practiceId", "status");

-- CreateIndex
CREATE INDEX "ClaimDenial_claimId_idx" ON "ClaimDenial"("claimId");

-- CreateIndex
CREATE INDEX "ClaimAppeal_practiceId_status_idx" ON "ClaimAppeal"("practiceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeCode_practiceId_type_code_key" ON "PracticeCode"("practiceId", "type", "code");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTemplate_practiceId_key_key" ON "DocumentTemplate"("practiceId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ChartWorkflowStep_workflowId_templateId_key" ON "ChartWorkflowStep"("workflowId", "templateId");

-- CreateIndex
CREATE UNIQUE INDEX "EncounterDocument_encounterId_templateId_woundKey_key" ON "EncounterDocument"("encounterId", "templateId", "woundKey");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeSettings_practiceId_key" ON "PracticeSettings"("practiceId");

-- CreateIndex
CREATE INDEX "PatientDocument_practiceId_status_idx" ON "PatientDocument"("practiceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VisitType_practiceId_code_key" ON "VisitType"("practiceId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulerSettings_practiceId_key" ON "SchedulerSettings"("practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CancellationReason_practiceId_name_key" ON "CancellationReason"("practiceId", "name");

-- CreateIndex
CREATE INDEX "Fax_practiceId_direction_createdAt_idx" ON "Fax"("practiceId", "direction", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeRequest_token_key" ON "IntakeRequest"("token");

-- CreateIndex
CREATE INDEX "IntakeRequest_practiceId_status_idx" ON "IntakeRequest"("practiceId", "status");

-- CreateIndex
CREATE INDEX "MessageLog_practiceId_createdAt_idx" ON "MessageLog"("practiceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyResponse_token_key" ON "SurveyResponse"("token");

-- CreateIndex
CREATE UNIQUE INDEX "KioskLink_token_key" ON "KioskLink"("token");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectSettings_practiceId_key" ON "ConnectSettings"("practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectSettings_bookingToken_key" ON "ConnectSettings"("bookingToken");

-- CreateIndex
CREATE INDEX "EraFile_practiceId_createdAt_idx" ON "EraFile"("practiceId", "createdAt");

-- CreateIndex
CREATE INDEX "AppointmentEvent_appointmentId_at_idx" ON "AppointmentEvent"("appointmentId", "at");

-- CreateIndex
CREATE INDEX "Recall_practiceId_status_dueDate_idx" ON "Recall"("practiceId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "CareRule_practiceId_key_key" ON "CareRule"("practiceId", "key");

-- CreateIndex
CREATE INDEX "CareRuleOverride_patientId_ruleId_idx" ON "CareRuleOverride"("patientId", "ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "DuplicateDismissal_practiceId_pairKey_key" ON "DuplicateDismissal"("practiceId", "pairKey");

-- CreateIndex
CREATE INDEX "Prescription_practiceId_patientId_idx" ON "Prescription"("practiceId", "patientId");

-- CreateIndex
CREATE INDEX "Immunization_practiceId_administeredAt_idx" ON "Immunization"("practiceId", "administeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "LetterTemplate_practiceId_key_key" ON "LetterTemplate"("practiceId", "key");

-- CreateIndex
CREATE INDEX "ClinicClosure_practiceId_date_idx" ON "ClinicClosure"("practiceId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ApiClient_tokenHash_key" ON "ApiClient"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "PatientPayment_token_key" ON "PatientPayment"("token");

-- CreateIndex
CREATE INDEX "PatientPayment_practiceId_status_idx" ON "PatientPayment"("practiceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalOrder_requisition_key" ON "ClinicalOrder"("requisition");

-- CreateIndex
CREATE INDEX "ClinicalOrder_practiceId_status_idx" ON "ClinicalOrder"("practiceId", "status");

-- CreateIndex
CREATE INDEX "Receipt_practiceId_createdAt_idx" ON "Receipt"("practiceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_practiceId_number_key" ON "Receipt"("practiceId", "number");

-- CreateIndex
CREATE INDEX "Task_practiceId_status_assignedToId_idx" ON "Task"("practiceId", "status", "assignedToId");

-- CreateIndex
CREATE INDEX "OutgoingReferral_practiceId_status_idx" ON "OutgoingReferral"("practiceId", "status");

-- CreateIndex
CREATE INDEX "InsuranceAuthorization_patientId_idx" ON "InsuranceAuthorization"("patientId");

-- CreateIndex
CREATE INDEX "Disclosure_practiceId_disclosedAt_idx" ON "Disclosure"("practiceId", "disclosedAt");

-- CreateIndex
CREATE INDEX "Disclosure_patientId_idx" ON "Disclosure"("patientId");

-- CreateIndex
CREATE INDEX "AmendmentRequest_practiceId_status_idx" ON "AmendmentRequest"("practiceId", "status");

-- CreateIndex
CREATE INDEX "AmendmentRequest_patientId_idx" ON "AmendmentRequest"("patientId");

-- CreateIndex
CREATE INDEX "EmergencyAccess_practiceId_grantedAt_idx" ON "EmergencyAccess"("practiceId", "grantedAt");

-- CreateIndex
CREATE INDEX "EmergencyAccess_patientId_userId_idx" ON "EmergencyAccess"("patientId", "userId");

-- CreateIndex
CREATE INDEX "CareTeamMember_patientId_idx" ON "CareTeamMember"("patientId");

-- CreateIndex
CREATE INDEX "HealthConcern_patientId_idx" ON "HealthConcern"("patientId");

-- CreateIndex
CREATE INDEX "PatientGoal_patientId_idx" ON "PatientGoal"("patientId");

-- CreateIndex
CREATE INDEX "ImplantableDevice_patientId_idx" ON "ImplantableDevice"("patientId");

-- CreateIndex
CREATE INDEX "SdohScreening_patientId_screenedAt_idx" ON "SdohScreening"("patientId", "screenedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomField_practiceId_key_key" ON "CustomField"("practiceId", "key");

-- CreateIndex
CREATE INDEX "VaccineLot_practiceId_active_idx" ON "VaccineLot"("practiceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceType_practiceId_name_key" ON "ServiceType"("practiceId", "name");

-- CreateIndex
CREATE INDEX "ChargeSchedule_practiceId_active_idx" ON "ChargeSchedule"("practiceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeScheduleItem_scheduleId_code_key" ON "ChargeScheduleItem"("scheduleId", "code");

-- CreateIndex
CREATE INDEX "GroupDocument_billingProviderId_idx" ON "GroupDocument"("billingProviderId");

-- CreateIndex
CREATE INDEX "PayerPlan_practiceId_status_idx" ON "PayerPlan"("practiceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayerPlan_payerId_nameKey_key" ON "PayerPlan"("payerId", "nameKey");

-- CreateIndex
CREATE INDEX "PayerCatalogEntry_clearinghouse_payerId_idx" ON "PayerCatalogEntry"("clearinghouse", "payerId");

-- CreateIndex
CREATE INDEX "PayerCatalogEntry_clearinghouse_name_idx" ON "PayerCatalogEntry"("clearinghouse", "name");

-- CreateIndex
CREATE INDEX "MasterCode_codeSet_billable_idx" ON "MasterCode"("codeSet", "billable");

-- CreateIndex
CREATE UNIQUE INDEX "MasterCode_codeSet_code_key" ON "MasterCode"("codeSet", "code");

-- CreateIndex
CREATE INDEX "PatientMessage_practiceId_patientId_createdAt_idx" ON "PatientMessage"("practiceId", "patientId", "createdAt");

-- CreateIndex
CREATE INDEX "PatientMessage_practiceId_toTeam_needsReply_answeredAt_idx" ON "PatientMessage"("practiceId", "toTeam", "needsReply", "answeredAt");

-- CreateIndex
CREATE INDEX "WoundProduct_practiceId_productType_idx" ON "WoundProduct"("practiceId", "productType");

-- CreateIndex
CREATE UNIQUE INDEX "WoundTreatment_encounterId_woundId_key" ON "WoundTreatment"("encounterId", "woundId");

-- CreateIndex
CREATE INDEX "PatientAlert_practiceId_patientId_status_idx" ON "PatientAlert"("practiceId", "patientId", "status");

-- CreateIndex
CREATE INDEX "AlertAcknowledgement_alertId_userId_createdAt_idx" ON "AlertAcknowledgement"("alertId", "userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Practice" ADD CONSTRAINT "Practice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAvailability" ADD CONSTRAINT "ProviderAvailability_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAvailability" ADD CONSTRAINT "ProviderAvailability_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAvailability" ADD CONSTRAINT "ProviderAvailability_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservedTime" ADD CONSTRAINT "ReservedTime_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservedTime" ADD CONSTRAINT "ReservedTime_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservedTime" ADD CONSTRAINT "ReservedTime_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_activePracticeId_fkey" FOREIGN KEY ("activePracticeId") REFERENCES "Practice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_referringPhysicianId_fkey" FOREIGN KEY ("referringPhysicianId") REFERENCES "RenderingProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_guarantorPatientId_fkey" FOREIGN KEY ("guarantorPatientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insurance" ADD CONSTRAINT "Insurance_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insurance" ADD CONSTRAINT "Insurance_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payer" ADD CONSTRAINT "Payer_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payer" ADD CONSTRAINT "Payer_parentPayerId_fkey" FOREIGN KEY ("parentPayerId") REFERENCES "Payer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payer" ADD CONSTRAINT "Payer_alternatePayerId_fkey" FOREIGN KEY ("alternatePayerId") REFERENCES "Payer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingProvider" ADD CONSTRAINT "BillingProvider_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupPayerEnrollment" ADD CONSTRAINT "GroupPayerEnrollment_billingProviderId_fkey" FOREIGN KEY ("billingProviderId") REFERENCES "BillingProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupPayerEnrollment" ADD CONSTRAINT "GroupPayerEnrollment_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderingProvider" ADD CONSTRAINT "RenderingProvider_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderingProvider" ADD CONSTRAINT "RenderingProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderingProvider" ADD CONSTRAINT "RenderingProvider_supervisingProviderId_fkey" FOREIGN KEY ("supervisingProviderId") REFERENCES "RenderingProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderEnrollment" ADD CONSTRAINT "ProviderEnrollment_renderingProviderId_fkey" FOREIGN KEY ("renderingProviderId") REFERENCES "RenderingProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderEnrollment" ADD CONSTRAINT "ProviderEnrollment_groupPayerEnrollmentId_fkey" FOREIGN KEY ("groupPayerEnrollmentId") REFERENCES "GroupPayerEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderEnrollment" ADD CONSTRAINT "ProviderEnrollment_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentActivity" ADD CONSTRAINT "EnrollmentActivity_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "ProviderEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentActivity" ADD CONSTRAINT "EnrollmentActivity_loggedById_fkey" FOREIGN KEY ("loggedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderDocument" ADD CONSTRAINT "ProviderDocument_renderingProviderId_fkey" FOREIGN KEY ("renderingProviderId") REFERENCES "RenderingProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderDocument" ADD CONSTRAINT "ProviderDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimarySourceCheck" ADD CONSTRAINT "PrimarySourceCheck_renderingProviderId_fkey" FOREIGN KEY ("renderingProviderId") REFERENCES "RenderingProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimarySourceCheck" ADD CONSTRAINT "PrimarySourceCheck_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allergy" ADD CONSTRAINT "Allergy_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_prescriberId_fkey" FOREIGN KEY ("prescriberId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clinicalStaffId_fkey" FOREIGN KEY ("clinicalStaffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_supervisingProviderId_fkey" FOREIGN KEY ("supervisingProviderId") REFERENCES "RenderingProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_intakeCaseId_fkey" FOREIGN KEY ("intakeCaseId") REFERENCES "IntakeCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_collaboratingProviderId_fkey" FOREIGN KEY ("collaboratingProviderId") REFERENCES "RenderingProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "SchedulerResource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_billingProviderId_fkey" FOREIGN KEY ("billingProviderId") REFERENCES "BillingProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_clinicalStaffId_fkey" FOREIGN KEY ("clinicalStaffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_supervisingProviderId_fkey" FOREIGN KEY ("supervisingProviderId") REFERENCES "RenderingProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_codedById_fkey" FOREIGN KEY ("codedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "ChartWorkflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncounterDiagnosis" ADD CONSTRAINT "EncounterDiagnosis_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vitals" ADD CONSTRAINT "Vitals_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_orderedById_fkey" FOREIGN KEY ("orderedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_labOrderId_fkey" FOREIGN KEY ("labOrderId") REFERENCES "LabOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_insuranceId_fkey" FOREIGN KEY ("insuranceId") REFERENCES "Insurance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_billingProviderId_fkey" FOREIGN KEY ("billingProviderId") REFERENCES "BillingProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_renderingProviderId_fkey" FOREIGN KEY ("renderingProviderId") REFERENCES "RenderingProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_referringProviderId_fkey" FOREIGN KEY ("referringProviderId") REFERENCES "RenderingProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_supervisingProviderId_fkey" FOREIGN KEY ("supervisingProviderId") REFERENCES "RenderingProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_orderingProviderId_fkey" FOREIGN KEY ("orderingProviderId") REFERENCES "RenderingProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_serviceLocationId_fkey" FOREIGN KEY ("serviceLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuperbillTemplate" ADD CONSTRAINT "SuperbillTemplate_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuperbillTemplateItem" ADD CONSTRAINT "SuperbillTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "SuperbillTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Statement" ADD CONSTRAINT "Statement_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Statement" ADD CONSTRAINT "Statement_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementLine" ADD CONSTRAINT "StatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "Statement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementLine" ADD CONSTRAINT "StatementLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentApplication" ADD CONSTRAINT "PaymentApplication_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "Deposit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentApplication" ADD CONSTRAINT "PaymentApplication_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wound" ADD CONSTRAINT "Wound_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wound" ADD CONSTRAINT "Wound_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WoundAssessment" ADD CONSTRAINT "WoundAssessment_woundId_fkey" FOREIGN KEY ("woundId") REFERENCES "Wound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WoundAssessment" ADD CONSTRAINT "WoundAssessment_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WoundAssessment" ADD CONSTRAINT "WoundAssessment_assessedById_fkey" FOREIGN KEY ("assessedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debridement" ADD CONSTRAINT "Debridement_woundAssessmentId_fkey" FOREIGN KEY ("woundAssessmentId") REFERENCES "WoundAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debridement" ADD CONSTRAINT "Debridement_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debridement" ADD CONSTRAINT "Debridement_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityCheck" ADD CONSTRAINT "EligibilityCheck_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityCheck" ADD CONSTRAINT "EligibilityCheck_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityCheck" ADD CONSTRAINT "EligibilityCheck_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityCheck" ADD CONSTRAINT "EligibilityCheck_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VobDecision" ADD CONSTRAINT "VobDecision_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VobDecision" ADD CONSTRAINT "VobDecision_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "IntakeCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeCase" ADD CONSTRAINT "IntakeCase_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeCase" ADD CONSTRAINT "IntakeCase_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeCase" ADD CONSTRAINT "IntakeCase_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeCase" ADD CONSTRAINT "IntakeCase_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeCase" ADD CONSTRAINT "IntakeCase_assignedProviderId_fkey" FOREIGN KEY ("assignedProviderId") REFERENCES "RenderingProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeActivity" ADD CONSTRAINT "IntakeActivity_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "IntakeCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeActivity" ADD CONSTRAINT "IntakeActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncounterSignature" ADD CONSTRAINT "EncounterSignature_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncounterSignature" ADD CONSTRAINT "EncounterSignature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncounterEvent" ADD CONSTRAINT "EncounterEvent_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncounterEvent" ADD CONSTRAINT "EncounterEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimLine" ADD CONSTRAINT "ClaimLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimLine" ADD CONSTRAINT "ClaimLine_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimDiagnosis" ADD CONSTRAINT "ClaimDiagnosis_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvent" ADD CONSTRAINT "ClaimEvent_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvent" ADD CONSTRAINT "ClaimEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimDenial" ADD CONSTRAINT "ClaimDenial_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimDenial" ADD CONSTRAINT "ClaimDenial_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimAppeal" ADD CONSTRAINT "ClaimAppeal_denialId_fkey" FOREIGN KEY ("denialId") REFERENCES "ClaimDenial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeCode" ADD CONSTRAINT "PracticeCode_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChartWorkflow" ADD CONSTRAINT "ChartWorkflow_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChartWorkflowStep" ADD CONSTRAINT "ChartWorkflowStep_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "ChartWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChartWorkflowStep" ADD CONSTRAINT "ChartWorkflowStep_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncounterDocument" ADD CONSTRAINT "EncounterDocument_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncounterDocument" ADD CONSTRAINT "EncounterDocument_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncounterDocument" ADD CONSTRAINT "EncounterDocument_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncounterDocument" ADD CONSTRAINT "EncounterDocument_signedById_fkey" FOREIGN KEY ("signedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncounterAttachment" ADD CONSTRAINT "EncounterAttachment_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncounterAttachment" ADD CONSTRAINT "EncounterAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentationView" ADD CONSTRAINT "DocumentationView_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeSettings" ADD CONSTRAINT "PracticeSettings_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDocument" ADD CONSTRAINT "PatientDocument_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDocument" ADD CONSTRAINT "PatientDocument_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDocument" ADD CONSTRAINT "PatientDocument_intakeCaseId_fkey" FOREIGN KEY ("intakeCaseId") REFERENCES "IntakeCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDocument" ADD CONSTRAINT "PatientDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDocument" ADD CONSTRAINT "PatientDocument_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitType" ADD CONSTRAINT "VisitType_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulerSettings" ADD CONSTRAINT "SchedulerSettings_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationReason" ADD CONSTRAINT "CancellationReason_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarFilterSet" ADD CONSTRAINT "CalendarFilterSet_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulerResource" ADD CONSTRAINT "SchedulerResource_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulerResource" ADD CONSTRAINT "SchedulerResource_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemMessage" ADD CONSTRAINT "SystemMessage_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fax" ADD CONSTRAINT "Fax_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fax" ADD CONSTRAINT "Fax_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakePacket" ADD CONSTRAINT "IntakePacket_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeRequest" ADD CONSTRAINT "IntakeRequest_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeRequest" ADD CONSTRAINT "IntakeRequest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeRequest" ADD CONSTRAINT "IntakeRequest_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeRequest" ADD CONSTRAINT "IntakeRequest_packetId_fkey" FOREIGN KEY ("packetId") REFERENCES "IntakePacket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_packetId_fkey" FOREIGN KEY ("packetId") REFERENCES "IntakePacket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskLink" ADD CONSTRAINT "KioskLink_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskLink" ADD CONSTRAINT "KioskLink_packetId_fkey" FOREIGN KEY ("packetId") REFERENCES "IntakePacket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectSettings" ADD CONSTRAINT "ConnectSettings_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraFile" ADD CONSTRAINT "EraFile_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraClaim" ADD CONSTRAINT "EraClaim_eraFileId_fkey" FOREIGN KEY ("eraFileId") REFERENCES "EraFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentEvent" ADD CONSTRAINT "AppointmentEvent_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recall" ADD CONSTRAINT "Recall_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recall" ADD CONSTRAINT "Recall_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recall" ADD CONSTRAINT "Recall_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareRule" ADD CONSTRAINT "CareRule_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareRuleOverride" ADD CONSTRAINT "CareRuleOverride_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CareRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareRuleOverride" ADD CONSTRAINT "CareRuleOverride_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateDismissal" ADD CONSTRAINT "DuplicateDismissal_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Immunization" ADD CONSTRAINT "Immunization_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Immunization" ADD CONSTRAINT "Immunization_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Immunization" ADD CONSTRAINT "Immunization_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "VaccineLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LetterTemplate" ADD CONSTRAINT "LetterTemplate_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicClosure" ADD CONSTRAINT "ClinicClosure_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiClient" ADD CONSTRAINT "ApiClient_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientPayment" ADD CONSTRAINT "PatientPayment_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientPayment" ADD CONSTRAINT "PatientPayment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderProvider" ADD CONSTRAINT "OrderProvider_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCatalogItem" ADD CONSTRAINT "OrderCatalogItem_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCatalogItem" ADD CONSTRAINT "OrderCatalogItem_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "OrderProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "OrderProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalOrderItem" ADD CONSTRAINT "ClinicalOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ClinicalOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalResult" ADD CONSTRAINT "ClinicalResult_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ClinicalOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutgoingReferral" ADD CONSTRAINT "OutgoingReferral_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutgoingReferral" ADD CONSTRAINT "OutgoingReferral_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceAuthorization" ADD CONSTRAINT "InsuranceAuthorization_insuranceId_fkey" FOREIGN KEY ("insuranceId") REFERENCES "Insurance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Disclosure" ADD CONSTRAINT "Disclosure_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Disclosure" ADD CONSTRAINT "Disclosure_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmendmentRequest" ADD CONSTRAINT "AmendmentRequest_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmendmentRequest" ADD CONSTRAINT "AmendmentRequest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyAccess" ADD CONSTRAINT "EmergencyAccess_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyAccess" ADD CONSTRAINT "EmergencyAccess_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareTeamMember" ADD CONSTRAINT "CareTeamMember_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareTeamMember" ADD CONSTRAINT "CareTeamMember_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthConcern" ADD CONSTRAINT "HealthConcern_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthConcern" ADD CONSTRAINT "HealthConcern_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientGoal" ADD CONSTRAINT "PatientGoal_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientGoal" ADD CONSTRAINT "PatientGoal_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientGoal" ADD CONSTRAINT "PatientGoal_concernId_fkey" FOREIGN KEY ("concernId") REFERENCES "HealthConcern"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImplantableDevice" ADD CONSTRAINT "ImplantableDevice_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImplantableDevice" ADD CONSTRAINT "ImplantableDevice_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SdohScreening" ADD CONSTRAINT "SdohScreening_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SdohScreening" ADD CONSTRAINT "SdohScreening_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaccineLot" ADD CONSTRAINT "VaccineLot_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceType" ADD CONSTRAINT "ServiceType_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeSchedule" ADD CONSTRAINT "ChargeSchedule_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeScheduleItem" ADD CONSTRAINT "ChargeScheduleItem_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ChargeSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupDocument" ADD CONSTRAINT "GroupDocument_billingProviderId_fkey" FOREIGN KEY ("billingProviderId") REFERENCES "BillingProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayerPlan" ADD CONSTRAINT "PayerPlan_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayerPlan" ADD CONSTRAINT "PayerPlan_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientMessage" ADD CONSTRAINT "PatientMessage_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientMessage" ADD CONSTRAINT "PatientMessage_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WoundProduct" ADD CONSTRAINT "WoundProduct_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentStep" ADD CONSTRAINT "TreatmentStep_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WoundTreatment" ADD CONSTRAINT "WoundTreatment_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WoundTreatment" ADD CONSTRAINT "WoundTreatment_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WoundTreatment" ADD CONSTRAINT "WoundTreatment_woundId_fkey" FOREIGN KEY ("woundId") REFERENCES "Wound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WoundTreatment" ADD CONSTRAINT "WoundTreatment_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WoundTreatmentLine" ADD CONSTRAINT "WoundTreatmentLine_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "WoundTreatment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WoundTreatmentLine" ADD CONSTRAINT "WoundTreatmentLine_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "TreatmentStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WoundTreatmentLine" ADD CONSTRAINT "WoundTreatmentLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "WoundProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAlert" ADD CONSTRAINT "PatientAlert_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAlert" ADD CONSTRAINT "PatientAlert_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAlert" ADD CONSTRAINT "PatientAlert_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAlert" ADD CONSTRAINT "PatientAlert_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAlert" ADD CONSTRAINT "PatientAlert_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertAcknowledgement" ADD CONSTRAINT "AlertAcknowledgement_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "PatientAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertAcknowledgement" ADD CONSTRAINT "AlertAcknowledgement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

