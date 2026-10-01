import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney } from "@/lib/format";
import { hashToken } from "@/lib/connect/core";
import { patientBalance } from "@/lib/connect/payments";
import { PortalShell } from "../../portal-shell";
import { startPayment, verifyPayDob } from "./actions";

const ERRORS: Record<string, string> = {
  dob: "That date of birth doesn't match our records. Please try again.",
  locked: "Too many attempts. For your security this link is paused for 15 minutes.",
  amount: "Enter an amount between $1.00 and your balance.",
  notpaid: "The payment wasn't completed. You have not been charged.",
};

export default async function PayPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string; cancelled?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
  const pay = await prisma.patientPayment.findUnique({ where: { token }, include: { patient: true, practice: { include: { connectSettings: true } } } });
  if (!pay) notFound();
  const brand = pay.practice.connectSettings;
  const shell = (c: React.ReactNode) => (
    <PortalShell brand={brand} fallbackName={pay.practice.name}>
      {c}
    </PortalShell>
  );
  const error = sp.error ? (ERRORS[sp.error] ?? sp.error) : null;

  if (pay.status === "PAID")
    return shell(
      <div className="pp-card pp-center">
        <div className="pp-check" aria-hidden="true">
          ✓
        </div>
        <h1>Payment received — thank you!</h1>
        <p>
          {formatMoney(pay.amountCents ?? 0)} paid on {pay.paidAt ? formatDate(pay.paidAt) : ""}.
        </p>
        <p className="pp-muted pp-small">Reference {pay.providerRef}. A receipt has been emailed if we have your email address.</p>
      </div>
    );
  if (pay.status !== "SENT" || pay.expiresAt < new Date())
    return shell(
      <div className="pp-card pp-center">
        <h1>This payment link is no longer active</h1>
        <p>Please contact the office for a new link or to pay by phone.</p>
      </div>
    );
  if (!brand?.paymentsEnabled)
    return shell(
      <div className="pp-card pp-center">
        <h1>Online payments are not available</h1>
        <p>Please call the office to pay your balance.</p>
      </div>
    );

  const key = (await cookies()).get(`pp_pay_${pay.id}`)?.value;
  const ok = Boolean(key && pay.sessionHash && hashToken(key) === pay.sessionHash);
  if (!ok) {
    const locked = pay.lockedUntil && pay.lockedUntil > new Date();
    return shell(
      <form action={verifyPayDob.bind(null, token)} className="pp-card">
        <h1>Hi {pay.patient.firstName}</h1>
        <p>To view and pay your balance securely, enter your date of birth.</p>
        {error && (
          <p className="pp-error" role="alert">
            {error}
          </p>
        )}
        <label className="pp-label">
          Date of birth
          <input type="date" name="dob" required disabled={Boolean(locked)} className="pp-input" />
        </label>
        <button className="pp-btn" type="submit" disabled={Boolean(locked)}>
          Continue
        </button>
      </form>
    );
  }

  const { items, totalCents } = await patientBalance(pay.patientId);
  if (totalCents === 0)
    return shell(
      <div className="pp-card pp-center">
        <h1>You&apos;re all paid up</h1>
        <p>There is no balance on your account right now.</p>
      </div>
    );
  return shell(
    <form action={startPayment.bind(null, token)} className="pp-card">
      <h1>Your balance</h1>
      {error && (
        <p className="pp-error" role="alert">
          {error}
        </p>
      )}
      {sp.cancelled && <p className="pp-muted">Payment cancelled — you have not been charged.</p>}
      <ul className="pp-review">
        {items.map((it) => (
          <li key={it.claimId} className="pp-bill">
            <span>
              Visit {formatDate(it.date)} · {it.provider}
            </span>
            <strong>{formatMoney(it.dueCents)}</strong>
          </li>
        ))}
      </ul>
      <p className="pp-bill pp-bill-total">
        <span>Total due</span>
        <strong>{formatMoney(totalCents)}</strong>
      </p>
      <fieldset className="pp-choice-set">
        <label className="pp-radio">
          <input type="radio" name="choice" value="full" defaultChecked /> Pay the full balance ({formatMoney(totalCents)})
        </label>
        <label className="pp-radio">
          <input type="radio" name="choice" value="other" /> Pay another amount
        </label>
        <input name="amount" inputMode="decimal" placeholder="$0.00" className="pp-input" aria-label="Amount" />
      </fieldset>
      <button className="pp-btn" type="submit">
        Continue to secure payment
      </button>
      <p className="pp-muted pp-small">
        {pay.provider === "STRIPE" ? "You'll enter your card on Stripe's secure page — we never see your card number." : "Test mode — no card is charged."}
      </p>
    </form>
  );
}
