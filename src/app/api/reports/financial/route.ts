import { rolesFor } from "@/lib/permissions";
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { REPORTS, reportRange, runReport, toCsv } from "@/lib/financial-reports";

export async function GET(req: NextRequest) {
  const user = await requireUser(rolesFor("billing.work"));
  const q = req.nextUrl.searchParams;
  const key = REPORTS.some(([k]) => k === q.get("r")) ? q.get("r")! : "collections";
  const { from, to } = reportRange({ from: q.get("from") ?? undefined, to: q.get("to") ?? undefined });
  const table = await runReport(user.practiceId, key, from, to, q.get("patientId") ?? undefined);
  await logAudit(user.practiceId, user.id, "EXPORT_REPORT", "Report", key, `${table.rows.length} rows`);
  return new NextResponse("﻿" + toCsv(table), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="carehub-${key}-${from.toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
