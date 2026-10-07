import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { rolesFor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { reportRange, toCsv } from "@/lib/financial-reports";
import { OPS_REPORTS, runOpsReport } from "@/lib/ops-reports";

export async function GET(req: NextRequest) {
  const user = await requireUser(rolesFor("reports.ops"));
  const q = req.nextUrl.searchParams;
  const key = OPS_REPORTS.some(([k]) => k === q.get("r")) ? q.get("r")! : "daily";
  const { from, to } = reportRange({ from: q.get("from") ?? undefined, to: q.get("to") ?? undefined });
  const table = await runOpsReport(user.practiceId, key, from, to);
  await logAudit(user.practiceId, user.id, "EXPORT_REPORT", "Report", key, `${table.rows.length} rows`);
  return new NextResponse("\uFEFF" + toCsv(table), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="carehub-${key}-${from.toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
  });
}
