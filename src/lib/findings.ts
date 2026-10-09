import { prisma } from "./prisma";
import type { FieldDef } from "./chart-forms";

// ROS and physical-exam phrase library. Each body system has one "normal" statement and a set of common
// findings. On the Review of Systems and Physical Exam forms a provider inserts them with one click;
// "All systems normal" fills every empty exam field. Practices edit the set in Settings → ROS & exam phrases.

export type Phrase = { id: string; text: string; normal: boolean };
export type PhraseLibrary = Record<string, Record<string, Phrase[]>>; // kind → system → phrases
export const PHRASE_KINDS: Record<string, string> = { EXAM: "Physical exam", ROS: "Review of systems" };

export const SYSTEMS = ["Constitutional", "Eyes", "ENT", "Respiratory", "Cardiovascular", "Gastrointestinal", "Genitourinary", "Endocrine", "Hematologic", "Integumentary", "Musculoskeletal", "Neurological", "Lower extremity", "Psychiatric", "Other"] as const;

// Maps a form field label to a system key (labels vary: "Ear / Nose / Mouth / Throat", "Ears, Nose, Mouth and Throat"...).
export function systemForLabel(label: string): string | null {
  const l = label.toLowerCase();
  if (/lower extremity/.test(l)) return "Lower extremity";
  if (/constitutional|general health|vital/.test(l)) return "Constitutional";
  if (/\beyes?\b/.test(l)) return "Eyes";
  if (/\bear|nose|throat|ent\b/.test(l)) return "ENT";
  if (/respir|lung|pulmon/.test(l)) return "Respiratory";
  if (/cardio|heart|vascular/.test(l)) return "Cardiovascular";
  if (/gastro|\bgi\b|abdom/.test(l)) return "Gastrointestinal";
  if (/genitour|\bgu\b|urinar/.test(l)) return "Genitourinary";
  if (/endocrin/.test(l)) return "Endocrine";
  if (/hemat|lymph/.test(l)) return "Hematologic";
  if (/integument|skin|hair|nail/.test(l)) return "Integumentary";
  if (/musculo|joint|extremit/.test(l)) return "Musculoskeletal";
  if (/neuro/.test(l)) return "Neurological";
  if (/psych|mood|mental/.test(l)) return "Psychiatric";
  if (/other|detail|additional/.test(l)) return "Other";
  return null;
}

const N = (system: string, text: string) => ({ system, text, normal: true });
const F = (system: string, text: string) => ({ system, text, normal: false });

export const DEFAULT_PHRASES: Record<string, { system: string; text: string; normal: boolean }[]> = {
  EXAM: [
    N("Constitutional", "Vital signs reviewed and within normal limits. Well developed, well nourished, in no acute distress. Clean and well groomed."),
    F("Constitutional", "Appears chronically ill."), F("Constitutional", "Appears in mild distress."), F("Constitutional", "Obese habitus."),
    N("Eyes", "Pupils equal, round and reactive to light. Extraocular movements intact. Conjunctivae clear, no scleral icterus."),
    F("Eyes", "Conjunctival pallor."), F("Eyes", "Scleral icterus."),
    N("ENT", "External ears and nose normal. Oral mucosa moist, pharynx without erythema or exudate. Dentition intact."),
    F("ENT", "Dry oral mucosa."), F("ENT", "Poor dentition."),
    N("Respiratory", "Respirations unlabored. Lungs clear to auscultation bilaterally, no wheezes, rales or rhonchi."),
    F("Respiratory", "Diminished breath sounds at the bases."), F("Respiratory", "Expiratory wheezes."), F("Respiratory", "Bibasilar crackles."),
    N("Cardiovascular", "Regular rate and rhythm, normal S1 and S2, no murmurs, rubs or gallops. Peripheral pulses palpable and symmetric. No peripheral edema."),
    F("Cardiovascular", "Irregularly irregular rhythm."), F("Cardiovascular", "Systolic murmur."), F("Cardiovascular", "1+ bilateral pitting edema to the ankles."), F("Cardiovascular", "2+ bilateral pitting edema to the knees."), F("Cardiovascular", "Dorsalis pedis pulses diminished bilaterally."), F("Cardiovascular", "Non-palpable pedal pulses; Doppler signal present."),
    N("Gastrointestinal", "Abdomen soft, non-tender, non-distended. Normal bowel sounds. No hepatosplenomegaly."),
    F("Gastrointestinal", "Abdomen distended."), F("Gastrointestinal", "Tenderness to palpation."),
    N("Genitourinary", "No costovertebral angle tenderness. Deferred."),
    N("Endocrine", "No thyromegaly. No signs of hyper- or hypothyroidism."),
    N("Hematologic", "No lymphadenopathy. No bruising or petechiae."),
    F("Hematologic", "Inguinal lymphadenopathy."), F("Hematologic", "Ecchymoses on the extremities."),
    N("Integumentary", "Skin warm and dry, normal turgor. No rashes, lesions or ulcerations other than documented wounds."),
    F("Integumentary", "Periwound erythema."), F("Integumentary", "Periwound induration."), F("Integumentary", "Maceration of the periwound skin."), F("Integumentary", "Hemosiderin staining of the lower legs."), F("Integumentary", "Dry, scaly skin of the lower legs."), F("Integumentary", "Callus formation on the plantar surface."), F("Integumentary", "Onychomycosis."),
    N("Musculoskeletal", "Normal gait and station. Full range of motion of all extremities. No joint swelling or deformity."),
    F("Musculoskeletal", "Antalgic gait."), F("Musculoskeletal", "Limited range of motion of the ankle."), F("Musculoskeletal", "Foot deformity (hammer toes / Charcot)."), F("Musculoskeletal", "Ambulates with a walker."), F("Musculoskeletal", "Wheelchair bound."),
    N("Neurological", "Alert and oriented x3. Cranial nerves II–XII grossly intact. Strength 5/5 and sensation intact in all extremities."),
    F("Neurological", "Decreased sensation to light touch in a stocking distribution."), F("Neurological", "Loss of protective sensation on monofilament testing."), F("Neurological", "Right-sided weakness."),
    N("Lower extremity", "Monofilament sensation intact at all 10 sites bilaterally. Vibration sense intact. Ankle reflexes present and symmetric."),
    F("Lower extremity", "Monofilament sensation absent at the plantar forefoot bilaterally."), F("Lower extremity", "Vibration sense diminished at the great toes."), F("Lower extremity", "Ankle reflexes absent."),
    N("Psychiatric", "Appropriate mood and affect. Normal judgement and insight."),
    F("Psychiatric", "Flat affect."), F("Psychiatric", "Anxious."), F("Psychiatric", "Memory impairment noted."),
  ],
  ROS: [
    N("Constitutional", "Denies fever, chills, fatigue, weight change or loss of appetite."),
    F("Constitutional", "Reports fatigue."), F("Constitutional", "Reports unintentional weight loss."), F("Constitutional", "Reports fevers or chills."),
    N("Eyes", "Denies vision changes."), F("Eyes", "Reports blurred vision."),
    N("ENT", "Denies hearing loss or difficulty swallowing."),
    N("Respiratory", "Denies shortness of breath, cough or wheezing."), F("Respiratory", "Reports shortness of breath on exertion."), F("Respiratory", "Uses home oxygen."),
    N("Cardiovascular", "Denies chest pain, palpitations, leg swelling or claudication."), F("Cardiovascular", "Reports leg swelling."), F("Cardiovascular", "Reports calf pain with walking (claudication)."), F("Cardiovascular", "Reports rest pain."),
    N("Gastrointestinal", "Denies nausea, vomiting, diarrhea, constipation or incontinence."), F("Gastrointestinal", "Reports bowel incontinence."),
    N("Genitourinary", "Denies urinary frequency, burning or incontinence."), F("Genitourinary", "Reports urinary incontinence."), F("Genitourinary", "Indwelling catheter."),
    N("Endocrine", "Denies excessive thirst; blood sugars reported controlled."), F("Endocrine", "Reports blood sugars not controlled."),
    N("Hematologic", "Denies easy bruising or bleeding."), F("Hematologic", "On anticoagulation."),
    N("Integumentary", "Denies rash, itching or new skin changes other than the documented wound(s)."), F("Integumentary", "Reports new skin breakdown."), F("Integumentary", "Reports increased drainage."), F("Integumentary", "Reports increased wound pain."), F("Integumentary", "Reports odor from the wound."),
    N("Musculoskeletal", "Denies joint pain or muscle weakness."), F("Musculoskeletal", "Uses an assistive device."), F("Musculoskeletal", "Reports joint pain."),
    N("Neurological", "Denies numbness, tingling, weakness or memory loss."), F("Neurological", "Reports numbness and tingling of the feet."), F("Neurological", "Reports neuropathic pain."),
    N("Psychiatric", "Denies anxiety or depression."), F("Psychiatric", "Reports depressed mood."), F("Psychiatric", "Reports anxiety."),
    N("Other", "All other systems reviewed and negative."),
  ],
};

export async function ensureFindingLibrary(practiceId: string): Promise<PhraseLibrary> {
  const n = await prisma.findingPhrase.count({ where: { practiceId } });
  if (n === 0) {
    await prisma.findingPhrase.createMany({
      data: Object.entries(DEFAULT_PHRASES).flatMap(([kind, rows]) => rows.map((r, i) => ({ practiceId, kind, system: r.system, text: r.text, normal: r.normal, sortOrder: i }))),
    });
  }
  const rows = await prisma.findingPhrase.findMany({ where: { practiceId, active: true }, orderBy: [{ kind: "asc" }, { system: "asc" }, { normal: "desc" }, { sortOrder: "asc" }] });
  const lib: PhraseLibrary = { EXAM: {}, ROS: {} };
  for (const r of rows) ((lib[r.kind] ??= {})[r.system] ??= []).push({ id: r.id, text: r.text, normal: r.normal });
  return lib;
}

// Which phrases each textarea on a form offers: by the form's kind (exam or ROS) and the field's body system.
export function phrasesForFields(templateKey: string, fields: FieldDef[], lib: PhraseLibrary): { kind: "EXAM" | "ROS"; byField: Record<string, Phrase[]> } | undefined {
  const kind = /exam/.test(templateKey) ? "EXAM" : /\bros\b|review_of_systems/.test(templateKey) ? "ROS" : null;
  if (!kind) return undefined;
  const byField: Record<string, Phrase[]> = {};
  for (const f of fields) {
    if (f.type !== "textarea") continue;
    if (kind === "ROS" && /detail|other|note|additional/i.test(f.label)) {
      // The ROS details box takes any finding from any system (the tick boxes above carry the system).
      const all = Object.values(lib.ROS ?? {}).flat();
      byField[f.id] = [...all.filter((p) => p.normal && /other systems/i.test(p.text)), ...all.filter((p) => !p.normal)];
      continue;
    }
    const sys = systemForLabel(f.label);
    const list = sys ? lib[kind]?.[sys] : undefined;
    if (list?.length) byField[f.id] = list;
  }
  return Object.keys(byField).length ? { kind, byField } : undefined;
}
