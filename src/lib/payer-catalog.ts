import { parseCsv } from "@/lib/patient-import";

// Clearinghouse payer lists. Each clearinghouse publishes its own lists (payer name, the payer IDs it uses, which
// transactions the payer takes). The lists for the practice's clearinghouse are loaded from the files the
// clearinghouse offers for download, and the insurance form looks payers up in them.

// Where each clearinghouse publishes its lists, and which to load.
export const PAYER_LIST_SOURCE: Record<string, { url: string; how: string }> = {
  WAYSTAR: { url: "https://login.zirmed.com/ui/Payers", how: "Leave the filters empty and choose Download (.CSV)." },
  CHANGE_HEALTHCARE: {
    url: "https://customerconnect.optum.com/payerlist",
    how: "Under your platform (Exchange, IEDI or Revenue Performance Advisor), choose Download List for “Claims and Electronic Remittance Advice (ERA)”, then for “Real-Time”. Load both files here, one after the other: the first gives the claims and ERA IDs, the second adds the eligibility IDs.",
  },
  AVAILITY: { url: "https://essentials.availity.com/static/public/onb/onboarding-ui-apps/payer-list-ui/", how: "Download the payer list as a CSV or Excel file." },
};

export type CatalogRow = {
  // The ID claims go out under (professional claims where the clearinghouse has one ID per claim type).
  payerId: string;
  name: string;
  relatedNames: string | null;
  payerClass: string | null;
  institutionalId: string | null;
  eraId: string | null;
  eligibilityId: string | null;
  // The payer's industry-standard ID, where the clearinghouse uses IDs of its own.
  standardId: string | null;
  // Transactions the payer wants an enrollment for before they work.
  enrollmentNote: string | null;
  professional: boolean;
  institutional: boolean;
  remits: boolean;
  eligibility: boolean;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
};

const blank = { relatedNames: null, payerClass: null, institutionalId: null, standardId: null, enrollmentNote: null, addressLine2: null, phone: null };
const all = { professional: true, institutional: true, remits: true, eligibility: true };

// A small list so the lookup can be tried before a real payer list is loaded. Addresses are the payers' general
// claims addresses; the address on the member's card is the one that counts.
export const STARTER_PAYERS: CatalogRow[] = [
  { ...blank, ...all, payerId: "60054", eraId: "60054", eligibilityId: "60054", name: "Aetna", relatedNames: "Aetna Health; Aetna Life Insurance", payerClass: "Commercial", addressLine1: "PO Box 14079", city: "Lexington", state: "KY", zip: "40512" },
  { ...blank, ...all, payerId: "62308", eraId: "62308", eligibilityId: "62308", name: "Cigna", relatedNames: "Cigna Healthcare; Connecticut General", payerClass: "Commercial", addressLine1: "PO Box 182223", city: "Chattanooga", state: "TN", zip: "37422" },
  { ...blank, ...all, payerId: "87726", eraId: "87726", eligibilityId: "87726", name: "UnitedHealthcare", relatedNames: "UHC; United Healthcare", payerClass: "Commercial", addressLine1: "PO Box 30555", city: "Salt Lake City", state: "UT", zip: "84130" },
  { ...blank, ...all, payerId: "61101", eraId: "61101", eligibilityId: "61101", name: "Humana", relatedNames: "Humana Health Plan", payerClass: "Commercial", addressLine1: "PO Box 14601", city: "Lexington", state: "KY", zip: "40512" },
  { ...blank, ...all, payerId: "36273", eraId: "36273", eligibilityId: "36273", name: "AARP Medicare Supplement (UHC)", relatedNames: "AARP Medicare Complete", payerClass: "Medicare", addressLine1: null, city: null, state: null, zip: null },
];

// Headers come as "Payer Plan Name", "payerPlanName" or "exchangeProfessionalCPID"; all read the same after this.
const norm = (h: string) =>
  h
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[\r\n_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const clean = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
const isNo = (v: string | undefined) => ["", "n", "no", "false", "0", "-", "none", "not available", "na", "n/a"].includes(clean(v).toLowerCase());
// An ID cell that actually holds one ("NONE" and blanks do not).
const idOf = (v: string | undefined) => (isNo(v) ? null : clean(v).slice(0, 20));

type Key = "name" | "payerId" | "transaction" | "standardId" | "claimProf" | "claimInst" | "enrollment" | "relatedNames" | "payerClass" | "professional" | "institutional" | "remits" | "eligibility" | "addressLine1" | "addressLine2" | "city" | "state" | "zip" | "phone";

// Column headers as the clearinghouses write them. Order matters: the first pattern a header fits wins.
const COLUMNS: [Key, RegExp][] = [
  ["claimProf", /(claim payer id|cpid).*prof|prof\w*( claims?)? (cpid|claim payer id)/],
  ["claimInst", /(claim payer id|cpid).*inst|inst\w*( claims?)? (cpid|claim payer id)/],
  ["standardId", /industry|standard payer id|national payer id/],
  ["transaction", /^transactions?$|transaction type/],
  ["enrollment", /enrol/],
  ["payerId", /^(waystar |availity |optum |chc )?(payer|cpid|claim payer) ?(id|code|#|number)$|^cpid$|^id$/],
  ["relatedNames", /related|alias|also known|aka|alternate name/],
  ["name", /^(payer|insurance|plan|carrier)( plan)?( name)?$|^name$|payer name|payer plan name/],
  ["payerClass", /class|line of business|payer type|^type$|category/],
  ["professional", /prof|837p|cms.?1500/],
  ["institutional", /inst|837i|ub.?04/],
  ["remits", /remit|\bera\b|835/],
  ["eligibility", /elig|270|271/],
  ["addressLine1", /address ?(line)? ?1$|^address$|street|claims address/],
  ["addressLine2", /address ?(line)? ?2$/],
  ["city", /^city$/],
  ["state", /^state$|^st$/],
  ["zip", /zip|postal/],
  ["phone", /phone|telephone/],
];

export type ParsedList = { rows: CatalogRow[]; problems: string[]; layout: "ONE_ROW_PER_PAYER" | "ONE_ROW_PER_TRANSACTION" | null };

// Reads a clearinghouse's payer list whatever its exact column names. Two layouts are met:
//  - one row per payer with a column per transaction (Waystar: "Aetna (60054)" with the related names beneath);
//  - one row per payer per transaction, each with its own ID (Optum: claims and ERA list, and a real-time list
//    whose rows carry the claim IDs to tie the two together).
export function parsePayerTable(table: string[][]): ParsedList {
  // The header is the first row with a payer name column; title and legend rows above it are passed over.
  const nameHeader = COLUMNS.find(([key]) => key === "name")![1];
  const headAt = table.findIndex((r) => r.some((c) => nameHeader.test(norm(c))) && r.filter((c) => c.trim()).length >= 2);
  if (headAt < 0) return { rows: [], problems: ["No header row with a payer name column was found."], layout: null };
  const headers = table[headAt].map(norm);
  const at: Partial<Record<Key, number>> = {};
  headers.forEach((h, i) => {
    const hit = COLUMNS.find(([key, re]) => at[key] === undefined && re.test(h));
    if (hit) at[hit[0]] = i;
  });
  if (at.name === undefined) return { rows: [], problems: ["No payer name column was found."], layout: null };
  const body = table.slice(headAt + 1);
  const get = (r: string[], key: Key) => (at[key] === undefined ? undefined : r[at[key]!]);
  const text = (r: string[], k: Key, max = 120) => clean(get(r, k)).slice(0, max) || null;
  const problems: string[] = [];

  if (at.transaction !== undefined) {
    // One row per transaction: gather each payer's rows into one entry.
    const byKey = new Map<string, CatalogRow>();
    const notes = new Map<string, Set<string>>();
    for (const r of body) {
      const name = clean(get(r, "name")).slice(0, 160);
      const id = idOf(get(r, "payerId"));
      const tx = clean(get(r, "transaction")).toLowerCase();
      if (!name || !tx) continue;
      const realTime = at.claimProf !== undefined || at.claimInst !== undefined;
      // Real-time rows are tied to the claims entry by the claim IDs they quote; otherwise by the payer's name.
      const prof = realTime ? idOf(get(r, "claimProf")) : null;
      const inst = realTime ? idOf(get(r, "claimInst")) : null;
      const key = name.toLowerCase();
      const e =
        byKey.get(key) ??
        ({ ...blank, payerId: "", name, eraId: null, eligibilityId: null, professional: false, institutional: false, remits: false, eligibility: false, addressLine1: null, city: null, state: null, zip: null } as CatalogRow);
      byKey.set(key, e);
      if (realTime) {
        if (prof && !e.payerId) e.payerId = prof;
        if (inst && !e.institutionalId) e.institutionalId = inst;
        if (/elig/.test(tx) && id) {
          e.eligibilityId = id;
          e.eligibility = true;
        }
      } else if (/claim/.test(tx) && /inst/.test(tx)) {
        e.institutionalId = id ?? e.institutionalId;
        e.institutional = Boolean(id) || e.institutional;
      } else if (/claim/.test(tx)) {
        e.payerId = id ?? e.payerId;
        e.professional = Boolean(id) || e.professional;
      } else if (/era|remit/.test(tx)) {
        // The professional remit ID is the one a practice uses; the institutional one only when there is no other.
        if (id && (!e.eraId || /prof/.test(tx))) e.eraId = id;
        e.remits = Boolean(id) || e.remits;
      }
      e.standardId = e.standardId ?? idOf(get(r, "standardId"));
      if (!isNo(get(r, "enrollment")) && /claim|era|remit|elig/.test(tx)) {
        const set = notes.get(key) ?? new Set<string>();
        set.add(/elig/.test(tx) ? "eligibility" : /era|remit/.test(tx) ? "ERA" : "claims");
        notes.set(key, set);
      }
    }
    const rows: CatalogRow[] = [];
    for (const [key, e] of byKey) {
      // An entry is kept under its claims ID; a payer with only institutional claims or only eligibility still counts.
      e.payerId = e.payerId || e.institutionalId || e.eligibilityId || e.eraId || "";
      if (!e.payerId) {
        if (problems.length < 5) problems.push(`No payer ID for "${e.name.slice(0, 60)}" — skipped.`);
        continue;
      }
      e.enrollmentNote = notes.has(key) ? `Enrollment required for ${[...notes.get(key)!].join(", ")}` : null;
      rows.push(e);
    }
    return { rows, problems, layout: "ONE_ROW_PER_TRANSACTION" };
  }

  // Waystar marks a transaction X when it needs an enrollment and O when it does not.
  const needsEnrollment = (r: string[]) => {
    const which = ([["professional", "claims"], ["institutional", "claims"], ["remits", "ERA"], ["eligibility", "eligibility"]] as const)
      .filter(([k]) => /^x$|enrol/i.test(clean(get(r, k))))
      .map(([, label]) => label);
    return which.length ? `Enrollment required for ${[...new Set(which)].join(", ")}` : null;
  };
  const rows: CatalogRow[] = [];
  const seen = new Set<string>();
  for (const r of body) {
    const raw = (get(r, "name") ?? "").split(/\r?\n/).map(clean).filter(Boolean);
    if (!raw.length) continue;
    let name = raw[0];
    let payerId = idOf(get(r, "payerId"));
    // "Name (ID)": the last bracket that looks like an ID, not a note such as "(MN Only)".
    const inName = name.match(/^(.*\S)\s*\(([A-Z0-9]{3,12})\)\s*$/i);
    if (!payerId && inName) {
      name = inName[1];
      payerId = inName[2];
    }
    if (!payerId) {
      if (problems.length < 5) problems.push(`No payer ID for "${name.slice(0, 60)}" — skipped.`);
      continue;
    }
    const key = `${payerId}|${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // A list with no transaction columns at all is a claims payer list.
    const professional = at.professional === undefined ? true : !isNo(get(r, "professional"));
    const institutional = at.institutional === undefined ? false : !isNo(get(r, "institutional"));
    const remits = at.remits === undefined ? false : !isNo(get(r, "remits"));
    const eligibility = at.eligibility === undefined ? false : !isNo(get(r, "eligibility"));
    rows.push({
      payerId,
      name: name.slice(0, 160),
      relatedNames: (text(r, "relatedNames", 500) ?? raw.slice(1).join("; ").slice(0, 500)) || null,
      payerClass: text(r, "payerClass", 60),
      // One ID serves every transaction the payer takes.
      institutionalId: institutional ? payerId : null,
      eraId: remits ? payerId : null,
      eligibilityId: eligibility ? payerId : null,
      standardId: idOf(get(r, "standardId")),
      enrollmentNote: needsEnrollment(r),
      professional,
      institutional,
      remits,
      eligibility,
      addressLine1: text(r, "addressLine1"),
      addressLine2: text(r, "addressLine2"),
      city: text(r, "city", 60),
      state: (text(r, "state", 2) ?? "").toUpperCase() || null,
      zip: text(r, "zip", 10),
      phone: text(r, "phone", 30),
    });
  }
  return { rows, problems, layout: "ONE_ROW_PER_PAYER" };
}

export const parsePayerList = (csv: string) => parsePayerTable(parseCsv(csv));

// Joins a newly read list onto what is already held, so a claims list and a real-time list loaded one after the
// other end up as one entry per payer. Matching is by claims ID first, then by name.
export function mergePayerRows(existing: CatalogRow[], incoming: CatalogRow[]): CatalogRow[] {
  const out = existing.map((e) => ({ ...e }));
  const byId = new Map(out.map((e) => [e.payerId, e]));
  const byName = new Map(out.map((e) => [e.name.toLowerCase(), e]));
  for (const n of incoming) {
    const e = byName.get(n.name.toLowerCase()) ?? (n.professional || n.institutional ? undefined : byId.get(n.payerId));
    if (!e) {
      const copy = { ...n };
      out.push(copy);
      byId.set(copy.payerId, copy);
      byName.set(copy.name.toLowerCase(), copy);
      continue;
    }
    // Claims IDs from a claims list win over the cross-references quoted on a real-time list.
    if (n.professional) e.payerId = n.payerId;
    e.institutionalId = (n.institutional ? n.institutionalId : null) ?? e.institutionalId ?? n.institutionalId;
    e.eraId = n.eraId ?? e.eraId;
    e.eligibilityId = n.eligibilityId ?? e.eligibilityId;
    e.standardId = n.standardId ?? e.standardId;
    e.professional = e.professional || n.professional;
    e.institutional = e.institutional || n.institutional;
    e.remits = e.remits || n.remits;
    e.eligibility = e.eligibility || n.eligibility;
    e.relatedNames = e.relatedNames ?? n.relatedNames;
    e.payerClass = e.payerClass ?? n.payerClass;
    e.enrollmentNote = [e.enrollmentNote, n.enrollmentNote].filter(Boolean).join("; ").replace(/; Enrollment required for /g, ", ") || null;
    for (const k of ["addressLine1", "addressLine2", "city", "state", "zip", "phone"] as const) e[k] = e[k] ?? n[k];
  }
  return out;
}

// The insurance type a payer's name points to; left open when the name does not say.
export function guessInsuranceType(name: string, payerClass: string | null): string | null {
  const t = `${name} ${payerClass ?? ""}`.toLowerCase();
  if (/supplement|medigap|med supp/.test(t)) return "MEDICARE_SUPPLEMENTAL";
  if (/medicare advantage|medicare adv|\bma\b plan|medicare complete|medicare hmo|medicare ppo|dual complete|\bdsnp\b/.test(t)) return "MEDICARE_ADVANTAGE";
  if (/medicaid.*(mco|managed|hmo)|community plan|\bmco\b/.test(t)) return "MEDICAID_MCO";
  if (/medicaid|\bchip\b/.test(t)) return "MEDICAID";
  if (/tricare|champus/.test(t)) return "TRICARE";
  if (/champva/.test(t)) return "CHAMPVA";
  if (/workers|work comp|\bwc\b/.test(t)) return "WORKERS_COMP";
  if (/\bauto\b|liability|casualty/.test(t)) return "AUTO";
  if (/veterans|\bva\b|federal|feca|black lung/.test(t)) return "FEDERAL_PROGRAM";
  if (/medicare|railroad|dmerc|\bdme mac\b/.test(t)) return "MEDICARE";
  if (/commercial|bc ?\/? ?bs|blue cross|blue shield/.test(t)) return "COMMERCIAL";
  return null;
}

// What the lookup hands the insurance form for one payer.
export type PayerMatch = CatalogRow & {
  id: string;
  insuranceType: string | null;
  // Address taken from an insurance already saved with this payer ID elsewhere in the organization.
  addressFrom: string | null;
};
