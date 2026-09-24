export interface EligibilityRequest {
  patientId: string;
  payerId: string;
  payerCode: string | null;
  memberId: string;
  providerNpi: string | null;
  serviceDate: Date;
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
}

export interface ClaimSubmissionRequest {
  claimId: string;
  payerId: string;
  payerCode: string | null;
  billedCents: number;
  cptCode: string;
  diagnosisCodes: string[];
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
