"use server";

import { rolesFor } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { codeSetLabel, fetchHcpcs, fetchIcd10, readCodeFile, replaceCodeSet, searchMasterCodes, type CodeHit, type CodeSet } from "@/lib/master-codes";

const ADMIN = ["ADMIN"];
const LOOKUP_ROLES = rolesFor("codes.lookup");

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
  if (q.trim().length < 2) return [];
  return searchMasterCodes(q, sets.filter((s) => s in codeSetLabel), 25);
}

// Adds the ticked billing codes to a charge schedule. They go on with no fee; the fee is entered on the schedule.
export async function addCodesToSchedule(fd: FormData) {
  const user = await requireUser(rolesFor("billing.work"));
  const q = String(fd.get("q") ?? "");
  const set = String(fd.get("set") ?? "");
  function here(key: "ok" | "error", message: string, scheduleId?: string): never {
    redirect(`/settings/code-library?q=${encodeURIComponent(q)}&set=${encodeURIComponent(set)}&${key}=${encodeURIComponent(message.slice(0, 300))}${scheduleId ? `&added=${scheduleId}` : ""}#lookup`);
  }

  const schedule = await prisma.chargeSchedule.findFirst({ where: { id: String(fd.get("scheduleId") ?? ""), practiceId: user.practiceId }, include: { items: { select: { code: true } } } });
  if (!schedule) here("error", "Choose the charge schedule to add the codes to.");
  // Each tick is "SET|CODE"; only billing codes belong on a charge schedule.
  const picked = fd
    .getAll("pick")
    .map((v) => String(v).split("|"))
    .filter(([codeSet, code]) => ["CPT", "HCPCS"].includes(codeSet) && /^[A-Z0-9]{5}$/.test(code ?? ""));
  if (picked.length === 0) here("error", "Tick the billing codes to add.");
  if (picked.length > 500) here("error", "Add up to 500 codes at a time.");

  const codes = await prisma.masterCode.findMany({ where: { codeSet: { in: ["CPT", "HCPCS"] }, code: { in: picked.map(([, code]) => code) }, billable: true } });
  const have = new Set(schedule.items.map((i) => i.code));
  const fresh = [...new Map(codes.filter((c) => !have.has(c.code)).map((c) => [c.code, c])).values()];
  if (fresh.length) {
    await prisma.chargeScheduleItem.createMany({ data: fresh.map((c) => ({ scheduleId: schedule.id, code: c.code, description: c.description.slice(0, 300), feeCents: 0 })) });
    await logAudit(user.practiceId, user.id, "ADD_CHARGE_SCHEDULE_CODES", "ChargeSchedule", schedule.id, `${fresh.length} from the code library: ${fresh.map((c) => c.code).slice(0, 40).join(", ")}`);
  }
  revalidatePath("/settings/charge-schedules");
  revalidatePath(`/settings/charge-schedules/${schedule.id}`);
  const skipped = picked.length - fresh.length;
  here(
    "ok",
    `${fresh.length} code${fresh.length === 1 ? "" : "s"} added to ${schedule.name} with no fee yet${skipped ? `; ${skipped} already on it` : ""}. Enter the fees on the schedule.`,
    schedule.id
  );
}
