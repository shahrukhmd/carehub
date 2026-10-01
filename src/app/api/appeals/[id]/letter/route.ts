import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DENIAL_ROLES, appealLetterPdf } from "@/lib/denials";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(DENIAL_ROLES);
  const { id } = await params;
  const a = await prisma.claimAppeal.findFirst({ where: { id, practiceId: user.practiceId }, select: { id: true } });
  if (!a) return new NextResponse("Not found", { status: 404 });
  const pdf = await appealLetterPdf(a.id, user.practiceId);
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="appeal-${a.id}.pdf"`, "Cache-Control": "no-store" } });
}
