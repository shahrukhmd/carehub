// Care plan vocabulary: care team roles, health concerns, goals, implantable devices and the social needs screening.

export const careTeamRoleLabel: Record<string, string> = {
  WOUND_CARE: "Wound care provider",
  PCP: "Primary care provider",
  SPECIALIST: "Specialist",
  NURSE: "Nurse",
  HOME_HEALTH: "Home health",
  CASE_MANAGER: "Case manager / social worker",
  PHARMACIST: "Pharmacist",
  THERAPIST: "Therapist (PT / OT)",
  CAREGIVER: "Family caregiver",
  OTHER: "Other",
};

export const concernCategoryLabel: Record<string, string> = {
  CLINICAL: "Clinical",
  FUNCTIONAL: "Functional",
  SOCIAL: "Social",
  BEHAVIORAL: "Behavioral",
  OTHER: "Other",
};

export const goalKindLabel: Record<string, string> = { PROVIDER: "Care team goal", PATIENT: "Patient's own goal" };

export const goalStatusLabel: Record<string, string> = { ACTIVE: "Active", ACHIEVED: "Achieved", NOT_MET: "Not met", CANCELLED: "Cancelled" };
export const goalStatusTone: Record<string, string> = { ACTIVE: "info", ACHIEVED: "ok", NOT_MET: "bad", CANCELLED: "muted" };

// ---- Social needs screening ----
// A short screen for the social needs that most often stall wound healing. An answer marked `need` flags its domain.

export const sdohDomainLabel: Record<string, string> = {
  HOUSING: "Housing",
  FOOD: "Food",
  TRANSPORT: "Transportation",
  UTILITIES: "Utilities",
  FINANCIAL: "Paying for care and supplies",
  SUPPORT: "Help at home",
  SAFETY: "Safety",
};

type Option = { code: string; label: string; need?: boolean };
const OFTEN: Option[] = [
  { code: "NEVER", label: "Never" },
  { code: "SOMETIMES", label: "Sometimes", need: true },
  { code: "OFTEN", label: "Often", need: true },
];
const YES_NO: Option[] = [
  { code: "NO", label: "No" },
  { code: "YES", label: "Yes", need: true },
];

export const SDOH_QUESTIONS: { key: string; domain: string; text: string; options: Option[] }[] = [
  {
    key: "housing_situation",
    domain: "HOUSING",
    text: "What is your living situation today?",
    options: [
      { code: "STABLE", label: "I have a steady place to live" },
      { code: "AT_RISK", label: "I have a place today but worry about losing it", need: true },
      { code: "NONE", label: "I do not have a steady place to live", need: true },
    ],
  },
  { key: "housing_problems", domain: "HOUSING", text: "Does the place you live have problems such as pests, mold, no heat or no running water?", options: YES_NO },
  { key: "food_worry", domain: "FOOD", text: "In the last 12 months, did you worry that food would run out before you had money to buy more?", options: OFTEN },
  { key: "food_ran_out", domain: "FOOD", text: "In the last 12 months, did the food you bought not last and you had no money for more?", options: OFTEN },
  { key: "transport", domain: "TRANSPORT", text: "In the last 12 months, has lack of a ride kept you from appointments or from getting medicines or supplies?", options: YES_NO },
  {
    key: "utilities",
    domain: "UTILITIES",
    text: "In the last 12 months, has the electric, gas, oil or water company threatened to shut off service?",
    options: [
      { code: "NO", label: "No" },
      { code: "YES", label: "Yes", need: true },
      { code: "SHUT_OFF", label: "Already shut off", need: true },
    ],
  },
  { key: "supplies_cost", domain: "FINANCIAL", text: "Is it hard to pay for your dressings, medicines or copays?", options: OFTEN },
  {
    key: "help_at_home",
    domain: "SUPPORT",
    text: "Do you have someone who can help with dressing changes and getting to visits?",
    options: [
      { code: "YES", label: "Yes" },
      { code: "SOMETIMES", label: "Only sometimes", need: true },
      { code: "NO", label: "No, I manage alone", need: true },
    ],
  },
  { key: "safety", domain: "SAFETY", text: "Do you feel physically and emotionally safe where you live?", options: [{ code: "YES", label: "Yes" }, { code: "NO", label: "No", need: true }] },
];

export function parseSdohAnswers(value: string | null | undefined): Record<string, string> {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// The domains where an answer shows a need, in the order of sdohDomainLabel.
export function sdohNeeds(answers: Record<string, string>) {
  const found = new Set<string>();
  for (const q of SDOH_QUESTIONS) {
    if (q.options.find((o) => o.code === answers[q.key])?.need) found.add(q.domain);
  }
  return Object.keys(sdohDomainLabel).filter((d) => found.has(d));
}
