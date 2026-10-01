import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ORDER_ROLES, requisitionPdf } from "@/lib/orders";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(ORDER_ROLES);
  const { id } = await params;
  const o = await prisma.clinicalOrder.findFirst({ where: { id, practiceId: user.practiceId }, select: { id: true, requisition: true } });
  if (!o) return new NextResponse("Not found", { status: 404 });
  const pdf = await requisitionPdf(o.id, user.practiceId);
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="requisition-${o.requisition}.pdf"`, "Cache-Control": "no-store" } });
}
