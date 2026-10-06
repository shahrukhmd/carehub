import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { chartAccess } from "@/lib/privacy";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { buildCcd } from "@/lib/ccda";
import { rolesFor } from "@/lib/permissions";

export async function GET(_req: Request, { params }: { params: Promise<{ patientId: string }> }) {
  const user = await requireUser(rolesFor("records.exchange"));
  const { patientId } = await params;
  const p = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId } });
  if (!p) return new NextResponse("Not found", { status: 404 });
  if ((await chartAccess(user, p.id)) === "BLOCKED") return new NextResponse("This chart is restricted", { status: 403 });
  const xml = await buildCcd(user.practiceId, p.id, user.id);
  await logAudit(user.practiceId, user.id, "EXPORT_CCDA", "Patient", p.id, "Continuity of Care Document");
  return new NextResponse(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="CCD-${p.mrn}-${new Date().toISOString().slice(0, 10)}.xml"`, "Cache-Control": "no-store" },
  });
}
