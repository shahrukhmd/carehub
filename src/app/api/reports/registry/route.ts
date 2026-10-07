import { rolesFor } from "@/lib/permissions";
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { toCsv } from "@/lib/financial-reports";
import { REGISTRY_KEYS, registryTable, runRegistry, type RegistryCriteria } from "@/lib/registry";

// The registry list as a spreadsheet. It carries patient details, so every export is written to the audit log.
export async function GET(req: NextRequest) {
  const user = await requireUser(rolesFor("reports.export"));
  const q = req.nextUrl.searchParams;
  const criteria: RegistryCriteria = {};
  for (const k of REGISTRY_KEYS) if (q.get(k)) criteria[k] = q.get(k)!;
  const result = await runRegistry(user.practiceId, criteria, { includeRestricted: user.role === "ADMIN" });
  await logAudit(user.practiceId, user.id, "EXPORT_REGISTRY", "Report", "registry", `${result.rows.length} patients · ${new URLSearchParams(criteria as Record<string, string>).toString().slice(0, 300)}`);
  return new NextResponse("﻿" + toCsv(registryTable(result)), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="carehub-registry-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
  });
}
