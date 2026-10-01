export interface EligibilityRequest {
  patientId: string;
  payerId: string;
  payerCode: string | null;
  memberId: string;
  providerNpi: string | null;
  serviceDate: Date;
  // Sent on the 270 so the payer can match the member.
  subscriber?: { firstName: string; lastName: string; dob: Date | null; sex?: string | null };
  groupNumber?: string | null;
}

// One service-type line of a 271 (EB segment), reduced to what intake needs.
export interface ServiceBenefit {
  code: string;
  label: string;
  covered: boolean;
  copayCents?: number;
  coinsurancePercent?: number;
  authRequired?: boolean;
  limit?: string;
  note?: string;
}

// The payer's full answer. Dates are ISO yyyy-mm-dd; a field the payer didn't return is left out.
export interface EligibilityBenefits {
  subscriber?: {
    firstName?: string;
    lastName?: string;
    dob?: string;
    sex?: string;
    memberId?: string;
    addressLine1?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  plan?: {
    name?: string;
    // HMO | PPO | EPO | POS | Medicare ...
    type?: string;
    // CareHub plan segment (see planSegmentLabel) when the payer's insurance type maps to one.
    segment?: string;
    groupNumber?: string;
    groupName?: string;
    effectiveDate?: string;
    terminationDate?: string;
  };
  pcp?: { name?: string; phone?: string };
  deductible?: { totalCents?: number; metCents?: number; remainingCents?: number };
  outOfPocket?: { maxCents?: number; metCents?: number; remainingCents?: number };
  referralRequired?: boolean;
  otherInsurance?: string;
  services?: ServiceBenefit[];
  messages?: string[];
}

export interface EligibilityResult {
  status: "ACTIVE" | "INACTIVE" | "UNKNOWN" | "ERROR";
  planName?: string;
  copayCents?: number;
  coinsurancePercent?: number;
  deductibleRemainingCents?: number;
  outOfPocketRemainingCents?: number;
  payerMessage?: string;
  raw?: string;
  benefits?: EligibilityBenefits;
}

export interface ClaimSubmissionRequest {
  claimId: string;
  payerId: string;
  payerCode: string | null;
  billedCents: number;
  frequencyCode: string;
  diagnosisCodes: string[];
  lines: { cptCode: string; chargeCents: number; units: number; pointers: string }[];
}

export interface ClaimSubmissionResult {
  status: "ACCEPTED" | "REJECTED" | "ERROR";
  clearinghouseClaimId?: string;
  rejectionReason?: string;
  raw?: string;
}

export interface ClearinghouseAdapter {
  name: string;
  checkEligibility(req: EligibilityRequest): Promise<EligibilityResult>;
  submitClaim(req: ClaimSubmissionRequest): Promise<ClaimSubmissionResult>;
}
