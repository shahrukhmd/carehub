import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { rolesFor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { toCsv } from "@/lib/financial-reports";
import { BOARD_FILTER_KEYS, DEFAULT_EXPORT, EXPORT_COLUMNS, loadBoard, type BoardFilters } from "@/lib/gis/board";
import { getGisSettings } from "@/lib/gis/settings";
import { xlsx } from "@/lib/gis/xlsx-write";

// The GIS patients board as a spreadsheet: the current filters (or ticked ids) and the chosen columns. It carries
// patient details, so every export is written to the audit log.
export async function GET(req: NextRequest) {
  const user = await requireUser(rolesFor("gis.view"));
  const q = req.nextUrl.searchParams;
  const filters: BoardFilters = {};
  for (const k of BOARD_FILTER_KEYS) if (q.get(k)) filters[k] = q.get(k)!;
  const ids = q.getAll("ids").filter((id) => /^[a-z0-9]{10,40}$/.test(id));
  const cols = (q.getAll("cols").length ? q.getAll("cols") : DEFAULT_EXPORT).map((k) => EXPORT_COLUMNS.find((c) => c.key === k)).filter((c): c is (typeof EXPORT_COLUMNS)[number] => Boolean(c));
  const settings = await getGisSettings(user.practiceId);
  const { rows } = await loadBoard(user.practiceId, filters, { all: true, nameFormat: settings.nameFormat });
  const picked = ids.length ? rows.filter((r) => ids.includes(r.id)) : rows;
  await logAudit(user.practiceId, user.id, "GIS_EXPORT", "Report", "gis-patients", `${picked.length} patients · cols ${cols.map((c) => c.key).join(",")} · ${new URLSearchParams(filters as Record<string, string>).toString().slice(0, 300)}`);
  const stamp = new Date().toISOString().slice(0, 10);
  const cells = picked.map((r) => cols.map((c) => c.cell(r)));
  if (q.get("format") === "xlsx") {
    const body = xlsx("Patients", cols.map((c) => c.label), cells);
    return new NextResponse(new Uint8Array(body), {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="gis-patients-${stamp}.xlsx"`, "Cache-Control": "no-store" },
    });
  }
  const csv = toCsv({ columns: cols.map((c) => c.label), rows: cells });
  return new NextResponse("﻿" + csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="gis-patients-${stamp}.csv"`, "Cache-Control": "no-store" },
  });
}
