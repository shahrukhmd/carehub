import "server-only";
import { prisma } from "@/lib/prisma";

// Payer billing rules: set a payer up once so every claim to it is built the right way. A rule set (dated) on
// the payer says how to submit and which loops to report; override rows under it, keyed by site and/or
// rendering provider, say whom to bill under, which tax identifier and which pay-to address. One resolver
// answers every question for a claim and the 837P, CMS-1500 and release checks all use it, so a rule either
// applies everywhere or nowhere.

export const SUBMISSION_TYPES: Record<string, string> = { ELECTRONIC: "Electronic (837P)", PAPER: "Paper" };
export const PAPER_FORMS: Record<string, string> = { CMS1500: "CMS-1500", UB04: "UB-04 (institutional)" };
export const LOOP_RULES: Record<string, string> = { ALWAYS: "Always report", OMIT_WHEN_SAME_AS_BILLING: "Omit when same as the billing provider", NEVER: "Never report" };
export const BILL_UNDER: Record<string, string> = { PRACTICE: "The practice (group NPI and tax ID)", PROVIDER: "The rendering provider's own NPI", LOCATION: "The site of service's NPI" };
export const TAX_ID_TYPES: Record<string, string> = { EIN: "Tax ID (EIN)", SSN: "SSN" };
export const PAY_TO: Record<string, string> = { PRACTICE: "Practice pay-to address", PROVIDER: "Provider's address", LOCATION: "Site address", CUSTOM: "Custom address" };
export const CROSSOVER: Record<string, string> = { AUTO: "Payer crosses over to the secondary", MANUAL: "We bill the secondary ourselves" };

export type BillingDecision = {
  submissionType: string;
  paperForm: string;
  claimPayerId: string | null;
  eligibilityPayerId: string | null;
  statusPayerId: string | null;
  renderingLoop: boolean;
  serviceLocationLoop: boolean;
  homeBound: boolean;
  crossover: string;
  billUnder: string;
  taxIdType: string;
  payTo: string;
  payToAddress: { name: string | null; line1: string | null; line2: string | null; city: string | null; state: string | null; zip: string | null } | null;
  taxonomy: string | null;
  legacyId: string | null;
  hold: string | null;
  // Where each decision came from, for the preview and the rule page.
  sources: Record<string, string>;
};

const DEFAULTS: Omit<BillingDecision, "sources"> = {
  submissionType: "ELECTRONIC",
  paperForm: "CMS1500",
  claimPayerId: null,
  eligibilityPayerId: null,
  statusPayerId: null,
  renderingLoop: true,
  serviceLocationLoop: true,
  homeBound: false,
  crossover: "AUTO",
  billUnder: "PRACTICE",
  taxIdType: "EIN",
  payTo: "PRACTICE",
  payToAddress: null,
  taxonomy: null,
  legacyId: null,
  hold: null,
};

// The rule set in force for a payer on a date of service: the latest effective-from on or before the date,
// not yet ended.
export async function ruleSetFor(practiceId: string, payerId: string, date: Date) {
  return prisma.payerRuleSet.findFirst({
    where: { practiceId, payerId, effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] },
    orderBy: { effectiveFrom: "desc" },
    include: { overrides: true },
  });
}

type ClaimForRules = {
  practiceId: string;
  payerId: string | null;
  renderingProviderId: string | null;
  serviceLocationId: string | null;
  billingProviderId: string | null;
  lines: { dosFrom: Date }[];
  payer?: { payerCode: string | null; eligibilityPayerId: string | null; name: string } | null;
};

// Precedence: override for site + provider, then provider only, then site only, then the rule set, then
// the practice default.
export async function resolveBillingRules(claim: ClaimForRules): Promise<BillingDecision> {
  const d: BillingDecision = { ...DEFAULTS, sources: {} };
  d.claimPayerId = claim.payer?.payerCode ?? null;
  d.eligibilityPayerId = claim.payer?.eligibilityPayerId ?? null;
  if (!claim.payerId) return d;
  const dos = claim.lines[0]?.dosFrom ?? new Date();
  const rs = await ruleSetFor(claim.practiceId, claim.payerId, dos);
  if (!rs) {
    d.sources.all = "practice default (no rule set for this payer)";
    return d;
  }
  const label = `rule set from ${rs.effectiveFrom.toISOString().slice(0, 10)}`;
  d.submissionType = rs.submissionType;
  d.paperForm = rs.paperForm;
  if (rs.claimPayerId) d.claimPayerId = rs.claimPayerId;
  if (rs.eligibilityPayerId) d.eligibilityPayerId = rs.eligibilityPayerId;
  d.statusPayerId = rs.statusPayerId;
  d.homeBound = rs.homeBound;
  d.crossover = rs.crossover;
  for (const k of ["submissionType", "paperForm", "claimPayerId", "eligibilityPayerId", "statusPayerId", "homeBound", "crossover", "renderingLoop", "serviceLocationLoop"]) d.sources[k] = label;
  if (rs.hold && (!rs.holdUntil || rs.holdUntil > new Date())) d.hold = `Submissions to ${claim.payer?.name ?? "this payer"} are on hold${rs.holdReason ? `: ${rs.holdReason}` : ""}${rs.holdUntil ? ` (until ${rs.holdUntil.toISOString().slice(0, 10)})` : ""}.`;

  // Overrides, most specific first.
  const o = rs.overrides;
  const pick =
    o.find((x) => x.locationId && x.renderingProviderId && x.locationId === claim.serviceLocationId && x.renderingProviderId === claim.renderingProviderId) ??
    o.find((x) => !x.locationId && x.renderingProviderId && x.renderingProviderId === claim.renderingProviderId) ??
    o.find((x) => x.locationId && !x.renderingProviderId && x.locationId === claim.serviceLocationId) ??
    o.find((x) => !x.locationId && !x.renderingProviderId) ??
    null;
  if (pick) {
    const src = pick.locationId && pick.renderingProviderId ? "override for this site and provider" : pick.renderingProviderId ? "override for this provider" : pick.locationId ? "override for this site" : "override for every site and provider";
    d.billUnder = pick.billUnder;
    d.taxIdType = pick.taxIdType;
    d.payTo = pick.payTo;
    d.payToAddress = pick.payTo === "CUSTOM" ? { name: pick.payToName, line1: pick.payToLine1, line2: pick.payToLine2, city: pick.payToCity, state: pick.payToState, zip: pick.payToZip } : null;
    d.taxonomy = pick.taxonomy;
    d.legacyId = pick.legacyId;
    for (const k of ["billUnder", "taxIdType", "payTo", "taxonomy", "legacyId"]) d.sources[k] = src;
  }

  // Loop rules compare against the NPI the claim actually bills under.
  const [bp, rp, loc] = await Promise.all([
    claim.billingProviderId ? prisma.billingProvider.findUnique({ where: { id: claim.billingProviderId }, select: { npi: true } }) : null,
    claim.renderingProviderId ? prisma.renderingProvider.findUnique({ where: { id: claim.renderingProviderId }, select: { npi: true } }) : null,
    claim.serviceLocationId ? prisma.location.findUnique({ where: { id: claim.serviceLocationId }, select: { npi: true } }) : null,
  ]);
  const billingNpi = d.billUnder === "PROVIDER" ? (rp?.npi ?? bp?.npi) : d.billUnder === "LOCATION" ? (loc?.npi ?? bp?.npi) : bp?.npi;
  const sameAsBilling = Boolean(billingNpi && rp?.npi && billingNpi === rp.npi);
  d.renderingLoop = rs.renderingRule === "NEVER" ? false : rs.renderingRule === "OMIT_WHEN_SAME_AS_BILLING" ? !sameAsBilling : true;
  const locSameAsBilling = Boolean(billingNpi && loc?.npi && billingNpi === loc.npi);
  d.serviceLocationLoop = rs.serviceLocationRule === "NEVER" ? false : rs.serviceLocationRule === "OMIT_WHEN_SAME_AS_BILLING" ? !locSameAsBilling : true;
  return d;
}

// Plain-language reading of one override row, for the rule page.
export function overrideSentence(o: { locationId: string | null; renderingProviderId: string | null; billUnder: string; taxIdType: string; payTo: string }, names: { location?: string | null; provider?: string | null }) {
  const scope = o.locationId && o.renderingProviderId ? `from ${names.location} by ${names.provider}` : o.renderingProviderId ? `by ${names.provider}` : o.locationId ? `from ${names.location}` : "from every site, by every provider";
  return `Claims ${scope} bill under ${BILL_UNDER[o.billUnder]?.toLowerCase() ?? o.billUnder}, report the ${TAX_ID_TYPES[o.taxIdType] ?? o.taxIdType}, pay to the ${PAY_TO[o.payTo]?.toLowerCase() ?? o.payTo}.`;
}
