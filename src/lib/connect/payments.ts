import "server-only";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { formatDate, formatMoney } from "@/lib/format";
import { claimNumber } from "@/lib/claim-format";
import { logClaimEvent, refreshVisitBillingStatus } from "@/lib/claims";
import { newToken, publicBase, sendMessage } from "@/lib/connect/core";

// Online bill pay. Card details are only ever entered on the payment provider's hosted checkout page
// (Stripe Checkout); CareHub never sees or stores card numbers. TEST simulates the provider.

export const PAYMENT_ROLES = ["ADMIN", "BILLER", "FRONT_DESK"];
export const PAYMENT_PROVIDERS: Record<string, string> = { TEST: "Test mode (no card is charged)", STRIPE: "Stripe Checkout" };
export const MIN_PAYMENT_CENTS = 100;

const OPEN = { notIn: ["VOID", "PAID", "WRITTEN_OFF"] };

export async function patientBalance(patientId: string) {
  const claims = await prisma.claim.findMany({
    where: { patientId, balanceResponsibility: "PATIENT", status: OPEN },
    include: { encounter: { include: { provider: true } } },
    orderBy: { createdAt: "asc" },
  });
  const items = claims
    .map((c) => ({ claim: c, due: Math.max(c.billedCents - c.paidCents - c.adjustedCents, 0) }))
    .filter((x) => x.due > 0)
    .map((x) => ({ claimId: x.claim.id, number: claimNumber(x.claim), date: x.claim.encounter.date, provider: x.claim.encounter.provider.name, dueCents: x.due }));
  return { items, totalCents: items.reduce((s, x) => s + x.dueCents, 0) };
}

export async function createPaymentLink(practiceId: string, patientId: string, userId: string | null, channel: "SMS" | "EMAIL" | "BOTH" | "LINK", origin: string | null) {
  const patient = await prisma.patient.findFirstOrThrow({ where: { id: patientId, practiceId }, include: { practice: { include: { connectSettings: true } } } });
  const { totalCents } = await patientBalance(patientId);
  if (totalCents < MIN_PAYMENT_CENTS) throw new Error("This patient has no balance to pay online.");
  // One live link per patient: older unpaid links are replaced.
  await prisma.patientPayment.updateMany({ where: { patientId, status: "SENT" }, data: { status: "CANCELLED" } });
  const pay = await prisma.patientPayment.create({
    data: {
      practiceId,
      patientId,
      token: newToken(),
      balanceCents: totalCents,
      provider: patient.practice.connectSettings?.paymentProvider ?? "TEST",
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      sentVia: channel,
      createdById: userId,
    },
  });
  const clinic = patient.practice.connectSettings?.displayName || patient.practice.name;
  const link = `${publicBase(origin)}/pay/${pay.token}`;
  const sent: string[] = [];
  for (const ch of channel === "BOTH" ? (["SMS", "EMAIL"] as const) : channel === "LINK" ? [] : [channel]) {
    const msg = await sendMessage({
      practiceId,
      channel: ch,
      to: ch === "SMS" ? patient.phone : patient.email,
      subject: `${clinic}: your balance of ${formatMoney(totalCents)}`,
      body:
        ch === "SMS"
          ? `${clinic}: Hi ${patient.firstName}, you have a balance of ${formatMoney(totalCents)}. Pay securely online: ${link}`
          : `Hi ${patient.firstName},\n\nYour account at ${clinic} has a balance of ${formatMoney(totalCents)} after insurance.\n\nYou can review and pay it securely online (you'll confirm your date of birth first): ${link}\n\nQuestions? Reply to this message or call our billing office.\n\n${clinic}`,
      kind: "OTHER",
      patientId,
      userId,
    });
    if (msg.status === "SENT") sent.push(msg.to);
  }
  await logAudit(practiceId, userId, "SEND_PAY_LINK", "PatientPayment", pay.id, `${formatMoney(totalCents)} via ${channel}${sent.length ? ` to ${sent.join(", ")}` : ""}`);
  return { pay, link, sent };
}

// ---- Hosted checkout ----

export async function startCheckout(pay: { id: string; token: string; provider: string }, amountCents: number, origin: string | null, patientEmail: string | null, clinic: string) {
  const base = publicBase(origin);
  if (pay.provider === "STRIPE") {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("Online card payments aren't connected yet. Please call the office to pay.");
    const body = new URLSearchParams({
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(amountCents),
      "line_items[0][price_data][product_data][name]": `${clinic} — patient balance`,
      success_url: `${base}/pay/${pay.token}/return?session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/pay/${pay.token}?cancelled=1`,
      client_reference_id: pay.id,
      ...(patientEmail ? { customer_email: patientEmail } : {}),
    });
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" }, body });
    const json = (await res.json()) as { url?: string; id?: string; error?: { message?: string } };
    if (!res.ok || !json.url) throw new Error(json.error?.message ?? "The payment page could not be opened.");
    await prisma.patientPayment.update({ where: { id: pay.id }, data: { amountCents, providerRef: json.id } });
    return json.url;
  }
  // Test mode: CareHub's own simulated checkout page (no card fields).
  await prisma.patientPayment.update({ where: { id: pay.id }, data: { amountCents } });
  return `${base}/pay/${pay.token}/test-checkout`;
}

// Confirms a Stripe Checkout session really was paid (never trust the redirect alone).
export async function verifyStripeSession(sessionId: string, payId: string) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return null;
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) return null;
  const s = (await res.json()) as { payment_status?: string; amount_total?: number; client_reference_id?: string; payment_intent?: string };
  if (s.payment_status !== "paid" || s.client_reference_id !== payId || !s.amount_total) return null;
  return { amountCents: s.amount_total, ref: s.payment_intent ?? sessionId };
}

// Posts a completed online payment: patient deposit, applied to the oldest balances first.
export async function recordOnlinePayment(payId: string, amountCents: number, providerRef: string) {
  const pay = await prisma.patientPayment.findUniqueOrThrow({ where: { id: payId }, include: { patient: true, practice: { include: { connectSettings: true } } } });
  if (pay.status === "PAID") return pay;
  const { items } = await patientBalance(pay.patientId);
  const deposit = await prisma.deposit.create({
    data: {
      practiceId: pay.practiceId,
      payerType: "PATIENT",
      payerName: `${pay.patient.firstName} ${pay.patient.lastName}`,
      paymentMethod: "CARD",
      checkNumber: providerRef.slice(0, 60),
      totalCents: amountCents,
      unappliedCents: amountCents,
      note: `Online payment (${PAYMENT_PROVIDERS[pay.provider] ?? pay.provider})`,
    },
  });
  let left = amountCents;
  for (const it of items) {
    if (left <= 0) break;
    const apply = Math.min(left, it.dueCents);
    const claim = await prisma.claim.findUniqueOrThrow({ where: { id: it.claimId } });
    const paid = claim.paidCents + apply;
    const balance = claim.billedCents - paid - claim.adjustedCents;
    await prisma.$transaction([
      prisma.paymentApplication.create({ data: { depositId: deposit.id, claimId: claim.id, amountCents: apply, type: "PAYMENT" } }),
      prisma.claim.update({ where: { id: claim.id }, data: { paidCents: paid, status: balance <= 0 ? "PAID" : claim.status } }),
    ]);
    await logClaimEvent(claim.id, null, "PAYMENT", { note: `Patient paid online $${(apply / 100).toFixed(2)}` });
    await refreshVisitBillingStatus(claim.encounterId);
    left -= apply;
  }
  await prisma.deposit.update({ where: { id: deposit.id }, data: { unappliedCents: left } });
  const done = await prisma.patientPayment.update({ where: { id: pay.id }, data: { status: "PAID", amountCents, providerRef, depositId: deposit.id, paidAt: new Date(), sessionHash: null } });
  await logAudit(pay.practiceId, null, "ONLINE_PAYMENT", "PatientPayment", pay.id, `${formatMoney(amountCents)}${left ? ` (${formatMoney(left)} unapplied credit)` : ""}`);
  const clinic = pay.practice.connectSettings?.displayName || pay.practice.name;
  if (pay.patient.email)
    await sendMessage({
      practiceId: pay.practiceId,
      channel: "EMAIL",
      to: pay.patient.email,
      subject: `${clinic}: payment receipt`,
      body: `Hi ${pay.patient.firstName},\n\nThank you — we received your payment of ${formatMoney(amountCents)} on ${formatDate(new Date())}.\nReference: ${providerRef}\n\n${clinic}`,
      kind: "OTHER",
      patientId: pay.patientId,
    });
  return done;
}
