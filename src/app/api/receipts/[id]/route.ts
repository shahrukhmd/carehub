import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CHECKOUT_ROLES, receiptPdf } from "@/lib/checkout";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(CHECKOUT_ROLES);
  const { id } = await params;
  const r = await prisma.receipt.findFirst({ where: { id, practiceId: user.practiceId }, select: { id: true, number: true } });
  if (!r) return new NextResponse("Not found", { status: 404 });
  const pdf = await receiptPdf(r.id, user.practiceId);
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="receipt-${r.number}.pdf"`, "Cache-Control": "no-store" } });
}
