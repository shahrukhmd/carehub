// Choice lists for the patient registration form (no server imports).

export const sexLabel: Record<string, string> = { F: "Female", M: "Male", X: "Unspecified" };

export const genderIdentityLabel: Record<string, string> = {
  MALE: "Male",
  FEMALE: "Female",
  TRANS_MALE: "Transgender male",
  TRANS_FEMALE: "Transgender female",
  NON_BINARY: "Non-binary",
  OTHER: "Other",
  DECLINED: "Patient declined",
};

export const sexualOrientationLabel: Record<string, string> = {
  STRAIGHT: "Straight or heterosexual",
  GAY: "Lesbian or gay",
  BISEXUAL: "Bisexual",
  OTHER: "Something else",
  UNKNOWN: "Don't know",
  DECLINED: "Patient declined",
};

export const pronounLabel: Record<string, string> = {
  HE: "He / him",
  SHE: "She / her",
  THEY: "They / them",
  OTHER: "Other",
};

export const RELIGIONS = ["Buddhist", "Catholic", "Christian (other)", "Hindu", "Jewish", "Muslim", "Protestant", "Sikh", "Other", "None", "Patient declined"];

export const LANGUAGES = ["English", "Spanish", "Arabic", "Chinese (Cantonese)", "Chinese (Mandarin)", "French", "German", "Haitian Creole", "Hindi", "Korean", "Polish", "Portuguese", "Russian", "Tagalog", "Urdu", "Vietnamese", "American Sign Language", "Other"];

export const communicationLabel: Record<string, string> = {
  MOBILE: "Mobile phone",
  HOME: "Home phone",
  WORK: "Work phone",
  TEXT: "Text message",
  EMAIL: "Email",
  MAIL: "Mail",
  PORTAL: "Patient portal",
  NONE: "Do not contact",
};

export const phoneTypeLabel: Record<string, string> = { MOBILE: "Mobile", HOME: "Home", WORK: "Work" };

export const medicareAdmissionLabel: Record<string, string> = {
  PART_A: "Medicare Part A",
  PART_B: "Medicare Part B",
  ADVANTAGE: "Medicare Advantage",
  NOT_MEDICARE: "Not a Medicare admission",
};

export const HOW_HEARD = ["Physician referral", "Hospital / discharge planner", "Home health agency", "Skilled nursing facility", "Insurance company", "Family or friend", "Internet search", "Advertisement", "Existing patient", "Other"];

export const guarantorRelationshipLabel: Record<string, string> = {
  SELF: "Self",
  SPOUSE: "Spouse",
  PARENT: "Parent",
  GUARDIAN: "Legal guardian",
  CHILD: "Child",
  OTHER: "Other",
};

export const yesNoUnknownLabel: Record<string, string> = { YES: "Yes", NO: "No", UNKNOWN: "Unknown" };

export type PatientAddress = { line1?: string; line2?: string; city?: string; state?: string; zip?: string; county?: string };

export function parseAddress(json: string | null | undefined): PatientAddress {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as PatientAddress) : {};
  } catch {
    return {};
  }
}

export function addressLine(a: PatientAddress) {
  return [a.line1, a.line2, [a.city, a.state, a.zip].filter(Boolean).join(" "), a.county ? `${a.county} County` : ""].filter(Boolean).join(", ");
}

export function parseRepresentatives(json: string | null | undefined): { firstName: string; lastName: string }[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((r) => r && (r.firstName || r.lastName)) : [];
  } catch {
    return [];
  }
}

// "John Michael Smith" -> ["John Michael", "Smith"]
export function splitName(full: string | null | undefined): [string, string] {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return [parts[0] ?? "", ""];
  return [parts.slice(0, -1).join(" "), parts[parts.length - 1]];
}
