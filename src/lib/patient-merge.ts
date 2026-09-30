import "server-only";
import type { Patient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

// Duplicate chart detection and merging.

const norm = (v: string | null | undefined) => (v ?? "").toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "").slice(-10);
const day = (d: Date) => d.toISOString().slice(0, 10);
export const pairKey = (a: string, b: string) => [a, b].sort().join("|");

export type DuplicatePair = { a: Patient; b: Patient; score: number; reasons: string[] };

export async function findDuplicates(practiceId: string): Promise<DuplicatePair[]> {
  const [patients, dismissed] = await Promise.all([
    prisma.patient.findMany({ where: { practiceId }, orderBy: { createdAt: "asc" } }),
    prisma.duplicateDismissal.findMany({ where: { practiceId }, select: { pairKey: true } }),
  ]);
  const skip = new Set(dismissed.map((d) => d.pairKey));
  const byDob = new Map<string, Patient[]>();
  const byName = new Map<string, Patient[]>();
  for (const p of patients) {
    byDob.set(day(p.dob), [...(byDob.get(day(p.dob)) ?? []), p]);
    const n = norm(p.firstName) + "|" + norm(p.lastName);
    byName.set(n, [...(byName.get(n) ?? []), p]);
  }
  const pairs = new Map<string, DuplicatePair>();
  const consider = (a: Patient, b: Patient) => {
    if (a.id === b.id) return;
    const key = pairKey(a.id, b.id);
    if (skip.has(key) || pairs.has(key)) return;
    const reasons: string[] = [];
    let score = 0;
    const add = (points: number, why: string) => {
      score += points;
      reasons.push(why);
    };
    const sameDob = day(a.dob) === day(b.dob);
    const sameLast = norm(a.lastName) === norm(b.lastName);
    const sameFirst = norm(a.firstName) === norm(b.firstName);
    const firstInitial = norm(a.firstName)[0] === norm(b.firstName)[0];
    // Swapped first/last names (a common data-entry mistake).
    const swapped = norm(a.firstName) === norm(b.lastName) && norm(a.lastName) === norm(b.firstName);
    if (sameDob) add(40, "Same date of birth");
    if (sameLast && sameFirst) add(40, "Same name");
    else if (swapped) add(35, "First and last names swapped");
    else if (sameLast && firstInitial) add(25, "Same last name, first initial");
    else if (sameFirst) add(10, "Same first name");
    if (digits(a.phone) && digits(a.phone) === digits(b.phone)) add(20, "Same phone");
    if (a.email && a.email.toLowerCase() === b.email?.toLowerCase()) add(20, "Same email");
    if (a.zip && a.zip === b.zip && norm(a.addressLine1) && norm(a.addressLine1) === norm(b.addressLine1)) add(10, "Same address");
    // Different sex with an otherwise weak match is usually two people.
    if (a.sex && b.sex && a.sex !== b.sex) score -= 20;
    if (score >= 60) pairs.set(key, { a, b, score: Math.min(score, 100), reasons });
  };
  for (const group of [...byDob.values(), ...byName.values()]) {
    if (group.length < 2 || group.length > 50) continue;
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) consider(group[i], group[j]);
  }
  return [...pairs.values()].sort((x, y) => y.score - x.score);
}

// Fields copied from the duplicate when the surviving chart has them blank.
const FILL: (keyof Patient)[] = [
  "phone",
  "email",
  "addressLine1",
  "city",
  "state",
  "zip",
  "preferredLanguage",
  "referringPhysicianId",
  "race",
  "ethnicity",
  "maritalStatus",
  "employmentStatus",
  "smokingStatus",
  "emergencyContactName",
  "emergencyContactPhone",
  "emergencyContactRelationship",
  "guarantorName",
  "guarantorRelationship",
  "guarantorPhone",
  "guarantorPatientId",
];

export async function mergePatients(practiceId: string, keepId: string, mergeId: string, userId: string) {
  if (keepId === mergeId) throw new Error("Pick two different charts.");
  const [keep, dup] = await Promise.all([
    prisma.patient.findFirst({ where: { id: keepId, practiceId } }),
    prisma.patient.findFirst({ where: { id: mergeId, practiceId } }),
  ]);
  if (!keep || !dup) throw new Error("Patient not found.");
  const fill: Partial<Record<keyof Patient, unknown>> = {};
  for (const f of FILL) if ((keep[f] === null || keep[f] === "") && dup[f] !== null && dup[f] !== "" && !(f === "guarantorPatientId" && dup[f] === keep.id)) fill[f] = dup[f];
  const move = { where: { patientId: dup.id }, data: { patientId: keep.id } };
  // Insurance ranks: the duplicate's policies come over as inactive if the kept chart already has that rank.
  const keepRanks = new Set((await prisma.insurance.findMany({ where: { patientId: keep.id, active: true }, select: { rank: true } })).map((i) => i.rank));
  const counts = await prisma.$transaction(async (tx) => {
    const c: Record<string, number> = {};
    const run = async (name: string, p: Promise<{ count: number }>) => {
      c[name] = (await p).count;
    };
    await run("insurances (inactive)", tx.insurance.updateMany({ where: { patientId: dup.id, rank: { in: [...keepRanks] } }, data: { patientId: keep.id, active: false, isPrimary: false } }));
    await run("insurances", tx.insurance.updateMany(move));
    await run("appointments", tx.appointment.updateMany(move));
    await run("visits", tx.encounter.updateMany(move));
    await run("claims", tx.claim.updateMany(move));
    await run("statements", tx.statement.updateMany(move));
    await run("allergies", tx.allergy.updateMany(move));
    await run("problems", tx.problem.updateMany(move));
    await run("medications", tx.medication.updateMany(move));
    await run("prescriptions", tx.prescription.updateMany(move));
    await run("immunizations", tx.immunization.updateMany(move));
    await run("lab orders", tx.labOrder.updateMany(move));
    await run("wounds", tx.wound.updateMany(move));
    await run("eligibility checks", tx.eligibilityCheck.updateMany(move));
    await run("intake cases", tx.intakeCase.updateMany(move));
    await run("documents", tx.patientDocument.updateMany(move));
    await run("form requests", tx.intakeRequest.updateMany(move));
    await run("surveys", tx.surveyResponse.updateMany(move));
    await run("recalls", tx.recall.updateMany(move));
    await run("care-gap notes", tx.careRuleOverride.updateMany(move));
    await run("messages", tx.messageLog.updateMany(move));
    await run("faxes", tx.fax.updateMany(move));
    await run("dependents", tx.patient.updateMany({ where: { guarantorPatientId: dup.id, id: { not: keep.id } }, data: { guarantorPatientId: keep.id } }));
    await tx.patient.update({ where: { id: keep.id }, data: fill as never });
    await tx.patient.delete({ where: { id: dup.id } });
    return c;
  }, { timeout: 30_000 });
  const moved = Object.entries(counts)
    .filter(([, n]) => n)
    .map(([k, n]) => `${n} ${k}`)
    .join(", ");
  await logAudit(practiceId, userId, "MERGE_PATIENTS", "Patient", keep.id, `Merged ${dup.lastName}, ${dup.firstName} (MRN ${dup.mrn}) into MRN ${keep.mrn}${moved ? ` — moved ${moved}` : ""}`);
  return { moved, filled: Object.keys(fill) };
}
