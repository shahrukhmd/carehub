// Claim and visit-billing vocabulary shared by the billing screens (no server imports).

export const claimStatusLabel: Record<string, string> = {
  DRAFT: "Draft",
  READY: "Ready to submit",
  HOLD: "On hold",
  SUBMITTED: "Submitted",
  ACCEPTED: "Accepted by payer",
  EDI_REJECTED: "Rejected (clearinghouse)",
  DENIED: "Denied",
  PARTIAL: "Partially paid",
  PAID: "Paid",
  TRANSFERRED: "Paid · balance to next payer",
  APPEAL: "Under appeal",
  DELINQUENT: "Delinquent",
  IN_COLLECTION: "In collection",
  WRITTEN_OFF: "Written off",
  VOID: "Voided",
};

// Claims that can still be changed and (re)sent.
export const EDITABLE_CLAIM_STATUSES = ["DRAFT", "READY", "HOLD", "EDI_REJECTED"];
// Claims the payer has, or has answered.
export const OPEN_AR_STATUSES = ["SUBMITTED", "ACCEPTED", "PARTIAL", "APPEAL", "DELINQUENT", "IN_COLLECTION", "DENIED"];

export function claimStatusTone(status: string): "ok" | "warn" | "bad" | "info" | "muted" {
  if (["PAID", "TRANSFERRED"].includes(status)) return "ok";
  if (["DENIED", "EDI_REJECTED", "DELINQUENT", "IN_COLLECTION"].includes(status)) return "bad";
  if (["DRAFT", "HOLD", "PARTIAL", "APPEAL"].includes(status)) return "warn";
  if (["VOID", "WRITTEN_OFF"].includes(status)) return "muted";
  return "info";
}

// Office Ally Practice Mate's visit billing statuses.
export const visitBillingStatusLabel: Record<string, string> = {
  OPEN: "Open",
  READY_FOR_CLAIM: "Ready for claim",
  CLAIM_CREATED_PRIMARY: "Claim created · primary",
  BILLED_PRIMARY: "Billed primary",
  CLAIM_CREATED_SECONDARY: "Claim created · secondary",
  BILLED_SECONDARY: "Billed secondary",
  INSURANCE_DENIED: "Insurance denied",
  APPEAL: "Appeal",
  PATIENT_RESPONSIBILITY: "Patient responsibility",
  INSURANCE_OVERPAYMENT: "Insurance overpayment",
  PATIENT_OVERPAYMENT: "Patient overpayment",
  DELINQUENT: "Delinquent",
  IN_COLLECTION: "In collection",
  CLOSED: "Closed",
};

export const payerRankLabel: Record<string, string> = {
  PRIMARY: "Primary",
  SECONDARY: "Secondary",
  TERTIARY: "Tertiary",
};
export const PAYER_RANKS = ["PRIMARY", "SECONDARY", "TERTIARY"];

export const claimFrequencyLabel: Record<string, string> = {
  "1": "1 · Original",
  "7": "7 · Replacement (corrected)",
  "8": "8 · Void / cancel",
};

export const formTypeLabel: Record<string, string> = {
  CMS1500: "CMS-1500 (professional)",
  UB04: "UB-04 (institutional)",
};

export const relationshipToInsuredLabel: Record<string, string> = {
  "18": "Self",
  "01": "Spouse",
  "19": "Child",
  G8: "Other",
};

// CLM20 / box 22 delay reason codes.
export const delayReasonLabel: Record<string, string> = {
  "1": "1 · Proof of eligibility unknown or unavailable",
  "2": "2 · Litigation",
  "3": "3 · Authorization delays",
  "4": "4 · Delay in certifying provider",
  "5": "5 · Delay in supplying billing forms",
  "6": "6 · Delay in delivery of custom-made appliances",
  "7": "7 · Third-party processing delay",
  "8": "8 · Delay in eligibility determination",
  "9": "9 · Original claim rejected/denied for unrelated reason",
  "10": "10 · Administration delay in prior approval",
  "11": "11 · Other",
  "15": "15 · Natural disaster",
};

export const DX_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
export const MAX_CLAIM_DIAGNOSES = 12;
export const MAX_CLAIM_LINES = 50;

// "A, b ,c" -> "A,B,C" limited to letters that exist on the claim.
export function normalizePointers(value: string, dxCount: number) {
  const allowed = DX_LETTERS.slice(0, dxCount);
  const letters = value
    .toUpperCase()
    .split(/[\s,]+/)
    .flatMap((part) => (/^[A-L]+$/.test(part) ? part.split("") : [part]))
    .filter((l) => allowed.includes(l));
  return [...new Set(letters)].slice(0, 4).join(",");
}

export function claimNumber(claim: { id: string; createdAt: Date }) {
  return `CLM-${claim.createdAt.getFullYear().toString().slice(2)}${claim.id.slice(-6).toUpperCase()}`;
}
