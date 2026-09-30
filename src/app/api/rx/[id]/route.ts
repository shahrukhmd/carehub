import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RX_VIEW_ROLES, prescriptionPdf } from "@/lib/prescriptions";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(RX_VIEW_ROLES);
  const { id } = await params;
  const rx = await prisma.prescription.findFirst({ where: { id, practiceId: user.practiceId }, select: { id: true, drug: true } });
  if (!rx) return new NextResponse("Not found", { status: 404 });
  const pdf = await prescriptionPdf(rx.id, user.practiceId);
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="prescription-${rx.id}.pdf"`, "Cache-Control": "no-store" },
  });
}
