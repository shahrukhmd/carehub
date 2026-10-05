"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { AiUnavailable, aiDraft } from "@/lib/ai";
import { DENIAL_CATEGORIES, DENIAL_ROLES } from "@/lib/denials";
import { ageFromDob, formatDate, formatMoney } from "@/lib/format";

export type AiResult = { text: string; provider: string } | { error: string };

// AI failures are shown next to the button, never as an error page.
async function draft(run: () => Promise<{ text: string; provider: string }>): Promise<AiResult> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof AiUnavailable) return { error: err.message };
    return { error: `The AI couldn't answer (${err instanceof Error ? err.message.slice(0, 160) : "error"}). Try again, or write it by hand.` };
  }
}

const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- none on file");

// A plan of care for the clinician to review, built from what is charted on this visit. The patient's name, MRN and
// date of birth are not sent; age and sex are.
export async function suggestPlanOfCare(encounterId: string): Promise<AiResult> {
  const user = await requireUser(["ADMIN", "CLINICIAN", "CDS", "CODER"]);
  const e = await prisma.encounter.findFirst({
    where: { id: encounterId, practiceId: user.practiceId },
    include: {
      patient: {
        include: {
          problems: { where: { status: "ACTIVE" } },
          allergies: true,
          medications: true,
        },
      },
      woundAssessments: { include: { wound: true, debridement: true } },
    },
  });
  if (!e) return { error: "Visit not found." };

  const wounds = e.woundAssessments.map((a) =>
    [
      `${a.wound.label}: ${a.wound.etiology}, ${a.wound.location}${a.wound.onsetDate ? `, onset ${formatDate(a.wound.onsetDate)}` : ""}`,
      a.lengthCm !== null && a.widthCm !== null ? `size ${a.lengthCm} x ${a.widthCm}${a.depthCm !== null ? ` x ${a.depthCm}` : ""} cm` : "",
      a.stage ? `stage / thickness ${a.stage}` : "",
      [a.granulationPct !== null ? `granulation ${a.granulationPct}%` : "", a.sloughPct !== null ? `slough ${a.sloughPct}%` : "", a.escharPct !== null ? `eschar ${a.escharPct}%` : "", a.epithelialPct !== null ? `epithelial ${a.epithelialPct}%` : ""]
        .filter(Boolean)
        .join(", "),
      a.exudateAmount ? `exudate ${a.exudateAmount}${a.exudateType ? ` ${a.exudateType}` : ""}` : "",
      a.odor ? "odor present" : "",
      a.painLevel !== null ? `pain ${a.painLevel}/10` : "",
      a.periwoundSkin ? `periwound ${a.periwoundSkin}` : "",
      a.debridement ? `debrided today (${a.debridement.method})` : "",
      a.notes ? `notes: ${a.notes}` : "",
    ]
      .filter(Boolean)
      .join("; ")
  );

  const prompt = [
    `Patient: ${ageFromDob(e.patient.dob)} year old, sex ${e.patient.sex}.`,
    `Chief complaint: ${e.chiefComplaint || "not recorded"}`,
    `History / subjective: ${e.subjective || "not recorded"}`,
    `Exam / objective: ${e.objective || "not recorded"}`,
    `Assessment so far: ${e.assessment || "not recorded"}`,
    `Active problems:\n${list(e.patient.problems.map((p) => `${p.icd10} ${p.description}`))}`,
    `Allergies:\n${list(e.patient.allergies.map((a) => a.allergen))}`,
    `Medications:\n${list(e.patient.medications.map((m) => m.name))}`,
    `Wounds assessed this visit:\n${list(wounds)}`,
  ].join("\n\n");

  return draft(async () => {
    const out = await aiDraft({
      practiceId: user.practiceId,
      system: `You help a wound care provider draft the plan of care section of a visit note. Write a concise plan for the clinician to review and edit.
Rules:
- Use only the information given. Do not invent findings, measurements, test results or history. Where something needed is missing, say what to assess or obtain.
- Organise as short headed sections: one per wound (cleansing, dressing and change frequency, debridement, offloading or compression as fits the wound type), then Infection / diagnostics, Nutrition, Patient education, Home health / coordination, Follow-up.
- Respect the listed allergies. Keep to standard wound care practice; do not recommend prescription drug doses.
- Plain text only, no markdown symbols, at most 250 words.`,
      prompt,
      maxTokens: 3000,
    });
    await logAudit(user.practiceId, user.id, "AI_PLAN_OF_CARE_SUGGESTED", "Encounter", e.id, out.provider);
    return out;
  });
}

// An appeal letter body for the biller to review. The patient's name is not sent: the letter PDF adds the claim
// and patient details around this text.
export async function draftAppealLetter(appealId: string): Promise<AiResult> {
  const user = await requireUser(DENIAL_ROLES);
  const appeal = await prisma.claimAppeal.findFirst({ where: { id: appealId, practiceId: user.practiceId }, include: { denial: true } });
  if (!appeal) return { error: "Appeal not found." };
  const claim = await prisma.claim.findUnique({
    where: { id: appeal.claimId },
    include: { payer: true, lines: { orderBy: { lineNumber: "asc" } }, diagnoses: { orderBy: { sequence: "asc" } }, renderingProvider: true, encounter: true, insurance: true },
  });
  if (!claim) return { error: "Claim not found." };
  const d = appeal.denial;
  const category = DENIAL_CATEGORIES[d.category];

  const prompt = [
    `Payer: ${claim.payer?.name ?? claim.payerName}`,
    `Appeal level: ${appeal.level}`,
    `Denial: code ${[d.groupCode, d.code].filter(Boolean).join("-") || "not given"}; reason: ${d.reason}${d.remarks ? `; remark codes: ${d.remarks}` : ""}; category: ${category?.label ?? d.category}; denied amount ${formatMoney(d.amountCents)}; denied on ${formatDate(d.deniedAt)}`,
    `Rendering provider: ${claim.renderingProvider?.name ?? "not recorded"}`,
    `Authorization number on the claim: ${claim.priorAuthNumber || "none"}`,
    `Service lines:\n${list(claim.lines.map((l) => `${formatDate(l.dosFrom)} CPT ${l.cptCode}${l.modifiers ? ` modifiers ${l.modifiers}` : ""} x${l.units} charge ${formatMoney(l.chargeCents)}`))}`,
    `Diagnoses:\n${list(claim.diagnoses.map((x) => `${x.icd10}${x.description ? ` ${x.description}` : ""}`))}`,
    `Visit assessment: ${claim.encounter?.assessment || "not available"}`,
    `Visit plan: ${claim.encounter?.plan || "not available"}`,
    appeal.letterBody ? `Current draft to improve:\n${appeal.letterBody}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return draft(async () => {
    const out = await aiDraft({
      practiceId: user.practiceId,
      system: `You draft the body of a medical claim appeal letter for a wound care practice's billing team to review.
Rules:
- Write only the body paragraphs: no letterhead, date, address block, greeting, signature or enclosure list (those are added automatically).
- State that reconsideration is requested, address the specific denial reason directly, and argue from the facts given (medical necessity, coding, authorization, timely filing or eligibility, whichever fits the denial).
- Use only the information given. Do not invent dates, authorization numbers, policy citations, test results or clinical facts. If a supporting fact is missing, write a bracketed placeholder such as [insert authorization number].
- Refer to the patient as "the patient". Professional, firm and courteous. Plain text, 3 to 5 short paragraphs, no markdown.`,
      prompt,
      maxTokens: 3000,
    });
    await logAudit(user.practiceId, user.id, "AI_APPEAL_LETTER_DRAFTED", "ClaimAppeal", appeal.id, out.provider);
    return out;
  });
}
