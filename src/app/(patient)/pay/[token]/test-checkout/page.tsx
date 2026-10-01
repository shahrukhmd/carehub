import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/format";
import { testPaymentsAllowed } from "@/lib/connect/pay-session";
import { PortalShell } from "../../../portal-shell";
import { completeTestPayment } from "../actions";

// Stand-in for the payment provider's hosted checkout while payments are in test mode. No card fields.
export default async function TestCheckoutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
  const pay = await prisma.patientPayment.findUnique({ where: { token }, include: { practice: { include: { connectSettings: true } } } });
  if (!pay || pay.provider !== "TEST" || pay.status !== "SENT" || !pay.amountCents || !testPaymentsAllowed()) notFound();
  return (
    <PortalShell brand={pay.practice.connectSettings} fallbackName={pay.practice.name}>
      <form action={completeTestPayment.bind(null, token)} className="pp-card pp-center">
        <p className="pp-error">TEST MODE — this is not a real payment page and no card is charged.</p>
        <h1>Pay {formatMoney(pay.amountCents)}</h1>
        <p className="pp-muted">In live mode the patient enters their card on the payment provider&apos;s secure page here.</p>
        <div className="pp-choice">
          <button className="pp-btn" type="submit" name="outcome" value="approve">
            Simulate successful payment
          </button>
          <button className="pp-btn pp-btn-ghost" type="submit" name="outcome" value="decline">
            Simulate declined / cancelled
          </button>
        </div>
      </form>
    </PortalShell>
  );
}
