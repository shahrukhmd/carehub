import "server-only";
import type { IntakeCase, VobDecision } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { networkStatusForPayer, type NetworkStatus } from "@/lib/credentialing";
import { planSegmentLabel } from "@/lib/format";
import { vobDenyReasonLabel } from "@/lib/gateway";

// VOB learning: every decision the VOB team makes is kept per payer and plan segment. Once a payer has a
// consistent record, data entry is told whether a new patient can be taken straight to scheduling, so the
// VOB team only sees payers we have little history with and cases that need an authorization or referral.

// Decisions needed before the record is trusted, how far back it looks, and how consistent it must be.
export const VOB_MIN_CASES = 3;
export const VOB_HISTORY_DAYS = 365;
export const VOB_DIRECT_RATE = 0.9;
export const VOB_DECLINE_RATE = 0.8;
export const VOB_HOLD_RATE = 0.2;

export type PayerStats = {
  cases: number;
  approvedAll: number;
  approvedLimited: number;
  denied: number;
  // Still waiting on an authorization or referral.
  open: number;
  needAuth: number;
  needReferral: number;
  lastDecisionAt: Date | null;
  topDenyReason: string | null;
};

export type RouteSuggestion = {
  // TAKE_DIRECT: data entry may approve without VOB. DECLINE: the record says we don't take this plan.
  kind: "TAKE_DIRECT" | "SEND_TO_VOB" | "DECLINE" | "NOT_READY";
  scope: "APPROVED_ALL" | "APPROVED_LIMITED" | null;
  headline: string;
  reasons: string[];
  stats: PayerStats | null;
};

type History = Pick<VobDecision, "caseId" | "payerId" | "planSegment" | "decision" | "authRequired" | "referralRequired" | "denyReason" | "createdAt">[];

// Only the VOB team's own decisions teach the system; patients taken on a suggestion don't reinforce it.
export async function loadVobHistory(practiceId: string): Promise<History> {
  return prisma.vobDecision.findMany({
    where: { practiceId, source: "VOB", payerId: { not: null }, createdAt: { gte: new Date(Date.now() - VOB_HISTORY_DAYS * 86_400_000) } },
    select: { caseId: true, payerId: true, planSegment: true, decision: true, authRequired: true, referralRequired: true, denyReason: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}

// One outcome per case: its latest decision, and whether an authorization or referral was ever needed.
export function statsFor(history: History, payerId: string, planSegment: string | null): PayerStats {
  const rows = history.filter((h) => h.payerId === payerId && (!planSegment || !h.planSegment || h.planSegment === planSegment));
  const byCase = new Map<string, { decision: string; auth: boolean; referral: boolean; denyReason: string | null; at: Date }>();
  for (const r of rows) {
    const prev = byCase.get(r.caseId);
    byCase.set(r.caseId, {
      decision: r.decision,
      auth: Boolean(prev?.auth) || r.authRequired,
      referral: Boolean(prev?.referral) || r.referralRequired,
      denyReason: r.denyReason,
      at: r.createdAt,
    });
  }
  const outcomes = [...byCase.values()];
  const count = (d: string) => outcomes.filter((o) => o.decision === d).length;
  const reasons = new Map<string, number>();
  for (const o of outcomes) if (o.decision === "DENIED" && o.denyReason) reasons.set(o.denyReason, (reasons.get(o.denyReason) ?? 0) + 1);
  return {
    cases: outcomes.length,
    approvedAll: count("APPROVED_ALL"),
    approvedLimited: count("APPROVED_LIMITED"),
    denied: count("DENIED"),
    open: count("HOLD"),
    needAuth: outcomes.filter((o) => o.auth).length,
    needReferral: outcomes.filter((o) => o.referral).length,
    lastDecisionAt: outcomes.length ? new Date(Math.max(...outcomes.map((o) => o.at.getTime()))) : null,
    topDenyReason: [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
  };
}

type SuggestInput = Pick<IntakeCase, "payerId" | "planSegment" | "eligibilityStatus" | "authRequired" | "referralRequired"> & {
  payerName?: string | null;
  // Whether any rendering provider is credentialed (in network) with the payer.
  inNetwork: boolean;
};

export function suggestRoute(c: SuggestInput, history: History): RouteSuggestion {
  if (c.eligibilityStatus === "SELF_PAY") {
    return { kind: "TAKE_DIRECT", scope: "APPROVED_ALL", headline: "Self-pay — can be taken directly", reasons: ["No insurance benefits to verify."], stats: null };
  }
  if (!c.payerId) {
    return { kind: "NOT_READY", scope: null, headline: "Add the patient's insurance to get a suggestion", reasons: [], stats: null };
  }
  const stats = statsFor(history, c.payerId, c.planSegment);
  const segment = c.planSegment ? (planSegmentLabel[c.planSegment] ?? c.planSegment) : "";
  // "Medicare · Medicare" reads as a stutter; the segment is only added when it says something new.
  const plan = `${c.payerName ?? "this payer"}${segment && segment.toLowerCase() !== (c.payerName ?? "").toLowerCase() ? ` · ${segment}` : ""}`;
  const record = `${stats.cases} VOB decision${stats.cases === 1 ? "" : "s"} on record for ${plan}`;
  const vob = (headline: string, ...reasons: string[]): RouteSuggestion => ({ kind: "SEND_TO_VOB", scope: null, headline, reasons, stats });

  if (c.eligibilityStatus === "PENDING") {
    return { kind: "NOT_READY", scope: null, headline: "Run the eligibility check to get a suggestion", reasons: [record], stats };
  }
  if (c.eligibilityStatus !== "ACTIVE") {
    return vob("Send to VOB — coverage is not active", "The payer did not confirm active coverage. Ask the referral source for updated insurance, or let VOB review.");
  }
  const decided = stats.approvedAll + stats.approvedLimited + stats.denied;
  if (stats.cases >= VOB_MIN_CASES && decided > 0 && stats.denied / decided >= VOB_DECLINE_RATE) {
    return {
      kind: "DECLINE",
      scope: null,
      headline: "Likely not accepted — VOB has been denying this plan",
      reasons: [
        `VOB denied ${stats.denied} of ${decided} patients with ${plan}${stats.topDenyReason ? ` (most often: ${vobDenyReasonLabel[stats.topDenyReason] ?? stats.topDenyReason})` : ""}.`,
        "Close the case, or send it to VOB if this patient is different.",
      ],
      stats,
    };
  }
  if (!c.inNetwork) {
    return vob("Send to VOB — no provider is credentialed with this payer", "Credentialing shows no rendering provider in network.", record);
  }
  if (stats.cases < VOB_MIN_CASES) {
    return vob("Send to VOB — new payer / plan for us", `Only ${record}; ${VOB_MIN_CASES} are needed before patients can be taken directly.`);
  }
  if (c.authRequired === "YES" || c.referralRequired === "YES") {
    return vob(
      "Send to VOB — authorization / referral process",
      `The payer's response says ${[c.authRequired === "YES" ? "prior authorization" : "", c.referralRequired === "YES" ? "a PCP referral" : ""].filter(Boolean).join(" and ")} is required.`
    );
  }
  const holds = Math.max(stats.needAuth, stats.needReferral, stats.open);
  if (holds / stats.cases >= VOB_HOLD_RATE) {
    return vob(
      "Send to VOB — this plan often needs an authorization or referral",
      `Authorization was needed on ${stats.needAuth} and a referral on ${stats.needReferral} of the last ${stats.cases} patients with ${plan}.`
    );
  }
  const approved = stats.approvedAll + stats.approvedLimited;
  if (decided > 0 && approved / decided >= VOB_DIRECT_RATE) {
    const limited = stats.approvedLimited >= stats.approvedAll;
    return {
      kind: "TAKE_DIRECT",
      scope: limited ? "APPROVED_LIMITED" : "APPROVED_ALL",
      headline: limited ? "Good to take directly — E&M and debridements only" : "Good to take directly — all services",
      reasons: [
        `VOB approved ${approved} of ${decided} patients with ${plan}${limited ? `, ${stats.approvedLimited} for E&M and debridements only` : " for all services"}, none needing an authorization or referral.`,
        "Coverage is active and a provider is credentialed with this payer.",
      ],
      stats,
    };
  }
  return vob("Send to VOB — results for this plan are mixed", `${stats.approvedAll} approved for all services, ${stats.approvedLimited} limited, ${stats.denied} denied (${record}).`);
}

const inNetwork = (rows: NetworkStatus[]) => rows.some((n) => n.network === "IN_NETWORK");

// Suggestion for one case (case page).
export async function suggestionForCase(
  practiceId: string,
  c: Omit<SuggestInput, "inNetwork">,
  network?: NetworkStatus[],
  // Credentialing's decision on the patient's plan name, when one is on file.
  plan?: { status: string; name: string } | null
) {
  const [history, rows] = await Promise.all([
    loadVobHistory(practiceId),
    network ?? (c.payerId ? networkStatusForPayer(practiceId, c.payerId, c.planSegment) : Promise.resolve([])),
  ]);
  const suggestion = suggestRoute({ ...c, inNetwork: inNetwork(rows) }, history);
  // A patient is only taken directly when the plan itself is approved, not just the payer.
  if (plan && plan.status !== "APPROVED" && suggestion.kind === "TAKE_DIRECT" && c.eligibilityStatus !== "SELF_PAY") {
    return {
      ...suggestion,
      kind: "SEND_TO_VOB" as const,
      scope: null,
      headline: plan.status === "NOT_APPROVED" ? "Send to VOB — the practice is not approved for this plan" : "Send to VOB — this plan has not been reviewed by credentialing",
      reasons: [
        plan.status === "NOT_APPROVED"
          ? `Credentialing marked “${plan.name}” as not approved, even though the payer is in network.`
          : `“${plan.name}” is new; credentialing has been asked to confirm whether the practice is approved for it.`,
        ...suggestion.reasons,
      ],
    };
  }
  return suggestion;
}

// Suggestions for a queue of cases, looking each payer / segment up once.
export async function suggestionsForCases<T extends Omit<SuggestInput, "inNetwork"> & { id: string }>(practiceId: string, cases: T[]) {
  const history = await loadVobHistory(practiceId);
  const networks = new Map<string, boolean>();
  const out = new Map<string, RouteSuggestion>();
  for (const c of cases) {
    const key = `${c.payerId}|${c.planSegment ?? ""}`;
    if (c.payerId && !networks.has(key)) networks.set(key, inNetwork(await networkStatusForPayer(practiceId, c.payerId, c.planSegment)));
    out.set(c.id, suggestRoute({ ...c, inNetwork: networks.get(key) ?? false }, history));
  }
  return out;
}

// What the system has learned, one row per payer and plan segment (VOB learning tab).
export async function vobInsights(practiceId: string) {
  const history = await loadVobHistory(practiceId);
  const payers = await prisma.payer.findMany({ where: { practiceId, id: { in: [...new Set(history.map((h) => h.payerId!))] } }, select: { id: true, name: true } });
  const keys = [...new Set(history.map((h) => `${h.payerId}|${h.planSegment ?? ""}`))];
  const rows = [];
  for (const key of keys) {
    const [payerId, segment] = key.split("|");
    const payerName = payers.find((p) => p.id === payerId)?.name ?? "Unknown payer";
    const planSegment = segment || null;
    const network = inNetwork(await networkStatusForPayer(practiceId, payerId, planSegment));
    // The suggestion a clean new patient on this plan would get today.
    const suggestion = suggestRoute({ payerId, planSegment, payerName, eligibilityStatus: "ACTIVE", authRequired: "NO", referralRequired: "NO", inNetwork: network }, history);
    rows.push({ key, payerId, payerName, planSegment, inNetwork: network, suggestion, stats: suggestion.stats! });
  }
  return rows.sort((a, b) => a.payerName.localeCompare(b.payerName) || (a.planSegment ?? "").localeCompare(b.planSegment ?? ""));
}
