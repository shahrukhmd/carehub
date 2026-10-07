import { rolesFor } from "@/lib/permissions";
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { buildVxuBatch } from "@/lib/immunizations";

// Immunization registry (IIS) file: HL7 v2.5.1 VXU batch. ?mark=1 records the doses as reported.
export async function GET(req: NextRequest) {
  const user = await requireUser(rolesFor("settings.admin"));
  const q = req.nextUrl.searchParams;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.get("from") ?? "") ? new Date(`${q.get("from")}T00:00:00`) : new Date(Date.now() - 30 * 86_400_000);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.get("to") ?? "") ? new Date(`${q.get("to")}T23:59:59`) : new Date();
  const { body, count, ids } = await buildVxuBatch(user.practiceId, from, to, q.get("unreported") === "1");
  if (q.get("mark") === "1" && ids.length) await prisma.immunization.updateMany({ where: { id: { in: ids } }, data: { reportedAt: new Date() } });
  await logAudit(user.practiceId, user.id, "EXPORT_VXU", "Immunization", "batch", `${count} doses`);
  return new NextResponse(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="vxu-${/^\d{4}-\d{2}-\d{2}$/.test(q.get("from") ?? "") ? q.get("from") : "recent"}-${/^\d{4}-\d{2}-\d{2}$/.test(q.get("to") ?? "") ? q.get("to") : "today"}.hl7"`, "Cache-Control": "no-store" } });
}
