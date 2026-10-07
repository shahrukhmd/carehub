import "server-only";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { logClaimEvent } from "@/lib/claims";
import { normalizeDate, normalizePhone, normalizeSex } from "@/lib/patient-docs";
import { IMPORT_FIELDS as PATIENT_FIELDS, commitImport as commitPatients, undoImport as undoPatients, validateImport as validatePatients, type ImportRow as PatientRow } from "@/lib/patient-import";

// The import framework: one flow for every kind of file a client or a previous system hands over. Upload,
// propose a mapping (saved per kind, or by column name), validate as a dry run, review, commit in one go,
// undo. Patients were first; coverage, open balances (claims with history) and future appointments join them
// so a new client's AR and schedule start right on day one.

export type ImportKind = "PATIENTS" | "COVERAGE" | "BALANCES" | "APPOINTMENTS";
export const IMPORT_KINDS: Record<ImportKind, { label: string; about: string; step: number }> = {
  PATIENTS: { label: "Patients", about: "Demographics, contact details, primary insurance", step: 1 },
  COVERAGE: { label: "Insurance coverage", about: "Each patient's payers, member and group numbers, ranks and dates", step: 2 },
  BALANCES: { label: "Open balances (claims)", about: "Claims out with payers or patients, with billed, paid, adjusted and submission dates — so aging and follow-up start correctly", step: 3 },
  APPOINTMENTS: { label: "Future appointments", about: "Booked visits from the old schedule", step: 4 },
};

export type Field = { key: string; label: string; required?: boolean; aliases: string[] };
export type Row = { line: number; values: Record<string, string>; status: "READY" | "MATCHED" | "DUPLICATE" | "NEEDS_REVIEW" | "ERROR" | "IMPORTED"; issues: string[]; refs?: Record<string, string> };

const PATIENT_MATCH: Field[] = [
  { key: "mrn", label: "MRN / account # (patient match)", aliases: ["mrn", "chart", "chart #", "chart number", "account", "account #", "account number", "patient id", "external id", "patient account"] },
  { key: "lastName", label: "Last name", aliases: ["last name", "lastname", "last", "lname", "patient last name"] },
  { key: "firstName", label: "First name", aliases: ["first name", "firstname", "first", "fname", "patient first name"] },
  { key: "dob", label: "Date of birth", aliases: ["dob", "date of birth", "birth date", "birthdate"] },
];

export const FIELDS: Record<ImportKind, Field[]> = {
  PATIENTS: PATIENT_FIELDS,
  COVERAGE: [
    ...PATIENT_MATCH,
    { key: "payer", label: "Payer / insurance", required: true, aliases: ["payer", "insurance", "carrier", "plan", "insurance name", "payer name", "insurance company"] },
    { key: "memberId", label: "Member ID", required: true, aliases: ["member id", "memberid", "policy", "policy #", "policy number", "subscriber id", "insurance id", "member #"] },
    { key: "groupNumber", label: "Group #", aliases: ["group", "group #", "group number", "group no"] },
    { key: "rank", label: "Rank (primary / secondary / tertiary)", aliases: ["rank", "priority", "coverage order", "sequence", "primary/secondary"] },
    { key: "effectiveDate", label: "Effective date", aliases: ["effective", "effective date", "start", "start date", "coverage start"] },
    { key: "terminationDate", label: "Termination date", aliases: ["termination", "termination date", "term date", "end", "end date", "coverage end"] },
    { key: "insuredName", label: "Insured name (if not the patient)", aliases: ["insured", "insured name", "subscriber", "subscriber name", "policy holder"] },
    { key: "relationship", label: "Relationship to insured", aliases: ["relationship", "relation", "rel"] },
  ],
  BALANCES: [
    ...PATIENT_MATCH,
    { key: "dos", label: "Date of service", required: true, aliases: ["dos", "date of service", "service date", "visit date", "date"] },
    { key: "payer", label: "Payer (or 'Patient')", required: true, aliases: ["payer", "insurance", "carrier", "plan", "payer name", "responsible party"] },
    { key: "cpt", label: "CPT / HCPCS", required: true, aliases: ["cpt", "hcpcs", "procedure", "procedure code", "code", "service code"] },
    { key: "modifiers", label: "Modifiers", aliases: ["modifier", "modifiers", "mod", "mod1"] },
    { key: "units", label: "Units", aliases: ["units", "qty", "quantity"] },
    { key: "dx", label: "Diagnoses (ICD-10, comma-separated)", aliases: ["dx", "icd", "icd10", "icd-10", "diagnosis", "diagnoses", "dx1"] },
    { key: "billed", label: "Billed amount", required: true, aliases: ["billed", "charge", "charges", "amount", "fee", "charge amount", "billed amount"] },
    { key: "paid", label: "Paid (insurance)", aliases: ["paid", "ins paid", "insurance paid", "payment", "payments", "allowed paid"] },
    { key: "adjusted", label: "Adjusted / written off", aliases: ["adjusted", "adjustment", "adjustments", "write off", "writeoff", "contractual"] },
    { key: "patientPaid", label: "Patient paid", aliases: ["patient paid", "pt paid", "copay paid", "patient payment"] },
    { key: "submitted", label: "Submitted date", aliases: ["submitted", "submitted date", "submission date", "sent", "sent date", "claim date", "first submitted"] },
    { key: "claimStatus", label: "Status (submitted / denied / paid / patient)", aliases: ["status", "claim status", "primary status"] },
    { key: "providerNpi", label: "Rendering provider NPI", aliases: ["npi", "provider npi", "rendering npi", "rendering provider npi"] },
    { key: "providerName", label: "Rendering provider name", aliases: ["provider", "rendering", "rendering provider", "doctor", "physician", "provider name"] },
    { key: "pos", label: "Place of service", aliases: ["pos", "place of service", "facility code"] },
    { key: "externalClaimId", label: "Old system claim #", aliases: ["claim #", "claim number", "claim id", "visit #", "visit id", "ticket", "encounter #"] },
  ],
  APPOINTMENTS: [
    ...PATIENT_MATCH,
    { key: "start", label: "Start date & time", required: true, aliases: ["start", "start time", "appointment", "appointment time", "date/time", "datetime", "appt time", "scheduled"] },
    { key: "date", label: "Date (when time is a separate column)", aliases: ["appointment date", "appt date", "date", "visit date"] },
    { key: "time", label: "Time (separate column)", aliases: ["time", "appt time", "start time only"] },
    { key: "minutes", label: "Duration (minutes)", aliases: ["minutes", "duration", "length", "appt length"] },
    { key: "providerNpi", label: "Provider NPI", aliases: ["npi", "provider npi"] },
    { key: "providerName", label: "Provider name", required: true, aliases: ["provider", "doctor", "physician", "provider name", "resource", "clinician"] },
    { key: "location", label: "Site / location", aliases: ["location", "site", "office", "facility", "clinic"] },
    { key: "visitType", label: "Visit type", aliases: ["visit type", "type", "appt type", "appointment type", "reason", "service"] },
    { key: "notes", label: "Notes", aliases: ["notes", "comment", "comments", "memo"] },
  ],
};

const normHeader = (h: string) => h.toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
export const headerSignature = (headers: string[]) => headers.map(normHeader).join("|");

export function autoMapKind(kind: ImportKind, headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const hs = headers.map(normHeader);
  for (const f of FIELDS[kind]) {
    const i = hs.findIndex((h) => f.aliases.includes(h));
    if (i >= 0 && !Object.values(map).includes(i)) map[f.key] = i;
  }
  if (kind === "PATIENTS") {
    const name = hs.findIndex((h) => ["patient name", "name", "patient"].includes(h));
    if (name >= 0 && map.lastName === undefined && map.firstName === undefined) map.fullName = name;
  }
  return map;
}

// A saved mapping for this practice and kind whose columns match the file wins over name matching.
export async function proposeMapping(practiceId: string, kind: ImportKind, headers: string[]) {
  const sig = headerSignature(headers);
  const saved = await prisma.importMapping.findFirst({ where: { practiceId, kind, signature: sig }, orderBy: { updatedAt: "desc" } });
  if (saved) return { map: JSON.parse(saved.map) as Record<string, number>, savedName: saved.name };
  return { map: autoMapKind(kind, headers), savedName: null };
}

export async function rememberMapping(practiceId: string, kind: ImportKind, headers: string[], map: Record<string, number>, name: string) {
  const signature = headerSignature(headers);
  const existing = await prisma.importMapping.findFirst({ where: { practiceId, kind, signature } });
  if (existing) return prisma.importMapping.update({ where: { id: existing.id }, data: { map: JSON.stringify(map), name } });
  return prisma.importMapping.create({ data: { practiceId, kind, signature, map: JSON.stringify(map), name } });
}

// ---- Patient matching shared by coverage, balances and appointments ----
type PatientLite = { id: string; mrn: string; firstName: string; lastName: string; dob: Date };
const key = (first: string, last: string, dob: string) => `${first.toLowerCase().replace(/[^a-z]/g, "")}|${last.toLowerCase().replace(/[^a-z]/g, "")}|${dob}`;
function matchPatient(v: Record<string, string>, patients: PatientLite[], byMrn: Map<string, PatientLite>, byKey: Map<string, PatientLite>) {
  if (v.mrn && byMrn.has(v.mrn.toLowerCase())) return { patient: byMrn.get(v.mrn.toLowerCase())!, how: "MRN" };
  const dob = normalizeDate(v.dob);
  if (v.firstName && v.lastName && dob) {
    const hit = byKey.get(key(v.firstName, v.lastName, dob));
    if (hit) return { patient: hit, how: "name and date of birth" };
  }
  if (v.lastName && v.firstName) {
    const loose = patients.filter((p) => p.lastName.toLowerCase() === v.lastName.toLowerCase() && p.firstName.toLowerCase().startsWith(v.firstName.toLowerCase().slice(0, 3)));
    if (loose.length === 1) return { patient: loose[0], how: "name only (check it)", review: true };
  }
  return null;
}
async function patientIndex(practiceId: string) {
  const patients = await prisma.patient.findMany({ where: { practiceId }, select: { id: true, mrn: true, firstName: true, lastName: true, dob: true } });
  return { patients, byMrn: new Map(patients.map((p) => [p.mrn.toLowerCase(), p])), byKey: new Map(patients.map((p) => [key(p.firstName, p.lastName, p.dob.toISOString().slice(0, 10)), p])) };
}
const money = (s: string) => {
  const n = Number((s ?? "").replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

// ---- Validate (dry run) ----
export async function validateKind(kind: ImportKind, practiceId: string, table: string[][], mapping: Record<string, number>): Promise<Row[]> {
  if (kind === "PATIENTS") return (await validatePatients(practiceId, table, mapping)) as Row[];
  const [, ...data] = table;
  const idx = await patientIndex(practiceId);
  const payers = await prisma.payer.findMany({ where: { practiceId }, select: { id: true, name: true, payerCode: true, active: true } });
  const findPayer = (name: string) => {
    const n = name.toLowerCase().trim();
    if (!n) return null;
    return payers.find((p) => p.name.toLowerCase() === n || (p.payerCode && p.payerCode.toLowerCase() === n)) ?? payers.find((p) => p.name.toLowerCase().includes(n) || n.includes(p.name.toLowerCase())) ?? null;
  };
  const providers = kind !== "COVERAGE" ? await prisma.renderingProvider.findMany({ where: { practiceId }, select: { id: true, name: true, npi: true, userId: true } }) : [];
  const findProvider = (npi: string, name: string) => {
    if (npi) {
      const p = providers.find((x) => x.npi === npi.replace(/\D/g, ""));
      if (p) return p;
    }
    const n = name.toLowerCase().replace(/[^a-z ]/g, "").replace(/\b(dr|md|do|np|pa)\b/g, "").trim();
    if (!n) return null;
    const words = n.split(/\s+/).filter(Boolean);
    return providers.find((x) => words.every((w) => x.name.toLowerCase().includes(w))) ?? providers.find((x) => words.some((w) => w.length > 2 && x.name.toLowerCase().includes(w))) ?? null;
  };
  const locations = kind === "APPOINTMENTS" ? await prisma.location.findMany({ where: { practiceId }, select: { id: true, name: true } }) : [];
  const visitTypes = kind === "APPOINTMENTS" ? (await prisma.visitType.findMany({ where: { practiceId }, select: { code: true, name: true, durationMin: true } })).map((t) => ({ key: String(t.code), name: t.name, minutes: t.durationMin ?? 30 })) : [];
  const existingCoverage = kind === "COVERAGE" ? await prisma.insurance.findMany({ where: { patient: { practiceId } }, select: { patientId: true, payerId: true, memberId: true } }) : [];
  const existingClaims = kind === "BALANCES" ? await prisma.claim.findMany({ where: { practiceId }, select: { patientId: true, payerId: true, lines: { select: { dosFrom: true, cptCode: true } } } }) : [];
  const existingAppts = kind === "APPOINTMENTS" ? await prisma.appointment.findMany({ where: { practiceId, startsAt: { gte: new Date() } }, select: { patientId: true, startsAt: true } }) : [];
  const seen = new Set<string>();

  return data.map((cells, i) => {
    const get = (k: string) => (mapping[k] !== undefined ? (cells[mapping[k]] ?? "").trim() : "");
    const v: Record<string, string> = {};
    for (const f of FIELDS[kind]) v[f.key] = get(f.key);
    const issues: string[] = [];
    const refs: Record<string, string> = {};
    let status: Row["status"] = "READY";
    const m = matchPatient(v, idx.patients, idx.byMrn, idx.byKey);
    if (!m) {
      issues.push(v.mrn || v.lastName ? `No patient matches ${v.mrn ? `MRN ${v.mrn}` : `${v.lastName}, ${v.firstName} ${v.dob}`} — import patients first` : "No patient identifiers in the row");
      return { line: i + 2, values: v, status: "ERROR", issues, refs };
    }
    refs.patientId = m.patient.id;
    refs.patientName = `${m.patient.lastName}, ${m.patient.firstName}`;
    if (m.review) {
      status = "NEEDS_REVIEW";
      issues.push(`Matched by ${m.how}: ${refs.patientName} (${m.patient.mrn})`);
    } else issues.push(`Patient: ${refs.patientName} (${m.patient.mrn}) by ${m.how}`);

    if (kind === "COVERAGE") {
      const payer = findPayer(v.payer);
      if (!payer) issues.push(`Payer "${v.payer}" is not in the directory — add it under Directories → Insurance, or use its exact name`);
      else {
        refs.payerId = payer.id;
        if (!payer.active) issues.push(`${payer.name} is inactive in the directory`);
      }
      if (!v.memberId) issues.push("Missing member ID");
      const rank = /sec/i.test(v.rank) ? "SECONDARY" : /ter/i.test(v.rank) ? "TERTIARY" : "PRIMARY";
      v.rank = rank;
      for (const k of ["effectiveDate", "terminationDate"]) if (v[k]) { const d = normalizeDate(v[k]); if (d) v[k] = d; else { issues.push(`${k === "effectiveDate" ? "Effective" : "Termination"} date "${v[k]}" not recognised — left blank`); v[k] = ""; } }
      if (payer && v.memberId && existingCoverage.some((c) => c.patientId === m.patient.id && c.payerId === payer.id && c.memberId.toLowerCase() === v.memberId.toLowerCase())) {
        status = "DUPLICATE";
        issues.unshift("This coverage is already on the patient");
      }
      const k = `${m.patient.id}|${payer?.id}|${v.memberId.toLowerCase()}`;
      if (seen.has(k)) { status = "DUPLICATE"; issues.unshift("Repeated earlier in this file"); }
      seen.add(k);
      if (!payer || !v.memberId) status = "ERROR";
    }

    if (kind === "BALANCES") {
      const dos = normalizeDate(v.dos);
      if (!dos) issues.push(`Date of service "${v.dos}" not recognised`);
      else v.dos = dos;
      const selfPay = /^(patient|self|self[- ]pay|pt)$/i.test(v.payer.trim());
      const payer = selfPay ? null : findPayer(v.payer);
      if (!selfPay && !payer) issues.push(`Payer "${v.payer}" is not in the directory`);
      if (payer) refs.payerId = payer.id;
      v.cpt = v.cpt.toUpperCase().replace(/\s/g, "");
      if (!/^[A-Z0-9]{5}$/.test(v.cpt)) issues.push(`"${v.cpt}" is not a 5-character CPT / HCPCS code`);
      const billed = money(v.billed);
      if (billed === null || billed < 0) issues.push(`Billed amount "${v.billed}" is not a dollar amount`);
      else v.billed = String(billed);
      for (const k of ["paid", "adjusted", "patientPaid"]) { const c = v[k] ? money(v[k]) : 0; v[k] = String(c ?? 0); if (c === null) issues.push(`${k} "${v[k]}" is not a dollar amount — treated as 0`); }
      v.units = String(Math.max(1, Math.round(Number(v.units) || 1)));
      if (v.submitted) { const d = normalizeDate(v.submitted); if (d) v.submitted = d; else { issues.push(`Submitted date "${v.submitted}" not recognised`); v.submitted = ""; } }
      const prov = findProvider(v.providerNpi, v.providerName);
      if (prov) { refs.providerId = prov.id; if (prov.userId) refs.providerUserId = prov.userId; else issues.push(`${prov.name} has no CareHub login — the importing user is recorded as the visit's provider`); }
      else issues.push(v.providerName || v.providerNpi ? `Provider "${v.providerName || v.providerNpi}" not found — the importing user is recorded as the visit's provider` : "No provider column — the importing user is recorded as the visit's provider");
      v.pos = v.pos && /^\d{2}$/.test(v.pos) ? v.pos : "11";
      const balance = (billed ?? 0) - Number(v.paid) - Number(v.adjusted) - Number(v.patientPaid);
      v.balance = String(balance);
      const st = v.claimStatus.toLowerCase();
      v.claimStatus = selfPay ? "PATIENT" : /denied|denial/.test(st) ? "DENIED" : /paid|closed/.test(st) && balance <= 0 ? "PAID" : /patient|pt resp|pr/.test(st) ? "PATIENT" : balance <= 0 ? "PAID" : Number(v.paid) > 0 ? "PARTIAL" : "SUBMITTED";
      if (dos && v.cpt && existingClaims.some((c) => c.patientId === m.patient.id && (payer ? c.payerId === payer.id : true) && c.lines.some((l) => l.dosFrom.toISOString().slice(0, 10) === dos && l.cptCode === v.cpt))) {
        status = "DUPLICATE";
        issues.unshift("A claim line with this patient, date of service and code already exists");
      }
      if (!dos || (!selfPay && !payer) || billed === null || !/^[A-Z0-9]{5}$/.test(v.cpt)) status = "ERROR";
    }

    if (kind === "APPOINTMENTS") {
      let start: Date | null = null;
      if (v.start) start = new Date(v.start);
      if ((!start || Number.isNaN(start.getTime())) && v.date) start = new Date(`${normalizeDate(v.date) ?? v.date}T${/^\d{1,2}:\d{2}/.test(v.time) ? v.time.padStart(5, "0") : "09:00"}`);
      if (!start || Number.isNaN(start.getTime())) issues.push(`Start "${v.start || `${v.date} ${v.time}`}" not recognised`);
      else {
        v.start = start.toISOString();
        if (start < new Date()) issues.push("In the past — only future appointments are imported");
      }
      const prov = findProvider(v.providerNpi, v.providerName);
      if (!prov?.userId) issues.push(prov ? `${prov.name} has no CareHub login to book under` : `Provider "${v.providerName || v.providerNpi}" not found`);
      else { refs.providerUserId = prov.userId; refs.providerName = prov.name; }
      const loc = locations.find((l) => l.name.toLowerCase() === v.location.toLowerCase()) ?? locations.find((l) => v.location && l.name.toLowerCase().includes(v.location.toLowerCase())) ?? locations[0];
      if (loc) refs.locationId = loc.id; else issues.push("No site of service exists yet");
      const vt = visitTypes.find((t) => t.name.toLowerCase() === v.visitType.toLowerCase() || t.key.toLowerCase() === v.visitType.toLowerCase()) ?? visitTypes.find((t) => v.visitType && t.name.toLowerCase().includes(v.visitType.toLowerCase())) ?? visitTypes[0];
      if (vt) { refs.visitType = vt.key; if (!v.minutes) v.minutes = String(vt.minutes); } else v.visitType = v.visitType || "FOLLOW_UP";
      v.minutes = String(Math.max(5, Math.round(Number(v.minutes) || 30)));
      if (start && existingAppts.some((a) => a.patientId === m.patient.id && Math.abs(a.startsAt.getTime() - start!.getTime()) < 60_000)) { status = "DUPLICATE"; issues.unshift("Already on the schedule"); }
      if (!start || Number.isNaN(start.getTime()) || start < new Date() || !prov?.userId || !loc) status = "ERROR";
    }
    return { line: i + 2, values: v, status, issues, refs };
  });
}

// ---- Commit ----
export async function commitKind(kind: ImportKind, batchId: string, practiceId: string, userId: string) {
  if (kind === "PATIENTS") return commitPatients(batchId, practiceId, userId);
  const batch = await prisma.importBatch.findFirstOrThrow({ where: { id: batchId, practiceId } });
  if (batch.status !== "PREVIEW") throw new Error("This file was already imported.");
  const rows = JSON.parse(batch.rows) as Row[];
  const created: Record<string, string[]> = {};
  const add = (model: string, id: string) => (created[model] = [...(created[model] ?? []), id]);
  const ok = rows.filter((r) => r.status === "READY" || r.status === "MATCHED" || r.status === "NEEDS_REVIEW");

  if (kind === "COVERAGE") {
    for (const r of ok) {
      const v = r.values;
      if (!r.refs?.patientId || !r.refs.payerId) continue;
      await prisma.insurance.updateMany({ where: { patientId: r.refs.patientId, rank: v.rank, active: true }, data: { active: false, isPrimary: false } });
      const ins = await prisma.insurance.create({
        data: {
          patientId: r.refs.patientId,
          payerId: r.refs.payerId,
          memberId: v.memberId.slice(0, 40),
          groupNumber: v.groupNumber || null,
          rank: v.rank,
          isPrimary: v.rank === "PRIMARY",
          active: !v.terminationDate || new Date(v.terminationDate) >= new Date(),
          effectiveDate: v.effectiveDate ? new Date(`${v.effectiveDate}T12:00:00Z`) : null,
          terminationDate: v.terminationDate ? new Date(`${v.terminationDate}T12:00:00Z`) : null,
          relationshipToInsured: v.insuredName ? "01" : "18",
          insuredLastName: v.insuredName ? v.insuredName.split(",")[0]?.trim() || null : null,
          insuredFirstName: v.insuredName ? v.insuredName.split(",")[1]?.trim() || null : null,
        },
      });
      add("Insurance", ins.id);
      r.status = "IMPORTED";
    }
  }

  if (kind === "BALANCES") {
    // Rows group into one claim per patient + date of service + payer.
    const groups = new Map<string, Row[]>();
    for (const r of ok) {
      const k = `${r.refs?.patientId}|${r.values.dos}|${r.refs?.payerId ?? "PATIENT"}|${r.values.externalClaimId}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    const codes = await prisma.practiceCode.findMany({ where: { practiceId }, select: { type: true, code: true, description: true } });
    const describe = (type: string, code: string) => codes.find((c) => c.type === type && c.code.toUpperCase() === code)?.description ?? code;
    for (const list of groups.values()) {
      const first = list[0];
      const v = first.values;
      const patientId = first.refs!.patientId;
      const payerId = first.refs?.payerId ?? null;
      const payer = payerId ? await prisma.payer.findUnique({ where: { id: payerId }, select: { name: true } }) : null;
      const insurance = payerId ? await prisma.insurance.findFirst({ where: { patientId, payerId }, orderBy: { active: "desc" } }) : null;
      const dos = new Date(`${v.dos}T12:00:00`);
      const encounter = await prisma.encounter.create({
        data: { practiceId, patientId, providerId: first.refs?.providerUserId ?? userId, date: dos, type: "BILLING_ONLY", status: "BILLED", billingStatus: "CLAIM_CREATED_PRIMARY", placeOfService: v.pos, chiefComplaint: `Migrated from the previous system${v.externalClaimId ? ` (claim ${v.externalClaimId})` : ""}.`, finalizedAt: dos },
      });
      add("Encounter", encounter.id);
      const dxCodes = [...new Set(list.flatMap((r) => r.values.dx.split(/[,;\s]+/).map((d) => d.trim().toUpperCase()).filter((d) => /^[A-Z][0-9][0-9A-Z](\.?[0-9A-Z]{1,4})?$/.test(d))))].slice(0, 12);
      const dxIds: string[] = [];
      for (const [i, code] of dxCodes.entries()) dxIds.push((await prisma.encounterDiagnosis.create({ data: { encounterId: encounter.id, icd10: code, description: describe("ICD10", code), priority: i + 1 } })).id);
      const billed = list.reduce((s, r) => s + Number(r.values.billed), 0);
      const paid = list.reduce((s, r) => s + Number(r.values.paid), 0);
      const adjusted = list.reduce((s, r) => s + Number(r.values.adjusted) + Number(r.values.patientPaid), 0);
      const status = v.claimStatus === "PATIENT" ? "PARTIAL" : v.claimStatus;
      const claim = await prisma.claim.create({
        data: {
          practiceId,
          encounterId: encounter.id,
          patientId,
          payerRank: "PRIMARY",
          insuranceId: insurance?.id ?? null,
          payerId,
          payerName: payer?.name ?? "Patient",
          status: payerId ? status : "PARTIAL",
          placeOfService: v.pos,
          renderingProviderId: first.refs?.providerId ?? null,
          patientAccountNumber: v.externalClaimId || null,
          billedCents: billed,
          paidCents: paid,
          adjustedCents: adjusted,
          balanceResponsibility: v.claimStatus === "PATIENT" || !payerId ? "PATIENT" : "INSURANCE",
          submittedAt: v.submitted ? new Date(`${v.submitted}T12:00:00`) : dos,
          statusNote: `Migrated balance${v.externalClaimId ? ` · old claim ${v.externalClaimId}` : ""}`,
          diagnoses: { create: dxCodes.map((code, i) => ({ sequence: i, icd10: code, description: describe("ICD10", code) })) },
          lines: {
            create: list.map((r, i) => ({
              lineNumber: i + 1,
              dosFrom: dos,
              dosTo: dos,
              placeOfService: r.values.pos,
              cptCode: r.values.cpt,
              modifiers: r.values.modifiers ? r.values.modifiers.toUpperCase().split(/[\s,]+/).filter(Boolean).slice(0, 4).join(",") : null,
              units: Number(r.values.units),
              chargeCents: Number(r.values.billed),
              paidCents: Number(r.values.paid),
              adjustedCents: Number(r.values.adjusted) + Number(r.values.patientPaid),
              pointers: dxCodes.length ? "A" : "",
            })),
          },
        },
      });
      add("Claim", claim.id);
      await prisma.charge.createMany({ data: list.map((r) => ({ practiceId, encounterId: encounter.id, cptCode: r.values.cpt, description: describe("CPT", r.values.cpt), units: Number(r.values.units), amountCents: Number(r.values.billed), modifiers: r.values.modifiers || null, placeOfService: r.values.pos, diagnosisPointers: dxIds[0] ?? null })) });
      await logClaimEvent(claim.id, userId, "NOTE", { note: `Migrated from the previous system by import (${batch.fileName})` });
      for (const r of list) r.status = "IMPORTED";
    }
  }

  if (kind === "APPOINTMENTS") {
    for (const r of ok) {
      const v = r.values;
      if (!r.refs?.patientId || !r.refs.providerUserId || !r.refs.locationId) continue;
      const startsAt = new Date(v.start);
      const a = await prisma.appointment.create({
        data: { practiceId, patientId: r.refs.patientId, providerId: r.refs.providerUserId, locationId: r.refs.locationId, startsAt, endsAt: new Date(startsAt.getTime() + Number(v.minutes) * 60_000), visitType: r.refs.visitType ?? v.visitType, status: "SCHEDULED", reason: [v.notes, "Migrated from the previous schedule"].filter(Boolean).join(" · ") },
      });
      add("Appointment", a.id);
      r.status = "IMPORTED";
    }
  }

  const n = Object.values(created).reduce((s, ids) => s + ids.length, 0);
  await prisma.importBatch.update({ where: { id: batch.id }, data: { status: "IMPORTED", rows: JSON.stringify(rows), createdIds: JSON.stringify(created), createdCount: ok.filter((r) => r.status === "IMPORTED").length, skippedCount: rows.length - ok.filter((r) => r.status === "IMPORTED").length, importedAt: new Date() } });
  await logAudit(practiceId, userId, `IMPORT_${kind}`, "ImportBatch", batch.id, `${n} records from ${batch.fileName}`);
  return n;
}

// ---- Undo ----
export async function undoKind(kind: ImportKind, batchId: string, practiceId: string, userId: string) {
  if (kind === "PATIENTS") return undoPatients(batchId, practiceId, userId);
  const batch = await prisma.importBatch.findFirstOrThrow({ where: { id: batchId, practiceId, status: "IMPORTED" } });
  const created = JSON.parse(batch.createdIds) as Record<string, string[]>;
  let removed = 0;
  let kept = 0;
  if (created.Insurance?.length) {
    const untouched = await prisma.insurance.findMany({ where: { id: { in: created.Insurance }, claims: { none: {} } }, select: { id: true } });
    removed += (await prisma.insurance.deleteMany({ where: { id: { in: untouched.map((x) => x.id) } } })).count;
    kept += created.Insurance.length - untouched.length;
  }
  if (created.Claim?.length) {
    const untouched = await prisma.claim.findMany({ where: { id: { in: created.Claim }, applications: { none: {} }, denials: { none: {} }, followUps: { none: {} } }, select: { id: true, encounterId: true } });
    removed += (await prisma.claim.deleteMany({ where: { id: { in: untouched.map((x) => x.id) } } })).count;
    await prisma.encounter.deleteMany({ where: { id: { in: untouched.map((x) => x.encounterId) }, claims: { none: {} } } });
    kept += created.Claim.length - untouched.length;
  }
  if (created.Appointment?.length) {
    const untouched = await prisma.appointment.findMany({ where: { id: { in: created.Appointment }, encounter: null, status: "SCHEDULED" }, select: { id: true } });
    removed += (await prisma.appointment.deleteMany({ where: { id: { in: untouched.map((x) => x.id) } } })).count;
    kept += created.Appointment.length - untouched.length;
  }
  await prisma.importBatch.update({ where: { id: batch.id }, data: { status: kept ? "IMPORTED" : "UNDONE" } });
  await logAudit(practiceId, userId, "UNDO_IMPORT", "ImportBatch", batch.id, `${removed} removed${kept ? `, ${kept} kept (already in use)` : ""}`);
  return { removed, kept };
}

// The onboarding toolkit: where each step stands for this practice.
export async function migrationProgress(practiceId: string) {
  const [patients, coverage, claims, appts, batches] = await Promise.all([
    prisma.patient.count({ where: { practiceId } }),
    prisma.insurance.count({ where: { patient: { practiceId } } }),
    prisma.claim.count({ where: { practiceId, statusNote: { startsWith: "Migrated balance" } } }),
    prisma.appointment.count({ where: { practiceId, startsAt: { gte: new Date() } } }),
    prisma.importBatch.groupBy({ by: ["kind"], where: { practiceId, status: "IMPORTED" }, _count: { _all: true } }),
  ]);
  const done = (k: string) => batches.find((b) => b.kind === k)?._count._all ?? 0;
  return { PATIENTS: { count: patients, batches: done("PATIENTS") }, COVERAGE: { count: coverage, batches: done("COVERAGE") }, BALANCES: { count: claims, batches: done("BALANCES") }, APPOINTMENTS: { count: appts, batches: done("APPOINTMENTS") } };
}

export type { PatientRow };
export { normalizePhone, normalizeSex };
