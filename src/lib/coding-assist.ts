import "server-only";
import { prisma } from "@/lib/prisma";
import { ICD10_CATALOG, searchCatalog } from "@/lib/code-catalog";
import { scheduleForEncounter } from "@/lib/charge-schedules";
import { etiologyLabel } from "@/lib/wound";

// Coding assist: what the chart supports, offered to the coder as tick-to-add suggestions. Rules over the visit's
// own data (problem list, wounds and their assessments, debridements, treatment supplies, orders, prior visits) —
// no vendor, nothing sent anywhere. The coder decides; nothing is added until ticked.

export type DxSuggestion = { icd10: string; description: string; why: string; onSuperbill: boolean };
export type CptSuggestion = { cpt: string; description: string; units: number; feeCents: number; why: string; onSuperbill: boolean; pointer: string };
export type EmSuggestion = { code: string; label: string; level: "LOW" | "MODERATE" | "HIGH"; newPatient: boolean; rationale: string[]; onSuperbill: boolean; feeCents: number };

const side = (loc: string) => (/\bleft\b/i.test(loc) ? "left" : /\bright\b/i.test(loc) ? "right" : "");
const site = (loc: string) => {
  const l = loc.toLowerCase();
  if (/heel/.test(l)) return "heel";
  if (/ankle|malleol/.test(l)) return "ankle";
  if (/calf|lower leg|shin|tibia/.test(l)) return "calf";
  if (/toe/.test(l)) return "toe";
  if (/foot|plantar|dorsum/.test(l)) return "foot";
  if (/thigh/.test(l)) return "thigh";
  if (/sacr|coccy/.test(l)) return "sacral";
  if (/buttock|ischi/.test(l)) return "buttock";
  if (/hip|trochant/.test(l)) return "hip";
  if (/elbow/.test(l)) return "elbow";
  if (/back/.test(l)) return "back";
  return "";
};
const stageWord = (stage: string | null | undefined) => {
  const m = stage?.match(/(\d)/);
  if (m) return `stage ${m[1]}`;
  if (/unstage/i.test(stage ?? "")) return "unstageable";
  if (/deep tissue/i.test(stage ?? "")) return "deep tissue";
  return "";
};

// Best ICD-10 for a wound from the practice catalog, by etiology, side, site and stage.
function woundCodes(w: { etiology: string; location: string; stage?: string | null }): { code: string; description: string }[] {
  const s = side(w.location);
  const t = site(w.location);
  const pick = (q: string, cat: RegExp, n = 1) => searchCatalog(ICD10_CATALOG.filter((c) => cat.test(c.category)), q).slice(0, n);
  switch (w.etiology) {
    case "PRESSURE":
      return pick(`${t} ${s} ${stageWord(w.stage)}`.trim(), /pressure/i) ;
    case "VENOUS":
      return [...pick(`${s} ${t === "calf" ? "calf" : t === "ankle" ? "ankle" : t === "heel" ? "heel" : t === "foot" ? "foot" : ""}`.trim(), /venous/i), ...ICD10_CATALOG.filter((c) => c.code === "I87.2")];
    case "ARTERIAL":
      return pick(`${s} ${t === "calf" ? "calf" : t === "ankle" ? "ankle" : t === "heel" ? "heel" : t === "thigh" ? "thigh" : "foot"}`.trim(), /arterial|atheroscler/i);
    case "DIABETIC_NEUROPATHIC":
      return [...ICD10_CATALOG.filter((c) => c.code === (t === "foot" || t === "toe" || t === "heel" ? "E11.621" : "E11.622")), ...pick(`${s} ${t || "foot"}`.trim(), /non-pressure|other sites|L97/i)];
    default:
      return pick(`${s} ${t}`.trim(), /non-pressure|other sites|L98/i);
  }
}

export async function codingSuggestions(encounterId: string, practiceId: string) {
  const e = await prisma.encounter.findFirst({
    where: { id: encounterId, practiceId },
    include: {
      patient: { select: { id: true, dob: true, problems: { where: { status: "ACTIVE" }, select: { icd10: true, description: true, sendToSuperbill: true } } } },
      diagnoses: { select: { icd10: true } },
      charges: { select: { cptCode: true } },
      woundAssessments: { include: { wound: { select: { id: true, label: true, location: true, etiology: true } }, debridement: true } },
      woundTreatments: { include: { lines: { include: { product: { select: { hcpcsCode: true, name: true } } } } } },
      labOrders: { select: { id: true } },
      documents: { where: { status: "COMPLETE" }, select: { template: { select: { key: true } } } },
      medications: { select: { id: true, startDate: true, discontinuedAt: true } },
    },
  });
  if (!e) return null;
  // Orders placed at this visit (lab/imaging module plus the older lab orders).
  const ordersCount = e.labOrders.length + (await prisma.clinicalOrder.count({ where: { encounterId: e.id, status: { not: "CANCELLED" } } }));
  const onSb = new Set(e.diagnoses.map((d) => d.icd10.toUpperCase()));
  const chargeCodes = new Set(e.charges.map((c) => c.cptCode.toUpperCase()));
  const schedule = await scheduleForEncounter(practiceId, encounterId);
  const practiceCodes = new Map((await prisma.practiceCode.findMany({ where: { practiceId, type: "CPT", active: true }, select: { code: true, description: true, feeCents: true } })).map((c) => [c.code.toUpperCase(), c]));
  const fee = (code: string) => schedule?.fees.get(code)?.feeCents ?? practiceCodes.get(code)?.feeCents ?? 0;
  const desc = (code: string, fallback: string) => practiceCodes.get(code)?.description ?? fallback;

  // ---- Diagnoses
  const dx: DxSuggestion[] = [];
  const seen = new Set<string>();
  const addDx = (icd10: string, description: string, why: string) => {
    const code = icd10.toUpperCase();
    if (seen.has(code)) return;
    seen.add(code);
    dx.push({ icd10: code, description, why, onSuperbill: onSb.has(code) });
  };
  const wounds = new Map<string, { label: string; location: string; etiology: string; stage: string | null }>();
  for (const a of e.woundAssessments) wounds.set(a.wound.id, { label: a.wound.label, location: a.wound.location, etiology: a.wound.etiology, stage: a.stage ?? wounds.get(a.wound.id)?.stage ?? null });
  for (const w of wounds.values()) {
    for (const c of woundCodes(w)) addDx(c.code, c.description, `${w.label} — ${etiologyLabel[w.etiology] ?? w.etiology}, ${w.location}${w.stage ? `, ${w.stage}` : ""}`);
  }
  for (const p of e.patient.problems) addDx(p.icd10, p.description, p.sendToSuperbill ? "Problem list (marked for superbill)" : "Active problem");

  // ---- Procedures
  const cpt: CptSuggestion[] = [];
  const addCpt = (code: string, description: string, units: number, why: string, pointer = "A") => {
    if (cpt.some((c) => c.cpt === code)) return;
    cpt.push({ cpt: code, description: desc(code, description), units, feeCents: fee(code), why, onSuperbill: chargeCodes.has(code), pointer });
  };
  for (const a of e.woundAssessments) {
    const d = a.debridement;
    if (!d) continue;
    const area = a.areaCm2 ?? 0;
    if (d.cptCode) addCpt(d.cptCode, `Debridement (${d.method.toLowerCase()})`, 1, `Debridement recorded on ${a.wound.label}${d.chargeId ? " (charge created)" : ""}`);
    else if (d.method === "SHARP") {
      // Selective debridement by area: 97597 first 20 cm², 97598 each additional 20 cm².
      addCpt("97597", "Debridement, open wound, first 20 sq cm", 1, `Sharp debridement on ${a.wound.label} (${area.toFixed(1)} cm²)`);
      if (area > 20) addCpt("97598", "Debridement, each additional 20 sq cm", Math.ceil((area - 20) / 20), `${a.wound.label} is ${area.toFixed(1)} cm²`);
    }
  }
  if (e.documents.some((d) => d.template.key.startsWith("ctp"))) {
    const total = [...wounds.keys()].reduce((s, id) => s + (e.woundAssessments.filter((a) => a.wound.id === id).map((a) => a.areaCm2 ?? 0).pop() ?? 0), 0);
    const legFoot = [...wounds.values()].some((w) => /leg|ankle|foot|heel|toe/i.test(w.location));
    if (total <= 25) addCpt(legFoot ? "15275" : "15271", "Skin substitute graft, first 25 sq cm", 1, "CTP application documented");
    else addCpt(legFoot ? "15277" : "15273", "Skin substitute graft, first 100 sq cm", 1, `CTP application documented (${total.toFixed(0)} cm²)`);
  }
  for (const t of e.woundTreatments) {
    for (const l of t.lines) if (l.product?.hcpcsCode) addCpt(l.product.hcpcsCode, l.product.name, Math.max(1, Math.round(l.quantity)), `Treatment note supply${t.billedAt ? " (on superbill)" : ""}`);
  }

  // ---- E/M level: a simple MDM reading of the chart. The coder confirms against the note.
  const priorVisits = await prisma.encounter.count({ where: { patientId: e.patient.id, practiceId, id: { not: e.id }, date: { lt: e.date, gte: new Date(e.date.getTime() - 3 * 365 * 86_400_000) }, status: { notIn: ["CANCELLED", "NO_SHOW"] } } });
  const newPatient = priorVisits === 0;
  const problems = Math.max(dx.length, e.diagnoses.length);
  const chronic = e.patient.problems.length;
  const rxChanged = e.medications.some((m) => (m.startDate && m.startDate >= new Date(e.date.getTime() - 86_400_000)) || (m.discontinuedAt && m.discontinuedAt >= new Date(e.date.getTime() - 86_400_000)));
  const procedure = e.woundAssessments.some((a) => a.debridement) || cpt.some((c) => /^152/.test(c.cpt));
  const dataReviewed = ordersCount > 0;
  const rationale: string[] = [newPatient ? "No visit in the past 3 years → new patient" : `${priorVisits} visit(s) in the past 3 years → established`];
  let level: EmSuggestion["level"] = "LOW";
  if (problems >= 2 && chronic >= 2) {
    level = "MODERATE";
    rationale.push(`${chronic} chronic problems addressed`);
  } else rationale.push(`${problems} problem(s) addressed`);
  if (rxChanged) {
    level = level === "LOW" ? "MODERATE" : level;
    rationale.push("Prescription drug management");
  }
  if (dataReviewed) rationale.push(`${ordersCount} order(s) / results reviewed`);
  if (procedure) rationale.push("Procedure at this visit — E/M is separately reportable only if significant and separate (modifier 25)");
  if (problems >= 3 && (rxChanged || dataReviewed) && chronic >= 2) {
    level = "HIGH";
    rationale.push("Several problems with drug management and data review → high complexity (check the note supports it)");
  }
  const code = newPatient ? { LOW: "99203", MODERATE: "99204", HIGH: "99205" }[level] : { LOW: "99213", MODERATE: "99214", HIGH: "99215" }[level];
  const em: EmSuggestion = {
    code,
    label: `${newPatient ? "New" : "Established"} patient, ${level.toLowerCase()} complexity`,
    level,
    newPatient,
    rationale,
    onSuperbill: [...chargeCodes].some((c) => /^99(20[2-5]|21[2-5])$/.test(c)),
    feeCents: fee(code),
  };

  return { dx, cpt, em, procedure };
}
