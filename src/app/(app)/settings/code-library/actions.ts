"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { codeSetLabel, fetchHcpcs, fetchIcd10, readCodeFile, replaceCodeSet, searchMasterCodes, type CodeHit, type CodeSet } from "@/lib/master-codes";

const ADMIN = ["ADMIN"];
const LOOKUP_ROLES = ["ADMIN", "BILLER", "CDS", "CLINICIAN", "FRONT_DESK"];

function back(key: "ok" | "error", message: string): never {
  redirect(`/settings/code-library?${key}=${encodeURIComponent(message.slice(0, 300))}`);
}

// Fetches the current edition from the publisher (CDC for ICD-10-CM, CMS for HCPCS) and replaces the set held.
export async function refreshCodeSet(codeSet: "ICD10" | "HCPCS") {
  const user = await requireUser(ADMIN);
  let got: Awaited<ReturnType<typeof fetchIcd10>> = null;
  try {
    got = codeSet === "ICD10" ? await fetchIcd10() : await fetchHcpcs();
  } catch {
    got = null;
  }
  if (!got) back("error", `The ${codeSetLabel[codeSet]} could not be fetched from the publisher. Check the internet connection and try again; the codes already held are unchanged.`);
  const n = await replaceCodeSet(codeSet, got.rows, got.edition);
  await logAudit(user.practiceId, user.id, "REFRESH_CODE_LIBRARY", "MasterCode", codeSet, `${n} codes, ${got.edition}, ${got.source}`);
  revalidatePath("/settings/code-library");
  back("ok", `${n.toLocaleString("en-US")} ${codeSetLabel[codeSet]} loaded (${got.edition}).`);
}

// CPT comes from the practice's own licensed file.
export async function importCptFile(fd: FormData) {
  const user = await requireUser(ADMIN);
  if (fd.get("licensed") !== "on") back("error", "Tick the box to confirm the practice holds an AMA licence for the CPT file.");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) back("error", "Choose the CPT file to load.");
  const f = file as File;
  if (f.size > 20 * 1024 * 1024) back("error", "The file is larger than 20 MB.");
  if (!/\.(xlsx|csv|txt|tsv)$/i.test(f.name)) back("error", "Load an Excel (.xlsx) or CSV file.");
  let parsed: ReturnType<typeof readCodeFile>;
  try {
    parsed = readCodeFile(f.name, Buffer.from(await f.arrayBuffer()));
  } catch {
    back("error", "The file could not be read. Save it as CSV and load that.");
  }
  if (parsed.rows.length === 0) back("error", parsed.problem ?? "No codes were found in the file.");
  const n = await replaceCodeSet("CPT", parsed.rows, String(fd.get("edition") ?? "").trim().slice(0, 40) || f.name.slice(0, 40));
  await logAudit(user.practiceId, user.id, "LOAD_CPT_FILE", "MasterCode", "CPT", `${n} codes from ${f.name}`);
  revalidatePath("/settings/code-library");
  back("ok", `${n.toLocaleString("en-US")} CPT codes loaded from ${f.name}.`);
}

// Code search for the pickers (charge schedules, code lists).
export async function lookupCodes(q: string, sets: CodeSet[]): Promise<CodeHit[]> {
  await requireUser(LOOKUP_ROLES);
  return searchMasterCodes(q, sets.filter((s) => s in codeSetLabel), 25);
}
