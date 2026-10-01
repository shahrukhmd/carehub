import "server-only";
import type { Insurance, Patient, PatientDocument } from "@prisma/client";
import { ethnicityLabel, maritalStatusLabel, raceLabel } from "@/lib/format";
import { DOC_FIELDS, parseExtraction, type Confidence } from "@/lib/patient-docs";
import { HOW_HEARD, LANGUAGES } from "@/lib/patient-fields";

// Turns what the reader found in the uploaded documents into a draft for the Add Patient form.

export type InsuranceDraft = Partial<Insurance> & { rank: string };
export type PatientDraft = Partial<Patient> & { insurances?: InsuranceDraft[] };

export type FilledField = { label: string; value: string; from: string; confidence: Confidence };
export type FieldConflict = { label: string; used: string; others: { value: string; from: string }[] };

type Directory = {
  payers: { id: string; name: string }[];
  providers: { id: string; name: string; npi: string | null; isReferring: boolean }[];
};

const RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };
const LABEL = new Map(DOC_FIELDS.map((f) => [f.key, f.label]));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const dateOf = (v: string | undefined) => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T12:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

function matchByName<T extends { name: string }>(list: T[], wanted: string) {
  const w = norm(wanted);
  if (w.length < 3) return undefined;
  return list.find((x) => norm(x.name) === w) ?? list.find((x) => norm(x.name).includes(w) || w.includes(norm(x.name)));
}

// "Dr. Karen Foster, MD" and "Foster, Karen" should both find "Dr. Karen Foster".
function matchProvider(list: Directory["providers"], name: string | undefined, npi?: string) {
  if (npi) {
    const byNpi = list.find((p) => p.npi && p.npi === npi.replace(/\D/g, ""));
    if (byNpi) return byNpi;
  }
  if (!name) return undefined;
  const words = (s: string) => norm(s).split(" ").filter((w) => w.length > 1 && !["dr", "md", "do", "np", "pa", "dpm", "fnp", "aprn", "mr", "mrs", "ms"].includes(w));
  const want = words(name);
  if (want.length < 2) return undefined;
  return list.find((p) => {
    const have = words(p.name);
    return want.every((w) => have.includes(w)) || (have.length >= 2 && have.every((w) => want.includes(w)));
  });
}

function codeFor(labels: Record<string, string>, raw: string | undefined, hints: Record<string, RegExp>) {
  if (!raw) return undefined;
  const direct = Object.entries(labels).find(([, l]) => norm(l) === norm(raw));
  if (direct) return direct[0];
  return Object.entries(hints).find(([, re]) => re.test(raw))?.[0];
}

const RACE_HINTS: Record<string, RegExp> = {
  AMERICAN_INDIAN: /american indian|alaska|native american/i,
  ASIAN: /asian/i,
  BLACK: /black|african/i,
  PACIFIC_ISLANDER: /hawaiian|pacific/i,
  WHITE: /white|caucasian/i,
  DECLINED: /declin|refus|unknown/i,
  OTHER: /other|multi|two or more/i,
};
const ETHNICITY_HINTS: Record<string, RegExp> = { NOT_HISPANIC: /\b(non|not)\b.*(hispanic|latino)/i, HISPANIC: /hispanic|latino/i, DECLINED: /declin|refus|unknown/i };
const MARITAL_HINTS: Record<string, RegExp> = { SINGLE: /single|never/i, MARRIED: /married/i, DIVORCED: /divorc/i, WIDOWED: /widow/i, SEPARATED: /separat/i, DOMESTIC_PARTNER: /partner/i };

export function buildRegistrationDraft(docs: Pick<PatientDocument, "id" | "name" | "extraction">[], dir: Directory) {
  // For every field keep the most confident non-empty value, and remember when documents disagree.
  const best = new Map<string, { value: string; confidence: Confidence; from: string }>();
  const seen = new Map<string, { value: string; from: string }[]>();
  for (const doc of docs) {
    const ex = parseExtraction(doc.extraction);
    if (!ex) continue;
    for (const [key, f] of Object.entries(ex.fields)) {
      const value = (f?.value ?? "").trim();
      if (!value) continue;
      seen.set(key, [...(seen.get(key) ?? []), { value, from: doc.name }]);
      const cur = best.get(key);
      if (!cur || RANK[f.confidence] > RANK[cur.confidence]) best.set(key, { value, confidence: f.confidence, from: doc.name });
    }
  }
  const get = (key: string) => best.get(key)?.value;

  const filled: FilledField[] = [];
  const names: string[] = [];
  const notes: string[] = [];
  // Records that a form field was filled from `key`, so it can be listed and highlighted.
  const used = (key: string, ...formNames: string[]) => {
    const b = best.get(key);
    if (!b) return;
    filled.push({ label: LABEL.get(key) ?? key, value: b.value, from: b.from, confidence: b.confidence });
    names.push(...formNames);
  };
  const text = (key: string, ...formNames: string[]) => {
    const v = get(key);
    if (v) used(key, ...formNames);
    return v;
  };

  const draft: PatientDraft = {
    firstName: text("patient.firstName", "firstName"),
    lastName: text("patient.lastName", "lastName"),
    middleName: text("patient.middleName", "middleName"),
    ssnLast4: text("patient.ssnLast4", "ssn"),
    phone: text("patient.phone", "phone"),
    phone2: text("patient.phone2", "phone2"),
    email: text("patient.email", "email"),
    addressLine1: text("patient.addressLine1", "addressLine1"),
    addressLine2: text("patient.addressLine2", "addressLine2"),
    city: text("patient.city", "city"),
    state: text("patient.state", "state"),
    zip: text("patient.zip", "zip"),
    county: text("patient.county", "county"),
    occupation: text("patient.occupation", "occupation"),
    emergencyContactName: text("patient.emergencyContactName", "emergencyFirstName", "emergencyLastName"),
    emergencyContactPhone: text("patient.emergencyContactPhone", "emergencyContactPhone"),
    emergencyContactRelationship: text("patient.emergencyContactRelationship", "emergencyContactRelationship"),
    pharmacyName: text("pharmacy.name", "pharmacyName"),
    pharmacyPhone: text("pharmacy.phone", "pharmacyPhone"),
    pharmacyFax: text("pharmacy.fax", "pharmacyFax"),
    pharmacyAddress: text("pharmacy.address", "pharmacyAddress"),
    homeHealthCompany: text("homeHealth.company", "homeHealthCompany"),
    homeHealthNurse: text("homeHealth.nurse", "homeHealthNurse"),
  };

  // A second, different phone number in another document becomes the secondary phone.
  if (!draft.phone2 && draft.phone) {
    const other = (seen.get("patient.phone") ?? []).find((v) => v.value.replace(/\D/g, "") !== draft.phone!.replace(/\D/g, ""));
    if (other) {
      draft.phone2 = other.value;
      filled.push({ label: "Second phone", value: other.value, from: other.from, confidence: "medium" });
      names.push("phone2");
    }
  }

  const dob = dateOf(get("patient.dob"));
  if (dob) {
    draft.dob = dob;
    used("patient.dob", "dob");
  }
  const sex = get("patient.sex");
  if (sex === "M" || sex === "F") {
    draft.sex = sex;
    used("patient.sex", "sex");
  }
  const language = get("patient.preferredLanguage");
  if (language) {
    draft.preferredLanguage = LANGUAGES.find((l) => norm(l) === norm(language) || norm(l).startsWith(norm(language))) ?? language;
    used("patient.preferredLanguage", "preferredLanguage");
  }
  const marital = codeFor(maritalStatusLabel, get("patient.maritalStatus"), MARITAL_HINTS);
  if (marital) {
    draft.maritalStatus = marital;
    used("patient.maritalStatus", "maritalStatus");
  }
  const race = codeFor(raceLabel, get("patient.race"), RACE_HINTS);
  if (race) {
    draft.race = race;
    draft.races = race;
    used("patient.race", "races");
  }
  const ethnicity = codeFor(ethnicityLabel, get("patient.ethnicity"), ETHNICITY_HINTS);
  if (ethnicity) {
    draft.ethnicity = ethnicity;
    used("patient.ethnicity", "ethnicity");
  }
  const onset = dateOf(get("referral.onsetDate"));
  if (onset) {
    draft.onsetDate = onset;
    used("referral.onsetDate", "onsetDate");
  }

  // ---- Insurance ----
  const coverage = (prefix: "insurance" | "secondary", rank: "PRIMARY" | "SECONDARY") => {
    const payerName = get(`${prefix}.payerName`);
    const memberId = get(`${prefix}.memberId`);
    if (!payerName && !memberId) return;
    const p = `ins_${rank}_`;
    const ins: InsuranceDraft = { rank };
    const payer = payerName ? matchByName(dir.payers, payerName) : undefined;
    if (payer) {
      ins.payerId = payer.id;
      used(`${prefix}.payerName`, `${p}payerId`);
    } else if (payerName) {
      notes.push(`${rank === "PRIMARY" ? "Primary" : "Secondary"} payer “${payerName}” isn't in the insurance directory — choose the payer by hand, or add it to Directories first.`);
    }
    if (memberId) {
      ins.memberId = memberId;
      used(`${prefix}.memberId`, `${p}memberId`);
    }
    const group = get(`${prefix}.groupNumber`);
    if (group) {
      ins.groupNumber = group;
      used(`${prefix}.groupNumber`, `${p}groupNumber`);
    }
    if (prefix === "insurance") {
      const groupName = get("insurance.groupName") ?? get("insurance.planName");
      if (groupName) {
        ins.groupName = groupName;
        used(get("insurance.groupName") ? "insurance.groupName" : "insurance.planName", `${p}groupName`);
      }
      const copay = Number((get("insurance.copay") ?? "").replace(/[$,\s]/g, ""));
      if (get("insurance.copay") && Number.isFinite(copay) && copay >= 0 && copay < 10_000) {
        ins.copayCents = Math.round(copay * 100);
        used("insurance.copay", `${p}copay`);
      }
      const effective = dateOf(get("insurance.effectiveDate"));
      if (effective) {
        ins.effectiveDate = effective;
        used("insurance.effectiveDate", `${p}effectiveDate`);
      }
      const subscriber = get("insurance.subscriberName");
      const patientFull = norm(`${draft.firstName ?? ""} ${draft.lastName ?? ""}`);
      const isPatient = subscriber && patientFull && norm(subscriber).split(" ").every((w) => patientFull.split(" ").includes(w));
      if (subscriber && !isPatient) {
        const comma = subscriber.includes(",");
        const parts = subscriber.replace(",", " ").split(/\s+/).filter(Boolean);
        ins.insuredFirstName = comma ? parts[1] : parts[0];
        ins.insuredLastName = comma ? parts[0] : parts[parts.length - 1];
        const rel = get("insurance.subscriberRelationship") ?? "";
        ins.relationshipToInsured = /spouse|wife|husband/i.test(rel) ? "01" : /child|son|daughter|dependent/i.test(rel) ? "19" : "G8";
        used("insurance.subscriberName", `${p}insuredFirstName`, `${p}insuredLastName`);
        const subDob = dateOf(get("insurance.subscriberDob"));
        if (subDob) {
          ins.insuredDob = subDob;
          used("insurance.subscriberDob", `${p}insuredDob`);
        }
      }
    }
    draft.insurances = [...(draft.insurances ?? []), ins];
  };
  coverage("insurance", "PRIMARY");
  coverage("secondary", "SECONDARY");

  // ---- Referral, PCP ----
  const external: string[] = [];
  const referralDate = dateOf(get("referral.referralDate"));
  if (referralDate) {
    draft.referralDate = referralDate;
    used("referral.referralDate", "referralDate");
  }
  const refName = get("referral.physicianName");
  const refNpi = get("referral.physicianNpi");
  if (refName || refNpi) {
    const match = matchProvider(dir.providers.filter((p) => p.isReferring), refName, refNpi) ?? matchProvider(dir.providers, refName, refNpi);
    if (match) {
      draft.referringPhysicianId = match.id;
      used(refName ? "referral.physicianName" : "referral.physicianNpi", "referringPhysicianId");
    } else {
      external.push(`Referring physician: ${[refName, refNpi ? `NPI ${refNpi}` : "", get("referral.contactPhone") ? `phone ${get("referral.contactPhone")}` : "", get("referral.contactFax") ? `fax ${get("referral.contactFax")}` : ""].filter(Boolean).join(", ")}`);
      notes.push(`Referring physician “${refName ?? refNpi}” isn't in the provider directory — listed under External providers. Add them to Directories to select them.`);
      used(refName ? "referral.physicianName" : "referral.physicianNpi", "externalProviders");
    }
    draft.howHeard = HOW_HEARD[0];
    names.push("howHeard");
  }
  const pcp = get("pcp.name");
  if (pcp) {
    const match = matchProvider(dir.providers, pcp);
    if (match) {
      draft.primaryCarePhysicianId = match.id;
      used("pcp.name", "primaryCarePhysicianId");
    } else {
      external.push(`PCP: ${[pcp, get("pcp.phone") ? `phone ${get("pcp.phone")}` : "", get("pcp.fax") ? `fax ${get("pcp.fax")}` : ""].filter(Boolean).join(", ")}`);
      used("pcp.name", "externalProviders");
    }
  }
  if (external.length) draft.externalProviders = external.join("\n");

  const noteLines = [
    get("referral.sourceName") ? `Referral source: ${[get("referral.sourceName"), get("referral.contactName"), get("referral.contactPhone"), get("referral.contactFax") ? `fax ${get("referral.contactFax")}` : ""].filter(Boolean).join(" · ")}` : "",
    get("referral.servicesRequested") ? `Services requested: ${get("referral.servicesRequested")}` : "",
    get("referral.diagnoses") ? `Diagnoses: ${get("referral.diagnoses")}` : "",
  ].filter(Boolean);
  if (noteLines.length) {
    draft.registrationNotes = noteLines.join("\n");
    for (const k of ["referral.sourceName", "referral.servicesRequested", "referral.diagnoses"]) if (get(k)) used(k, "registrationNotes");
  }

  // Fields where the documents gave different answers.
  const conflicts: FieldConflict[] = [];
  for (const [key, values] of seen) {
    const chosen = best.get(key)!;
    const others = values.filter((v) => norm(v.value) !== norm(chosen.value));
    if (others.length) conflicts.push({ label: LABEL.get(key) ?? key, used: chosen.value, others });
  }

  // Undefined keys would hide the form's own defaults.
  for (const k of Object.keys(draft) as (keyof PatientDraft)[]) if (draft[k] === undefined) delete draft[k];
  return { draft, filled, names: [...new Set(names)], notes, conflicts };
}
