import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { chartAccess } from "@/lib/privacy";
import { prisma } from "@/lib/prisma";
import { REFERRAL_ROLES, referralLetterPdf } from "@/lib/referrals";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(REFERRAL_ROLES);
  const { id } = await params;
  const r = await prisma.outgoingReferral.findFirst({ where: { id, practiceId: user.practiceId }, select: { id: true, patientId: true } });
  if (!r) return new NextResponse("Not found", { status: 404 });
  if ((await chartAccess(user, r.patientId)) === "BLOCKED") return new NextResponse("This chart is restricted", { status: 403 });
  const pdf = await referralLetterPdf(r.id, user.practiceId);
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="referral-${r.id}.pdf"`, "Cache-Control": "no-store" } });
}
