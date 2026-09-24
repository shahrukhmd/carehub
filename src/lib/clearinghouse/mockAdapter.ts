import type {
  ClaimSubmissionRequest,
  ClaimSubmissionResult,
  ClearinghouseAdapter,
  EligibilityRequest,
  EligibilityResult,
} from "./types";

// Deterministic pseudo-random from a string, so the same member/claim tends to
// behave consistently across repeated checks in a demo.
function seededFraction(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 1000) / 1000;
}

const REJECTION_REASONS = [
  "Missing or invalid referring provider NPI",
  "Diagnosis pointer does not match a valid diagnosis code",
  "Prior authorization required for this procedure",
  "Subscriber not found for this payer ID",
  "Invalid or missing rendering provider taxonomy code",
];

// Simulated clearinghouse — stands in for a real EDI connection (270/271
// eligibility, 837 claim submission). Swap `getClearinghouseAdapter()` in
// index.ts for a real integration without touching any calling code.
export const mockClearinghouseAdapter: ClearinghouseAdapter = {
  name: "Simulated Clearinghouse (demo)",

  async checkEligibility(req: EligibilityRequest): Promise<EligibilityResult> {
    await new Promise((r) => setTimeout(r, 150));

    const f = seededFraction(`${req.payerId}:${req.memberId}`);

    if (!req.payerCode) {
      return {
        status: "ERROR",
        payerMessage: "No payer code on file — cannot route eligibility request.",
      };
    }

    if (f < 0.08) {
      return { status: "ERROR", payerMessage: "Clearinghouse timeout. Try again." };
    }
    if (f < 0.18) {
      return {
        status: "INACTIVE",
        payerMessage: "Coverage terminated as of last month.",
      };
    }
    if (f < 0.25) {
      return { status: "UNKNOWN", payerMessage: "Payer did not return a definitive response." };
    }

    return {
      status: "ACTIVE",
      planName: ["PPO Gold", "HMO Standard", "Medicare Part B", "PPO Family", "EPO Select"][
        Math.floor(f * 5)
      ],
      copayCents: Math.round(20 + f * 30) * 100,
      coinsurancePercent: Math.round(10 + f * 20),
      deductibleRemainingCents: Math.round(f * 2000) * 100,
      outOfPocketRemainingCents: Math.round(f * 5000) * 100,
      raw: `271 response simulated for payer ${req.payerCode}, member ${req.memberId}`,
    };
  },

  async submitClaim(req: ClaimSubmissionRequest): Promise<ClaimSubmissionResult> {
    await new Promise((r) => setTimeout(r, 200));

    if (!req.payerCode) {
      return { status: "ERROR", rejectionReason: "No payer code on file for EDI routing." };
    }

    const f = seededFraction(`${req.claimId}:${req.cptCode}`);

    if (f < 0.1) {
      return { status: "ERROR", rejectionReason: "Clearinghouse connection error. Retry submission." };
    }
    if (f < 0.25) {
      return {
        status: "REJECTED",
        rejectionReason: REJECTION_REASONS[Math.floor(f * 100) % REJECTION_REASONS.length],
      };
    }

    return {
      status: "ACCEPTED",
      clearinghouseClaimId: `CH-${req.claimId.slice(-8).toUpperCase()}`,
      raw: `837 accepted for payer ${req.payerCode}, ${req.cptCode} $${(req.billedCents / 100).toFixed(2)}`,
    };
  },
};
