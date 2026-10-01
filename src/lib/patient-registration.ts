import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { raceLabel, ethnicityLabel, US_STATES } from "@/lib/format";
import { PAYER_RANKS } from "@/lib/claim-format";
import { getUploadedFile, saveUpload } from "@/lib/storage";
import {
  communicationLabel,
  genderIdentityLabel,
  guarantorRelationshipLabel,
  medicareAdmissionLabel,
  phoneTypeLabel,
  pronounLabel,
  sexLabel,
  sexualOrientationLabel,
  yesNoUnknownLabel,
} from "@/lib/patient-fields";

// Reads the Add / Edit Patient form (identification, contact, admission, care providers, insurance, billing, notes, photo).

export class RegistrationError extends Error {}

const text = (fd: FormData, key: string, max = 200) => String(fd.get(key) ?? "").trim().slice(0, max) || null;
const flag = (fd: FormData, key: string) => fd.get(key) === "on";
const oneOf = (fd: FormData, key: string, allowed: Record<string, string> | readonly string[]) => {
  const v = text(fd, key);
  return v && (Array.isArray(allowed) ? allowed.includes(v) : v in allowed) ? v : null;
};

function date(fd: FormData, key: string, label: string) {
  const v = text(fd, key);
  if (!v) return null;
  const d = new Date(`${v}T12:00:00`);
  if (Number.isNaN(d.getTime())) throw new RegistrationError(`${label}: enter a valid date.`);
  return d;
}

function cents(fd: FormData, key: string, label: string) {
  const v = text(fd, key);
  if (!v) return null;
  const n = Number(v.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new RegistrationError(`${label}: enter a dollar amount.`);
  return Math.round(n * 100);
}

function address(fd: FormData, prefix: string, withCounty = true) {
  const a = {
    line1: text(fd, `${prefix}Line1`),
    line2: text(fd, `${prefix}Line2`),
    city: text(fd, `${prefix}City`, 80),
    state: oneOf(fd, `${prefix}State`, US_STATES),
    zip: text(fd, `${prefix}Zip`, 10),
    ...(withCounty ? { county: text(fd, `${prefix}County`, 60) } : {}),
  };
  return Object.values(a).some(Boolean) ? JSON.stringify(a) : null;
}

async function providerId(fd: FormData, key: string, practiceId: string, label: string) {
  const id = text(fd, key);
  if (!id) return null;
  if (!(await prisma.renderingProvider.findFirst({ where: { id, practiceId }, select: { id: true } }))) throw new RegistrationError(`${label} wasn't found in the provider directory.`);
  return id;
}

async function locationId(fd: FormData, key: string, practiceId: string, label: string) {
  const id = text(fd, key);
  if (!id) return null;
  if (!(await prisma.location.findFirst({ where: { id, practiceId }, select: { id: true } }))) throw new RegistrationError(`${label} wasn't found.`);
  return id;
}

export async function readPatientForm(fd: FormData, practiceId: string) {
  const firstName = text(fd, "firstName", 80);
  const lastName = text(fd, "lastName", 80);
  if (!firstName || !lastName) throw new RegistrationError("First and last name are required.");
  const dob = date(fd, "dob", "Date of birth");
  if (!dob) throw new RegistrationError("Date of birth is required.");
  if (dob.getTime() > Date.now()) throw new RegistrationError("Date of birth can't be in the future.");
  const sex = oneOf(fd, "sex", sexLabel);
  if (!sex) throw new RegistrationError("Sex is required.");

  const races = fd.getAll("races").map(String).filter((r) => r in raceLabel);
  const noEmail = flag(fd, "noEmail");
  const email = noEmail ? null : text(fd, "email");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new RegistrationError("Email address doesn't look right.");
  const autoAccident = flag(fd, "autoAccident");

  const reps = [0, 1, 2]
    .map((i) => ({ firstName: text(fd, `rep_${i}_first`, 60) ?? "", lastName: text(fd, `rep_${i}_last`, 60) ?? "" }))
    .filter((r) => r.firstName || r.lastName);
  const emergencyName = [text(fd, "emergencyFirstName", 60), text(fd, "emergencyLastName", 60)].filter(Boolean).join(" ") || null;
  const guarantorRelationship = oneOf(fd, "guarantorRelationship", guarantorRelationshipLabel);
  const self = !guarantorRelationship || guarantorRelationship === "SELF";

  const data = {
    // Identification
    firstName,
    lastName,
    preferredName: text(fd, "preferredName", 80),
    middleName: text(fd, "middleName", 80),
    suffix: text(fd, "suffix", 20),
    dob,
    sex,
    genderIdentity: oneOf(fd, "genderIdentity", genderIdentityLabel),
    sexualOrientation: oneOf(fd, "sexualOrientation", sexualOrientationLabel),
    pronoun: oneOf(fd, "pronoun", pronounLabel),
    race: races[0] ?? null,
    races: races.join(",") || null,
    ethnicity: oneOf(fd, "ethnicity", ethnicityLabel),
    religion: text(fd, "religion", 60),
    tribalAffiliation: text(fd, "tribalAffiliation", 160),
    maritalStatus: text(fd, "maritalStatus", 30),
    employmentStatus: text(fd, "employmentStatus", 30),
    smokingStatus: text(fd, "smokingStatus", 30),
    preferredLanguage: text(fd, "preferredLanguage", 60),
    interpreterNeeded: flag(fd, "interpreterNeeded"),
    preferredCommunication: oneOf(fd, "preferredCommunication", communicationLabel),
    careCenterId: await locationId(fd, "careCenterId", practiceId, "Care center"),
    previousFirstName: text(fd, "previousFirstName", 80),
    previousMiddleName: text(fd, "previousMiddleName", 80),
    previousLastName: text(fd, "previousLastName", 80),
    nameChangedAt: date(fd, "nameChangedAt", "Date name was changed"),
    occupation: text(fd, "occupation", 100),
    occupationIndustry: text(fd, "occupationIndustry", 100),
    // Contact
    phone: text(fd, "phone", 30),
    phoneType: oneOf(fd, "phoneType", phoneTypeLabel),
    phone2: text(fd, "phone2", 30),
    phone2Type: oneOf(fd, "phone2Type", phoneTypeLabel),
    email,
    noEmail,
    currentAddress: text(fd, "currentAddress") === "SECONDARY" ? "SECONDARY" : "PRIMARY",
    addressLine1: text(fd, "addressLine1"),
    addressLine2: text(fd, "addressLine2"),
    city: text(fd, "city", 80),
    state: oneOf(fd, "state", US_STATES),
    zip: text(fd, "zip", 10),
    county: text(fd, "county", 60),
    secondaryAddress: address(fd, "secondary"),
    previousAddress: address(fd, "previous"),
    // Admission
    siteOfServiceId: await locationId(fd, "siteOfServiceId", practiceId, "Site of service"),
    admissionDate: date(fd, "admissionDate", "Admission date"),
    consult: flag(fd, "consult"),
    palliativeCare: flag(fd, "palliativeCare"),
    medicareAdmission: oneOf(fd, "medicareAdmission", medicareAdmissionLabel),
    nonWoundDiagnosis: flag(fd, "nonWoundDiagnosis"),
    howHeard: text(fd, "howHeard", 80),
    onsetDate: date(fd, "onsetDate", "Onset of symptoms"),
    autoAccident,
    autoAccidentState: autoAccident ? oneOf(fd, "autoAccidentState", US_STATES) : null,
    autoAccidentDate: autoAccident ? date(fd, "autoAccidentDate", "Accident date") : null,
    // Care providers and instructions
    woundCarePhysicianId: await providerId(fd, "woundCarePhysicianId", practiceId, "Wound care physician"),
    primaryCarePhysicianId: await providerId(fd, "primaryCarePhysicianId", practiceId, "Primary care physician"),
    supervisingPhysicianId: await providerId(fd, "supervisingPhysicianId", practiceId, "Supervising physician"),
    referringPhysicianId: await providerId(fd, "referringPhysicianId", practiceId, "Referring physician"),
    referralDate: date(fd, "referralDate", "Referral date"),
    externalProviders: text(fd, "externalProviders", 1000),
    pharmacyName: text(fd, "pharmacyName", 120),
    pharmacyPhone: text(fd, "pharmacyPhone", 30),
    pharmacyFax: text(fd, "pharmacyFax", 30),
    pharmacyAddress: text(fd, "pharmacyAddress"),
    emergencyContactName: emergencyName,
    emergencyContactRelationship: text(fd, "emergencyContactRelationship", 60),
    emergencyContactGuardian: flag(fd, "emergencyContactGuardian"),
    emergencyContactGuardianAdLitem: flag(fd, "emergencyContactGuardianAdLitem"),
    emergencyContactEmail: text(fd, "emergencyContactEmail"),
    emergencyContactPhone: text(fd, "emergencyContactPhone", 30),
    emergencyContactAddress: address(fd, "emergency", false),
    motherFirstName: text(fd, "motherFirstName", 80),
    motherMaidenName: text(fd, "motherMaidenName", 80),
    homeHealthNurse: text(fd, "homeHealthNurse", 100),
    homeHealthCompany: text(fd, "homeHealthCompany", 120),
    portalRepresentatives: reps.length ? JSON.stringify(reps) : null,
    // Billing
    guarantorRelationship,
    guarantorName: self ? null : text(fd, "guarantorName", 120),
    guarantorPhone: self ? null : text(fd, "guarantorPhone", 30),
    guarantorAddress: self ? null : text(fd, "guarantorAddress"),
    // Notes
    registrationNotes: text(fd, "registrationNotes", 4000),
  } satisfies Prisma.PatientUncheckedUpdateInput;

  // A new number replaces the one on file; leaving the box empty keeps it.
  const ssn = (text(fd, "ssn", 20) ?? "").replace(/\D/g, "");
  if (ssn && ssn.length !== 9 && ssn.length !== 4) throw new RegistrationError("Social Security Number must be 9 digits (or just the last 4).");
  return { ...data, ...(ssn ? { ssnLast4: ssn.slice(-4) } : flag(fd, "ssnClear") ? { ssnLast4: null } : {}) };
}

// One coverage block per rank. A block with a payer is saved; a block left empty retires the coverage it showed.
export async function saveInsuranceBlocks(patientId: string, practiceId: string, fd: FormData) {
  for (const rank of PAYER_RANKS) {
    const p = `ins_${rank}_`;
    if (!fd.has(`${p}present`)) continue;
    const existing = await prisma.insurance.findFirst({ where: { patientId, rank, active: true }, orderBy: { id: "desc" } });
    const payerId = text(fd, `${p}payerId`);
    if (!payerId) {
      if (existing) await prisma.insurance.update({ where: { id: existing.id }, data: { active: false, isPrimary: false } });
      continue;
    }
    const label = rank.charAt(0) + rank.slice(1).toLowerCase();
    if (!(await prisma.payer.findFirst({ where: { id: payerId, practiceId }, select: { id: true } }))) throw new RegistrationError(`${label} insurance: payer not found.`);
    const holder = text(fd, `${p}holder`) !== "no";
    const insuredFirstName = holder ? null : text(fd, `${p}insuredFirstName`, 80);
    const insuredLastName = holder ? null : text(fd, `${p}insuredLastName`, 80);
    if (!holder && !insuredFirstName) throw new RegistrationError(`${label} insurance: insured first name is required when the patient isn't the policy holder.`);
    if (!holder && !insuredLastName) throw new RegistrationError(`${label} insurance: insured last name is required when the patient isn't the policy holder.`);
    const percent = text(fd, `${p}coveragePercent`);
    const pct = percent ? Number(percent.replace(/%/g, "")) : null;
    if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) throw new RegistrationError(`${label} insurance: percent coverage must be between 0 and 100.`);
    const relationship = text(fd, `${p}relationship`);
    const data = {
      payerId,
      rank,
      isPrimary: rank === "PRIMARY",
      active: true,
      memberId: text(fd, `${p}memberId`, 60) ?? existing?.memberId ?? "PENDING",
      groupName: text(fd, `${p}groupName`, 100),
      groupNumber: text(fd, `${p}groupNumber`, 60),
      copayCents: cents(fd, `${p}copay`, `${label} copay`),
      relationshipToInsured: holder ? "18" : relationship && ["01", "19", "G8"].includes(relationship) ? relationship : "G8",
      insuredFirstName,
      insuredMiddleName: holder ? null : text(fd, `${p}insuredMiddleName`, 80),
      insuredLastName,
      insuredDob: holder ? null : date(fd, `${p}insuredDob`, `${label} insured date of birth`),
      insuredSex: holder ? null : oneOf(fd, `${p}insuredSex`, sexLabel),
      insuredAddressLine1: holder ? null : text(fd, `${p}insuredAddress`),
      insuredCity: holder ? null : text(fd, `${p}insuredCity`, 80),
      insuredState: holder ? null : oneOf(fd, `${p}insuredState`, US_STATES),
      insuredZip: holder ? null : text(fd, `${p}insuredZip`, 10),
      insuredPhone: holder ? null : text(fd, `${p}insuredPhone`, 30),
      effectiveDate: date(fd, `${p}effectiveDate`, `${label} effective date`),
      terminationDate: date(fd, `${p}terminationDate`, `${label} termination date`),
      deductibleCents: cents(fd, `${p}deductible`, `${label} deductible amount`),
      deductibleMetCents: cents(fd, `${p}deductibleMet`, `${label} deductible met`),
      coveragePercent: pct === null ? null : Math.round(pct),
      verifiedAt: date(fd, `${p}verifiedAt`, `${label} verification date`),
      verifiedWith: text(fd, `${p}verifiedWith`, 100),
      authRequired: oneOf(fd, `${p}authRequired`, yesNoUnknownLabel),
      priorAuthRequired: oneOf(fd, `${p}priorAuthRequired`, yesNoUnknownLabel),
    };
    if (existing) await prisma.insurance.update({ where: { id: existing.id }, data });
    else await prisma.insurance.create({ data: { ...data, patientId } });
  }
}

// Patient photo (PNG or JPG). Returns the stored path, null to remove, or undefined to leave as is.
export async function readPatientPhoto(fd: FormData, practiceId: string) {
  const file = getUploadedFile(fd, "photo");
  if (file) {
    if (!["image/png", "image/jpeg"].includes(file.type)) throw new RegistrationError("The photo must be a PNG or JPG image.");
    try {
      return (await saveUpload(file, practiceId)).filePath;
    } catch (err) {
      throw new RegistrationError(err instanceof Error ? err.message : "The photo couldn't be saved.");
    }
  }
  return flag(fd, "photoRemove") ? null : undefined;
}
