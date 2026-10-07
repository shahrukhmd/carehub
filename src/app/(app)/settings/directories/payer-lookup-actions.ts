"use server";

import { rolesFor } from "@/lib/permissions";
import { getClearinghouseAdapter } from "@/lib/clearinghouse";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getPracticeSettings } from "@/lib/chart-setup";
import { CLEARINGHOUSES } from "@/lib/practice-settings";
import { STARTER_PAYERS, guessInsuranceType, mergePayerRows, parsePayerList, parsePayerTable, type CatalogRow, type PayerMatch } from "@/lib/payer-catalog";
import { readXlsxRows } from "@/lib/xlsx-read";

const LOOKUP_ROLES = rolesFor("settings.insurance");

// The built-in test clearinghouse has no published list; it gets a few well-known payers so the lookup can be tried.
async function ensureStarterList(clearinghouse: string) {
  if (clearinghouse !== "MOCK") return;
  if (await prisma.payerCatalogEntry.count({ where: { clearinghouse } })) return;
  await prisma.payerCatalogEntry.createMany({ data: STARTER_PAYERS.map((p) => ({ ...p, clearinghouse })) });
}

// source: where the matches came from — the clearinghouse's live directory (API) or the loaded list.
export type PayerLookupResult = { clearinghouse: string; loaded: number; source: "LIVE" | "LIST"; matches: PayerMatch[] };

// Finds payers in the list of the clearinghouse chosen in Practice setup, by payer ID or by any words of the name.
export async function searchPayerList(query: string): Promise<PayerLookupResult> {
  const user = await requireUser(LOOKUP_ROLES);
  const settings = await getPracticeSettings(user.practiceId);
  const clearinghouse = settings.clearinghouse in CLEARINGHOUSES ? settings.clearinghouse : "MOCK";
  await ensureStarterList(clearinghouse);
  const loaded = await prisma.payerCatalogEntry.count({ where: { clearinghouse } });
  const q = query.trim().slice(0, 80);
  // A clearinghouse connected by API answers from its own directory; until then, and whenever it cannot answer,
  // the loaded list does. Nothing else on the form changes when the connection goes live.
  const adapter = getClearinghouseAdapter();
  const live = q.length >= 2 && adapter.searchPayers ? await adapter.searchPayers(clearinghouse, q).catch(() => null) : null;
  const source = adapter.searchPayers ? "LIVE" : "LIST";
  if (q.length < 2) return { clearinghouse: CLEARINGHOUSES[clearinghouse], loaded, source, matches: [] };

  const words = q.split(/\s+/).filter(Boolean);
  const listed = await prisma.payerCatalogEntry.findMany({
    where: {
      clearinghouse,
      OR: [
        // Any of the payer's IDs: the clearinghouse's own or the industry-standard one.
        ...(["payerId", "institutionalId", "eraId", "eligibilityId", "standardId"] as const).map((k) => ({ [k]: { startsWith: q, mode: "insensitive" } })),
        { AND: words.map((w) => ({ OR: [{ name: { contains: w, mode: "insensitive" } }, { relatedNames: { contains: w, mode: "insensitive" } }] })) },
      ],
    },
    orderBy: [{ name: "asc" }],
    take: live ? 0 : 40,
  });
  const rows = live ? live.slice(0, 40).map((r, i) => ({ ...r, id: `live-${i}` })) : listed;
  // Exact ID first, then names that start with what was typed.
  const ql = q.toLowerCase();
  const ids = (r: (typeof rows)[number]) => [r.payerId, r.institutionalId, r.eraId, r.eligibilityId, r.standardId].filter((x): x is string => Boolean(x)).map((x) => x.toLowerCase());
  const rank = (r: (typeof rows)[number]) => (ids(r).includes(ql) ? 0 : r.name.toLowerCase().startsWith(ql) ? 1 : ids(r).some((x) => x.startsWith(ql)) ? 2 : 3);
  const top = rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, 12);

  // Clearinghouse lists carry no mailing address. One already entered for the same payer ID in this organization
  // (this practice or a sister practice) is offered instead.
  const practice = await prisma.practice.findUnique({ where: { id: user.practiceId }, select: { organizationId: true } });
  const known = await prisma.payer.findMany({
    where: {
      payerCode: { in: top.flatMap((r) => [r.payerId, r.standardId].filter((x): x is string => Boolean(x))) },
      addressLine1: { not: null },
      practice: practice?.organizationId ? { organizationId: practice.organizationId } : { id: user.practiceId },
    },
    select: { payerCode: true, addressLine1: true, addressLine2: true, city: true, state: true, zip: true, phone: true, practice: { select: { name: true } } },
  });

  return {
    clearinghouse: CLEARINGHOUSES[clearinghouse],
    loaded,
    source: live ? "LIVE" : "LIST",
    matches: top.map((r) => {
      const k = r.addressLine1 ? null : known.find((p) => p.payerCode === r.payerId || p.payerCode === r.standardId);
      return {
        id: r.id,
        payerId: r.payerId,
        name: r.name,
        relatedNames: r.relatedNames,
        payerClass: r.payerClass,
        institutionalId: r.institutionalId,
        eraId: r.eraId,
        eligibilityId: r.eligibilityId,
        standardId: r.standardId,
        enrollmentNote: r.enrollmentNote,
        professional: r.professional,
        institutional: r.institutional,
        remits: r.remits,
        eligibility: r.eligibility,
        addressLine1: r.addressLine1 ?? k?.addressLine1 ?? null,
        addressLine2: r.addressLine2 ?? k?.addressLine2 ?? null,
        city: r.city ?? k?.city ?? null,
        state: r.state ?? k?.state ?? null,
        zip: r.zip ?? k?.zip ?? null,
        phone: r.phone ?? k?.phone ?? null,
        insuranceType: guessInsuranceType(r.name, r.payerClass),
        addressFrom: k ? k.practice.name : null,
      };
    }),
  };
}

// Loads a payer list file downloaded from the practice's clearinghouse. A file is joined onto the list already
// held (a claims list and an eligibility list make one entry per payer); "replace" starts the list again.
export async function importPayerList(fd: FormData) {
  const user = await requireUser(rolesFor("settings.admin"));
  const settings = await getPracticeSettings(user.practiceId);
  const clearinghouse = settings.clearinghouse;
  const back = (key: "listError" | "listOk", message: string): never => redirect(`/settings/practice?${key}=${encodeURIComponent(message.slice(0, 300))}#payer-list`);

  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) back("listError", "Choose the payer list file to load.");
  const f = file as File;
  if (f.size > 15 * 1024 * 1024) back("listError", "The file is larger than 15 MB.");
  let parsed: ReturnType<typeof parsePayerList> | null = null;
  if (/\.xlsx$/i.test(f.name)) {
    try {
      parsed = parsePayerTable(readXlsxRows(Buffer.from(await f.arrayBuffer())));
    } catch {
      back("listError", "The Excel file could not be read. Open it and save it as CSV, then load the CSV.");
    }
  } else if (/\.(csv|txt|tsv)$/i.test(f.name)) parsed = parsePayerList(await f.text());
  else back("listError", "Load an Excel (.xlsx) or CSV file.");
  const { rows, problems } = parsed!;
  if (rows.length === 0) back("listError", problems[0] ?? "No payers were found in the file.");

  const replace = fd.get("mode") === "replace";
  const held = replace ? [] : await prisma.payerCatalogEntry.findMany({ where: { clearinghouse } });
  const strip = (h: (typeof held)[number]): CatalogRow => {
    const row: Partial<typeof h> = { ...h };
    delete row.id;
    delete row.clearinghouse;
    delete row.loadedAt;
    return row as CatalogRow;
  };
  const merged = mergePayerRows(held.map(strip), rows);
  await prisma.$transaction([
    prisma.payerCatalogEntry.deleteMany({ where: { clearinghouse } }),
    ...chunks(merged, 400).map((part) => prisma.payerCatalogEntry.createMany({ data: part.map((r) => ({ ...r, clearinghouse })) })),
  ]);
  await logAudit(user.practiceId, user.id, "LOAD_PAYER_LIST", "PayerCatalogEntry", clearinghouse, `${rows.length} payers from ${f.name}`);
  revalidatePath("/settings/practice");
  const added = merged.length - held.length;
  back(
    "listOk",
    `${rows.length.toLocaleString("en-US")} payers read from ${f.name}: ${held.length ? `${added.toLocaleString("en-US")} added and ${(rows.length - added).toLocaleString("en-US")} joined onto payers already in the list` : "list loaded"}. ${merged.length.toLocaleString("en-US")} payers held for ${CLEARINGHOUSES[clearinghouse] ?? clearinghouse}.${problems.length ? " Some rows had no payer ID and were skipped." : ""}`
  );
}

function chunks<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
