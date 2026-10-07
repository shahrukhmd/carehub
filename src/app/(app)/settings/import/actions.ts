"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { rolesFor } from "@/lib/permissions";
import { parseCsv } from "@/lib/patient-import";
import { readXlsxRows } from "@/lib/xlsx-read";
import { FIELDS, IMPORT_KINDS, commitKind, proposeMapping, rememberMapping, undoKind, validateKind, type ImportKind } from "@/lib/import-kinds";

const fail = (msg: string, id?: string) => redirect(`/settings/import?${id ? `batch=${id}&` : ""}error=${encodeURIComponent(msg)}`);
const kindOf = (v: unknown): ImportKind => (String(v) in IMPORT_KINDS ? (String(v) as ImportKind) : "PATIENTS");

// Upload a CSV or spreadsheet for one kind of data; propose a mapping (saved for this practice and kind when
// the columns were seen before); run the dry-run validation; show the preview. Nothing is written.
export async function uploadImport(fd: FormData) {
  const user = await requireUser(rolesFor("settings.admin"));
  const kind = kindOf(fd.get("kind"));
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) fail("Choose a CSV or Excel file.");
  const f = file as File;
  if (f.size > 20_000_000) fail("The file is larger than 20 MB — split it into smaller files.");
  let table: string[][] = [];
  if (/\.xlsx$/i.test(f.name)) table = readXlsxRows(Buffer.from(await f.arrayBuffer()));
  else if (/\.(csv|txt|tsv)$/i.test(f.name)) table = parseCsv(await f.text());
  else fail("Upload a CSV or an .xlsx workbook.");
  if (table.length < 2) fail("The file has no data rows under the header.");
  if (table.length > 50_001) fail("Up to 50,000 rows per file.");
  const { map, savedName } = await proposeMapping(user.practiceId, kind, table[0]);
  const rows = await validateKind(kind, user.practiceId, table, map);
  const batch = await prisma.importBatch.create({
    data: { practiceId: user.practiceId, kind, fileName: f.name.slice(0, 200), mapping: JSON.stringify({ headers: table[0], map, table, savedName }), rows: JSON.stringify(rows), totalRows: rows.length, createdById: user.id },
  });
  redirect(`/settings/import?batch=${batch.id}`);
}

export async function remapImport(batchId: string, fd: FormData) {
  const user = await requireUser(rolesFor("settings.admin"));
  const batch = await prisma.importBatch.findFirst({ where: { id: batchId, practiceId: user.practiceId, status: "PREVIEW" } });
  if (!batch) fail("That import is no longer open.");
  const kind = kindOf(batch!.kind);
  const saved = JSON.parse(batch!.mapping) as { headers: string[]; table: string[][] };
  const map: Record<string, number> = {};
  for (const fld of FIELDS[kind]) {
    const v = String(fd.get(`map_${fld.key}`) ?? "");
    if (v !== "" && Number.isInteger(Number(v)) && Number(v) < saved.headers.length) map[fld.key] = Number(v);
  }
  const full = String(fd.get("map_fullName") ?? "");
  if (kind === "PATIENTS" && full !== "" && map.firstName === undefined && map.lastName === undefined) map.fullName = Number(full);
  const rows = await validateKind(kind, user.practiceId, saved.table, map);
  let savedName: string | null = null;
  if (fd.get("remember") === "on") {
    const name = String(fd.get("mappingName") ?? "").trim().slice(0, 80) || `${IMPORT_KINDS[kind].label} · ${batch!.fileName}`;
    await rememberMapping(user.practiceId, kind, saved.headers, map, name);
    savedName = name;
  }
  await prisma.importBatch.update({ where: { id: batchId }, data: { mapping: JSON.stringify({ ...saved, map, savedName }), rows: JSON.stringify(rows) } });
  redirect(`/settings/import?batch=${batchId}`);
}

export async function runImport(batchId: string, fd: FormData) {
  const user = await requireUser(rolesFor("settings.admin"));
  if (fd.get("confirm") !== "on") fail("Tick the box to confirm.", batchId);
  const batch = await prisma.importBatch.findFirst({ where: { id: batchId, practiceId: user.practiceId } });
  if (!batch) fail("Import not found.");
  let n = 0;
  let problem: string | null = null;
  try {
    n = await commitKind(kindOf(batch!.kind), batchId, user.practiceId, user.id);
  } catch (err) {
    problem = (err as Error).message;
  }
  if (problem) fail(problem, batchId);
  revalidatePath("/patients");
  revalidatePath("/billing");
  revalidatePath("/schedule");
  redirect(`/settings/import?batch=${batchId}&imported=${n}`);
}

export async function undoImportBatch(batchId: string) {
  const user = await requireUser(rolesFor("settings.admin"));
  const batch = await prisma.importBatch.findFirst({ where: { id: batchId, practiceId: user.practiceId } });
  if (!batch) fail("Import not found.");
  const r = await undoKind(kindOf(batch!.kind), batchId, user.practiceId, user.id);
  revalidatePath("/patients");
  revalidatePath("/billing");
  redirect(`/settings/import?undone=${r.removed}&kept=${r.kept}`);
}

export async function discardImport(batchId: string) {
  const user = await requireUser(rolesFor("settings.admin"));
  await prisma.importBatch.deleteMany({ where: { id: batchId, practiceId: user.practiceId, status: "PREVIEW" } });
  redirect("/settings/import");
}
