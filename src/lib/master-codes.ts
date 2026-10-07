import { prisma } from "@/lib/prisma";
import { parseCsv } from "@/lib/patient-import";
import { readXlsxRows, unzip } from "@/lib/xlsx-read";

// The code library: every diagnosis and billing code, held once for all practices and refreshed from the bodies
// that publish them. Charge schedules, the superbill and the practice's own code list pick from it.
//   ICD10  - ICD-10-CM diagnosis codes, published by the CDC (public domain), new edition every October 1.
//   HCPCS  - HCPCS Level II codes (supplies, drugs, G / Q / A codes), published by CMS every quarter.
//   CPT    - CPT codes are owned by the American Medical Association and are not free to redistribute. They are
//            loaded from the file the practice holds under its AMA licence; nothing is fetched for them.

export type CodeSet = "ICD10" | "HCPCS" | "CPT";

export const codeSetLabel: Record<CodeSet, string> = {
  ICD10: "ICD-10-CM diagnosis codes",
  HCPCS: "HCPCS Level II codes",
  CPT: "CPT procedure codes",
};

export const codeSetSource: Record<CodeSet, string> = {
  ICD10: "CDC / National Center for Health Statistics",
  HCPCS: "CMS quarterly HCPCS file",
  CPT: "Your AMA-licensed CPT file",
};

export type MasterRow = { code: string; description: string; shortDescription: string | null; billable: boolean };

const clean = (v: string | undefined | null) => (v ?? "").replace(/\s+/g, " ").trim();

// ICD-10-CM "order" file: fixed columns - order number, code (no dot), 0 header / 1 billable, short and long title.
export function parseIcdOrderFile(text: string): MasterRow[] {
  const rows: MasterRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.length < 20) continue;
    const raw = line.slice(6, 13).trim();
    if (!/^[A-Z][0-9A-Z]{2,6}$/.test(raw)) continue;
    rows.push({
      code: raw.length > 3 ? `${raw.slice(0, 3)}.${raw.slice(3)}` : raw,
      billable: line[14] === "1",
      shortDescription: clean(line.slice(16, 76)) || null,
      description: clean(line.slice(77)) || clean(line.slice(16, 76)),
    });
  }
  return rows;
}

// CMS alpha-numeric HCPCS file (the spreadsheet in the quarterly zip): a code's description runs over a first row
// (record 3) and continuation rows (record 4); modifiers (records 7 and 8) are left out. Codes terminated before
// today are skipped.
export function parseHcpcsTable(table: string[][], today = new Date()): MasterRow[] {
  const head = table[0]?.map((h) => clean(h).toUpperCase()) ?? [];
  const at = (name: string) => head.indexOf(name);
  const [iCode, iRec, iLong, iShort, iTerm] = [at("HCPC"), at("RECID"), at("LONG DESCRIPTION"), at("SHORT DESCRIPTION"), at("TERM DT")];
  if (iCode < 0 || iLong < 0) return [];
  const ymd = Number(`${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`);
  const byCode = new Map<string, MasterRow>();
  const ended = new Set<string>();
  for (const r of table.slice(1)) {
    const code = clean(r[iCode]).toUpperCase();
    const rec = clean(r[iRec]);
    if (!/^[A-Z][0-9]{4}$/.test(code) || (rec !== "3" && rec !== "4")) continue;
    const term = Number(clean(r[iTerm]) || 0);
    if (rec === "3" && term && term < ymd) ended.add(code);
    const have = byCode.get(code);
    if (have) have.description = `${have.description} ${clean(r[iLong])}`.trim();
    else byCode.set(code, { code, description: clean(r[iLong]), shortDescription: clean(r[iShort]) || null, billable: true });
  }
  return [...byCode.values()].filter((r) => !ended.has(r.code) && r.description);
}

// A licensed CPT file (CSV or Excel): any layout with a code column and a description column.
export function parseCodeTable(table: string[][]): { rows: MasterRow[]; problem: string | null } {
  const headAt = table.findIndex((r) => r.some((c) => /code|cpt|hcpc/i.test(c)) && r.some((c) => /desc|descriptor|title|name/i.test(c)));
  if (headAt < 0) return { rows: [], problem: "No header row with a code column and a description column was found." };
  const head = table[headAt].map((h) => clean(h).toLowerCase());
  const iCode = head.findIndex((h) => /^(cpt|hcpcs?|procedure|billing)?\s*(code|cpt)\b|^cpt$|^hcpcs?$/.test(h));
  const iLong = head.findIndex((h) => /long|full|medium|consumer/.test(h) && /desc/.test(h));
  const iShort = head.findIndex((h) => /short/.test(h) && /desc/.test(h));
  const iAny = head.findIndex((h) => /desc|descriptor|title|name/.test(h));
  if (iCode < 0) return { rows: [], problem: "No code column was found." };
  const seen = new Set<string>();
  const rows: MasterRow[] = [];
  for (const r of table.slice(headAt + 1)) {
    const code = clean(r[iCode]).toUpperCase();
    if (!/^[0-9A-Z]{5}$/.test(code) || seen.has(code)) continue;
    const description = clean(r[iLong >= 0 ? iLong : iAny]) || clean(r[iShort >= 0 ? iShort : iAny]);
    if (!description) continue;
    seen.add(code);
    rows.push({ code, description: description.slice(0, 1000), shortDescription: iShort >= 0 ? clean(r[iShort]).slice(0, 120) || null : null, billable: true });
  }
  return { rows, problem: rows.length ? null : "No 5-character codes with a description were found." };
}

export function readCodeFile(name: string, bytes: Buffer) {
  if (/\.xlsx$/i.test(name)) return parseCodeTable(readXlsxRows(bytes));
  return parseCodeTable(parseCsv(bytes.toString("utf8")));
}

// Replaces one code set with a new edition.
export async function replaceCodeSet(codeSet: CodeSet, rows: MasterRow[], edition: string) {
  const unique = [...new Map(rows.map((r) => [r.code, r])).values()];
  await prisma.masterCode.deleteMany({ where: { codeSet } });
  for (let i = 0; i < unique.length; i += 1000) {
    await prisma.masterCode.createMany({ data: unique.slice(i, i + 1000).map((r) => ({ ...r, codeSet, edition })) });
  }
  return unique.length;
}

async function download(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (CareHub code library)" }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) return null;
  const type = res.headers.get("content-type") ?? "";
  if (/html/.test(type)) return null;
  return Buffer.from(await res.arrayBuffer());
}

// ICD-10-CM: the edition for the federal fiscal year in force today (FY2027 runs from October 1, 2026).
export async function fetchIcd10(today = new Date()) {
  const fy = today.getFullYear() + (today.getMonth() >= 9 ? 1 : 0);
  for (const year of [fy, fy - 1]) {
    const base = `https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/ICD10CM/${year}/`;
    // The CDC has named the file both ways.
    for (const file of [`icd10cm-code-descriptions-${year}.zip`, `icd10cm-Code%20Descriptions-${year}.zip`]) {
      const zip = await download(base + file).catch(() => null);
      if (!zip) continue;
      const entry = [...unzip(zip)].find(([name]) => new RegExp(`icd10cm[-_]order[-_]${year}\\.txt$`, "i").test(name));
      if (!entry) continue;
      const rows = parseIcdOrderFile(entry[1].toString("utf8"));
      if (rows.length > 10_000) return { rows, edition: `FY${year}`, source: base + file };
    }
  }
  return null;
}

const QUARTERS = ["january", "april", "july", "october"];

// HCPCS Level II: the latest quarterly file CMS has published, looking back up to a year.
export async function fetchHcpcs(today = new Date()) {
  let year = today.getFullYear();
  let q = Math.floor(today.getMonth() / 3);
  for (let n = 0; n < 5; n++) {
    const url = `https://www.cms.gov/files/zip/${QUARTERS[q]}-${year}-alpha-numeric-hcpcs-file.zip`;
    const zip = await download(url).catch(() => null);
    if (zip) {
      const entry = [...unzip(zip)].find(([name]) => /ANWEB/i.test(name) && /\.xlsx$/i.test(name) && !/transaction|correction/i.test(name));
      const rows = entry ? parseHcpcsTable(readXlsxRows(entry[1])) : [];
      if (rows.length > 1000) return { rows, edition: `${QUARTERS[q][0].toUpperCase()}${QUARTERS[q].slice(1)} ${year}`, source: url };
    }
    q -= 1;
    if (q < 0) {
      q = 3;
      year -= 1;
    }
  }
  return null;
}

export type CodeHit = { codeSet: string; code: string; description: string; shortDescription: string | null; billable: boolean };

// Finds codes by the start of the code or by every word of the description. Billable codes come first.
export async function searchMasterCodes(q: string, sets: CodeSet[], take = 30): Promise<CodeHit[]> {
  const needle = q.trim().slice(0, 80);
  // Nothing typed: the set itself, in code order, so a set can be browsed.
  if (!needle) {
    return prisma.masterCode.findMany({
      where: { codeSet: { in: sets }, billable: true },
      orderBy: [{ codeSet: "asc" }, { code: "asc" }],
      take,
      select: { codeSet: true, code: true, description: true, shortDescription: true, billable: true },
    });
  }
  const words = needle.split(/\s+/).filter(Boolean);
  // A single letter or a code-like entry is matched against the start of the code only.
  const looksLikeCode = needle.length === 1 || /^[A-Za-z]?\d[\dA-Za-z.]*$/.test(needle);
  const rows = await prisma.masterCode.findMany({
    where: {
      codeSet: { in: sets },
      OR: [{ code: { startsWith: needle.toUpperCase(), mode: "insensitive" as const } }, ...(looksLikeCode ? [] : [{ AND: words.map((w) => ({ description: { contains: w, mode: "insensitive" as const } })) }])],
    },
    orderBy: [{ billable: "desc" }, { code: "asc" }],
    take,
    select: { codeSet: true, code: true, description: true, shortDescription: true, billable: true },
  });
  return rows;
}
