import "server-only";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { normalizeDate, normalizePhone, normalizeSex } from "@/lib/patient-docs";

// Bulk patient import from another system's CSV export: column mapping, validation, duplicate check, undo.

export const IMPORT_FIELDS: { key: string; label: string; required?: boolean; aliases: string[] }[] = [
  { key: "lastName", label: "Last name", required: true, aliases: ["last name", "lastname", "last", "lname", "surname", "family name", "patient last name"] },
  { key: "firstName", label: "First name", required: true, aliases: ["first name", "firstname", "first", "fname", "given name", "patient first name"] },
  { key: "dob", label: "Date of birth", required: true, aliases: ["dob", "date of birth", "birth date", "birthdate", "birthday", "d.o.b."] },
  { key: "sex", label: "Sex", aliases: ["sex", "gender", "birth sex"] },
  { key: "mrn", label: "MRN / account #", aliases: ["mrn", "chart", "chart #", "chart number", "account", "account #", "account number", "patient id", "external id", "id"] },
  { key: "phone", label: "Phone", aliases: ["phone", "mobile", "cell", "cell phone", "mobile phone", "home phone", "phone number", "telephone"] },
  { key: "email", label: "Email", aliases: ["email", "e-mail", "email address"] },
  { key: "addressLine1", label: "Street address", aliases: ["address", "street", "address1", "address 1", "address line 1", "street address"] },
  { key: "city", label: "City", aliases: ["city", "town"] },
  { key: "state", label: "State", aliases: ["state", "st", "province"] },
  { key: "zip", label: "ZIP", aliases: ["zip", "zip code", "zipcode", "postal", "postal code"] },
  { key: "payer", label: "Primary insurance", aliases: ["insurance", "primary insurance", "payer", "carrier", "insurance name", "plan", "insurance company"] },
  { key: "memberId", label: "Member ID", aliases: ["member id", "memberid", "policy", "policy #", "policy number", "subscriber id", "insurance id", "member #"] },
  { key: "groupNumber", label: "Group #", aliases: ["group", "group #", "group number", "group no"] },
];

export type ImportRow = { line: number; values: Record<string, string>; status: "READY" | "DUPLICATE" | "ERROR" | "IMPORTED"; issues: string[]; payerId?: string | null };

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === "," || ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const normHeader = (h: string) => h.toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();

export function autoMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const hs = headers.map(normHeader);
  for (const f of IMPORT_FIELDS) {
    const i = hs.findIndex((h) => f.aliases.includes(h));
    if (i >= 0 && !Object.values(map).includes(i)) map[f.key] = i;
  }
  // "Patient Name" as "Last, First" in one column.
  const name = hs.findIndex((h) => ["patient name", "name", "patient"].includes(h));
  if (name >= 0 && map.lastName === undefined && map.firstName === undefined) map.fullName = name;
  return map;
}

const nameKey = (first: string, last: string, dob: string) => `${first.toLowerCase().replace(/[^a-z]/g, "")}|${last.toLowerCase().replace(/[^a-z]/g, "")}|${dob}`;

export async function validateImport(practiceId: string, table: string[][], mapping: Record<string, number>): Promise<ImportRow[]> {
  const [, ...data] = table;
  const [existing, payers] = await Promise.all([
    prisma.patient.findMany({ where: { practiceId }, select: { firstName: true, lastName: true, dob: true, mrn: true } }),
    prisma.payer.findMany({ where: { practiceId, active: true }, select: { id: true, name: true, payerCode: true } }),
  ]);
  const existingKeys = new Set(existing.map((p) => nameKey(p.firstName, p.lastName, p.dob.toISOString().slice(0, 10))));
  const existingMrns = new Set(existing.map((p) => p.mrn.toLowerCase()));
  const seen = new Set<string>();
  return data.map((cells, idx) => {
    const get = (k: string) => (mapping[k] !== undefined ? (cells[mapping[k]] ?? "").trim() : "");
    const v: Record<string, string> = {};
    for (const f of IMPORT_FIELDS) v[f.key] = get(f.key);
    if (mapping.fullName !== undefined) {
      const full = (cells[mapping.fullName] ?? "").trim();
      if (full.includes(",")) [v.lastName, v.firstName] = full.split(",").map((x) => x.trim());
      else {
        const parts = full.split(/\s+/);
        v.firstName = parts.slice(0, -1).join(" ");
        v.lastName = parts.slice(-1)[0] ?? "";
      }
    }
    const issues: string[] = [];
    let status: ImportRow["status"] = "READY";
    if (!v.firstName || !v.lastName) issues.push("Missing name");
    const dob = normalizeDate(v.dob);
    if (!dob) issues.push(v.dob ? `Date of birth "${v.dob}" not recognised` : "Missing date of birth");
    else v.dob = dob;
    if (v.sex) {
      const sx = normalizeSex(v.sex);
      if (sx) v.sex = sx;
      else {
        issues.push(`Sex "${v.sex}" not recognised — set to unknown`);
        v.sex = "U";
      }
    }
    if (v.phone) {
      const ph = normalizePhone(v.phone);
      if (ph) v.phone = ph;
      else {
        issues.push(`Phone "${v.phone}" not a 10-digit number — left blank`);
        v.phone = "";
      }
    }
    if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) {
      issues.push("Email looks wrong — left blank");
      v.email = "";
    }
    if (v.state) v.state = v.state.toUpperCase().slice(0, 2);
    if (v.zip) v.zip = v.zip.replace(/[^\d-]/g, "").slice(0, 10);
    if (v.mrn && existingMrns.has(v.mrn.toLowerCase())) {
      issues.push(`MRN ${v.mrn} already used — a new one will be assigned`);
      v.mrn = "";
    }
    let payerId: string | null = null;
    if (v.payer) {
      const p = payers.find((x) => x.name.toLowerCase() === v.payer.toLowerCase() || (x.payerCode && x.payerCode.toLowerCase() === v.payer.toLowerCase())) ?? payers.find((x) => x.name.toLowerCase().includes(v.payer.toLowerCase()) || v.payer.toLowerCase().includes(x.name.toLowerCase()));
      if (p) payerId = p.id;
      else issues.push(`Insurance "${v.payer}" isn't in the payer directory — patient imported without it`);
      if (p && !v.memberId) {
        issues.push("Insurance has no member ID — not added");
        payerId = null;
      }
    }
    if (!v.firstName || !v.lastName || !dob) status = "ERROR";
    else {
      const k = nameKey(v.firstName, v.lastName, dob);
      if (existingKeys.has(k)) {
        status = "DUPLICATE";
        issues.unshift("Already in CareHub (same name and date of birth)");
      } else if (seen.has(k)) {
        status = "DUPLICATE";
        issues.unshift("Repeated earlier in this file");
      }
      seen.add(k);
    }
    return { line: idx + 2, values: v, status, issues, payerId };
  });
}

export async function commitImport(batchId: string, practiceId: string, userId: string) {
  const batch = await prisma.importBatch.findFirstOrThrow({ where: { id: batchId, practiceId } });
  if (batch.status !== "PREVIEW") throw new Error("This file was already imported.");
  const rows = JSON.parse(batch.rows) as ImportRow[];
  const created: string[] = [];
  for (const r of rows) {
    if (r.status !== "READY") continue;
    const v = r.values;
    const mrn = v.mrn || `CH-${Math.floor(100000 + Math.random() * 899999)}`;
    const p = await prisma.patient.create({
      data: {
        practiceId,
        mrn,
        firstName: v.firstName.slice(0, 60),
        lastName: v.lastName.slice(0, 60),
        dob: new Date(`${v.dob}T12:00:00Z`),
        sex: v.sex || "U",
        phone: v.phone || null,
        email: v.email || null,
        addressLine1: v.addressLine1 || null,
        city: v.city || null,
        state: v.state || null,
        zip: v.zip || null,
      },
    });
    if (r.payerId && v.memberId) await prisma.insurance.create({ data: { patientId: p.id, payerId: r.payerId, memberId: v.memberId.slice(0, 40), groupNumber: v.groupNumber || null, rank: "PRIMARY", isPrimary: true } });
    r.status = "IMPORTED";
    created.push(p.id);
  }
  await prisma.importBatch.update({ where: { id: batch.id }, data: { status: "IMPORTED", rows: JSON.stringify(rows), createdIds: JSON.stringify(created), createdCount: created.length, skippedCount: rows.length - created.length, importedAt: new Date() } });
  await logAudit(practiceId, userId, "IMPORT_PATIENTS", "ImportBatch", batch.id, `${created.length} patients from ${batch.fileName}`);
  return created.length;
}

// Undo removes patients from the batch that nobody has worked on since (no visits, appointments, claims or documents).
export async function undoImport(batchId: string, practiceId: string, userId: string) {
  const batch = await prisma.importBatch.findFirstOrThrow({ where: { id: batchId, practiceId, status: "IMPORTED" } });
  const ids = JSON.parse(batch.createdIds) as string[];
  const untouched = await prisma.patient.findMany({
    where: { id: { in: ids }, practiceId, appointments: { none: {} }, encounters: { none: {} }, claims: { none: {} }, documents: { none: {} }, intakeCases: { none: {} } },
    select: { id: true },
  });
  await prisma.patient.deleteMany({ where: { id: { in: untouched.map((p) => p.id) } } });
  const kept = ids.length - untouched.length;
  await prisma.importBatch.update({ where: { id: batch.id }, data: { status: kept ? "IMPORTED" : "UNDONE", createdIds: JSON.stringify(ids.filter((id) => !untouched.some((u) => u.id === id))) } });
  await logAudit(practiceId, userId, "UNDO_IMPORT", "ImportBatch", batch.id, `${untouched.length} removed${kept ? `, ${kept} kept (already in use)` : ""}`);
  return { removed: untouched.length, kept };
}
