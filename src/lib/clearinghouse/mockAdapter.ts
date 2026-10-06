import type {
  ClaimSubmissionRequest,
  ClaimSubmissionResult,
  ClearinghouseAdapter,
  EligibilityBenefits,
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

const PLANS = [
  { name: "PPO Gold", type: "PPO", segment: "COMMERCIAL", deductibleCents: 50000, oopMaxCents: 300000 },
  { name: "HMO Standard", type: "HMO", segment: "COMMERCIAL", deductibleCents: 150000, oopMaxCents: 500000 },
  { name: "Medicare Part B", type: "Medicare", segment: "MEDICARE", deductibleCents: 25700, oopMaxCents: 0 },
  { name: "PPO Family", type: "PPO", segment: "COMMERCIAL", deductibleCents: 300000, oopMaxCents: 700000 },
  { name: "EPO Select", type: "EPO", segment: "COMMERCIAL", deductibleCents: 200000, oopMaxCents: 600000 },
];

const PCPS = ["Dr. Samuel Ortega", "Dr. Priya Nair", "Dr. Helen Brooks"];

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

    const plan = PLANS[Math.floor(f * PLANS.length)];
    const copayCents = Math.round(20 + f * 30) * 100;
    const coinsurancePercent = Math.round(10 + f * 20);
    const deductibleRemainingCents = Math.round(f * 2000) * 100;
    const outOfPocketRemainingCents = Math.round(f * 5000) * 100;
    const deductibleTotal = Math.max(plan.deductibleCents, deductibleRemainingCents);
    const oopMax = Math.max(plan.oopMaxCents, outOfPocketRemainingCents);
    const year = req.serviceDate.getFullYear();
    const groupNumber = req.groupNumber || `G${String(Math.round(f * 899999) + 100000)}`;
    const isHmo = plan.type === "HMO";
    const dob = req.subscriber?.dob ? req.subscriber.dob.toISOString().slice(0, 10) : undefined;

    const benefits: EligibilityBenefits = {
      subscriber: {
        firstName: req.subscriber?.firstName.toUpperCase(),
        lastName: req.subscriber?.lastName.toUpperCase(),
        dob,
        sex: req.subscriber?.sex ?? undefined,
        memberId: req.memberId,
      },
      plan: {
        name: plan.name,
        type: plan.type,
        segment: plan.segment,
        groupNumber,
        groupName: plan.segment === "MEDICARE" ? undefined : `${plan.name} Group ${groupNumber.slice(-3)}`,
        effectiveDate: `${year}-01-01`,
        terminationDate: plan.segment === "MEDICARE" ? undefined : `${year}-12-31`,
      },
      pcp: isHmo ? { name: PCPS[Math.floor(f * 100) % PCPS.length], phone: "(609) 555-0142" } : undefined,
      deductible: { totalCents: deductibleTotal, metCents: deductibleTotal - deductibleRemainingCents, remainingCents: deductibleRemainingCents },
      outOfPocket: { maxCents: oopMax, metCents: oopMax - outOfPocketRemainingCents, remainingCents: outOfPocketRemainingCents },
      referralRequired: isHmo,
      services: [
        { code: "98", label: "Professional (physician) office visit — E&M", covered: true, copayCents },
        { code: "2", label: "Surgical — wound debridement", covered: true, coinsurancePercent, authRequired: isHmo },
        { code: "CTP", label: "Skin substitutes / cellular tissue products", covered: plan.type !== "EPO", coinsurancePercent, authRequired: true, note: plan.type === "EPO" ? "Not a covered benefit under this plan" : "Prior authorization required" },
        { code: "12", label: "Durable medical equipment & wound supplies", covered: true, coinsurancePercent: 20 },
        { code: "42", label: "Home health care", covered: true, coinsurancePercent: plan.segment === "MEDICARE" ? 0 : coinsurancePercent, authRequired: plan.segment !== "MEDICARE", limit: plan.segment === "MEDICARE" ? undefined : "60 visits per calendar year" },
      ],
      messages: [
        isHmo ? "PCP referral required for specialist services." : "No referral required for specialist services.",
        "Benefits are not a guarantee of payment.",
      ],
    };

    return {
      status: "ACTIVE",
      planName: plan.name,
      copayCents,
      coinsurancePercent,
      deductibleRemainingCents,
      outOfPocketRemainingCents,
      benefits,
      raw: [
        `ISA*271*${req.payerCode}*CAREHUB~`,
        `NM1*IL*1*${benefits.subscriber?.lastName ?? ""}*${benefits.subscriber?.firstName ?? ""}****MI*${req.memberId}~`,
        dob ? `DMG*D8*${dob.replaceAll("-", "")}~` : "",
        `REF*6P*${groupNumber}~`,
        `DTP*346*D8*${year}0101~`,
        `EB*1*IND*30**${plan.name}~`,
        `EB*C*IND*30***23*${(deductibleTotal / 100).toFixed(2)}~`,
        `EB*C*IND*30***29*${(deductibleRemainingCents / 100).toFixed(2)}~`,
        `EB*G*IND*30***29*${(outOfPocketRemainingCents / 100).toFixed(2)}~`,
        `EB*B*IND*98***27*${(copayCents / 100).toFixed(2)}~`,
        `EB*A*IND*2****.${String(coinsurancePercent).padStart(2, "0")}~`,
        "(simulated 271 — demo clearinghouse)",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  },

  async submitClaim(req: ClaimSubmissionRequest): Promise<ClaimSubmissionResult> {
    await new Promise((r) => setTimeout(r, 200));

    if (!req.payerCode) {
      return { status: "ERROR", rejectionReason: "No payer code on file for EDI routing." };
    }

    // Any change to codes or pointers gives a repaired claim a fresh outcome.
    const f = seededFraction(`${req.claimId}:${req.diagnosisCodes.join(",")}:${req.lines.map((l) => `${l.cptCode}/${l.pointers}`).join("-")}`);

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
      raw: `837P accepted for payer ${req.payerCode}, ${req.lines.length} line(s) $${(req.billedCents / 100).toFixed(2)}${req.edi837 ? ` · ${req.edi837.split("~").length - 1} segments` : ""}`,
    };
  },
};
