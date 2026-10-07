"use server";

import { rolesFor } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { IMPORT_FIELDS, autoMap, commitImport, parseCsv, undoImport, validateImport } from "@/lib/patient-import";

const fail = (msg: string, id?: string) => redirect(`/settings/import?${id ? `batch=${id}&` : ""}error=${encodeURIComponent(msg)}`);

export async function uploadImport(fd: FormData) {
  const user = await requireUser(rolesFor("settings.admin"));
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) fail("Choose a CSV file.");
  const f = file as File;
  if (f.size > 10_000_000) fail("The file is larger than 10 MB — split it into smaller files.");
  if (!/\.(csv|txt|tsv)$/i.test(f.name)) fail("Save the spreadsheet as CSV (File → Save as → CSV) and upload that.");
  const table = parseCsv(await f.text());
  if (table.length < 2) fail("The file has no patient rows under the header.");
  if (table.length > 20001) fail("Up to 20,000 patients per file.");
  const mapping = autoMap(table[0]);
  const rows = await validateImport(user.practiceId, table, mapping);
  const batch = await prisma.importBatch.create({
    data: { practiceId: user.practiceId, fileName: f.name.slice(0, 200), mapping: JSON.stringify({ headers: table[0], map: mapping, table }), rows: JSON.stringify(rows), totalRows: rows.length, createdById: user.id },
  });
  redirect(`/settings/import?batch=${batch.id}`);
}

export async function remapImport(batchId: string, fd: FormData) {
  const user = await requireUser(rolesFor("settings.admin"));
  const batch = await prisma.importBatch.findFirst({ where: { id: batchId, practiceId: user.practiceId, status: "PREVIEW" } });
  if (!batch) fail("That import is no longer open.");
  const saved = JSON.parse(batch!.mapping) as { headers: string[]; table: string[][] };
  const map: Record<string, number> = {};
  for (const fld of IMPORT_FIELDS) {
    const v = String(fd.get(`map_${fld.key}`) ?? "");
    if (v !== "" && Number.isInteger(Number(v)) && Number(v) < saved.headers.length) map[fld.key] = Number(v);
  }
  const full = String(fd.get("map_fullName") ?? "");
  if (full !== "" && map.firstName === undefined && map.lastName === undefined) map.fullName = Number(full);
  const rows = await validateImport(user.practiceId, saved.table, map);
  await prisma.importBatch.update({ where: { id: batchId }, data: { mapping: JSON.stringify({ ...saved, map }), rows: JSON.stringify(rows) } });
  redirect(`/settings/import?batch=${batchId}`);
}

export async function runImport(batchId: string, fd: FormData) {
  const user = await requireUser(rolesFor("settings.admin"));
  if (fd.get("confirm") !== "on") fail("Tick the box to confirm.", batchId);
  let n = 0;
  try {
    n = await commitImport(batchId, user.practiceId, user.id);
  } catch (err) {
    fail((err as Error).message, batchId);
  }
  revalidatePath("/patients");
  redirect(`/settings/import?batch=${batchId}&imported=${n}`);
}

export async function undoImportBatch(batchId: string) {
  const user = await requireUser(rolesFor("settings.admin"));
  const r = await undoImport(batchId, user.practiceId, user.id);
  revalidatePath("/patients");
  redirect(`/settings/import?undone=${r.removed}&kept=${r.kept}`);
}

export async function discardImport(batchId: string) {
  const user = await requireUser(rolesFor("settings.admin"));
  await prisma.importBatch.deleteMany({ where: { id: batchId, practiceId: user.practiceId, status: "PREVIEW" } });
  redirect("/settings/import");
}
