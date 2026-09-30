import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { LETTER_ROLES, labelSheetPdf, type LabelKind } from "@/lib/letters";

export async function GET(req: NextRequest, { params }: { params: Promise<{ patientId: string }> }) {
  const user = await requireUser(LETTER_ROLES);
  const { patientId } = await params;
  const p = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId } });
  if (!p) return new NextResponse("Not found", { status: 404 });
  const q = req.nextUrl.searchParams;
  const kind = (["chart", "address", "barcode"].includes(q.get("kind") ?? "") ? q.get("kind") : "chart") as LabelKind;
  const count = Number(q.get("count") ?? "30") || 30;
  const start = Math.min(Math.max(Number(q.get("start") ?? "1") || 1, 1), 30);
  const pdf = await labelSheetPdf(kind, p, count, start);
  await logAudit(user.practiceId, user.id, "PRINT_LABELS", "Patient", p.id, `${count} ${kind} labels`);
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${kind}-labels.pdf"`, "Cache-Control": "no-store" } });
}
