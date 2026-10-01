import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordOnlinePayment, verifyStripeSession } from "@/lib/connect/payments";

// Stripe Checkout returns here; the payment is confirmed with Stripe before anything is posted.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const back = new URL(`/pay/${token}`, req.nextUrl.origin);
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  const pay = await prisma.patientPayment.findUnique({ where: { token } });
  const session = req.nextUrl.searchParams.get("session") ?? "";
  if (pay && pay.status === "SENT" && pay.provider === "STRIPE" && session === pay.providerRef) {
    const ok = await verifyStripeSession(session, pay.id);
    if (ok) await recordOnlinePayment(pay.id, ok.amountCents, ok.ref);
    else back.searchParams.set("error", "notpaid");
  }
  return NextResponse.redirect(back);
}
