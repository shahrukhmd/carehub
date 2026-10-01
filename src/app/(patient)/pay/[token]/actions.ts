"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashToken, newToken } from "@/lib/connect/core";
import { MIN_PAYMENT_CENTS, patientBalance, recordOnlinePayment, startCheckout } from "@/lib/connect/payments";
import { testPaymentsAllowed } from "@/lib/connect/pay-session";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const valid = (t: string) => /^[A-Za-z0-9_-]{20,64}$/.test(t);

async function load(token: string) {
  if (!valid(token)) redirect("/");
  const pay = await prisma.patientPayment.findUnique({ where: { token }, include: { patient: true, practice: { include: { connectSettings: true } } } });
  if (!pay || pay.status !== "SENT" || pay.expiresAt < new Date()) redirect(`/pay/${token}`);
  return pay;
}

async function verified(pay: { id: string; sessionHash: string | null }) {
  const v = (await cookies()).get(`pp_pay_${pay.id}`)?.value;
  return Boolean(v && pay.sessionHash && hashToken(v) === pay.sessionHash);
}

export async function verifyPayDob(token: string, fd: FormData) {
  const pay = await load(token);
  if (pay.lockedUntil && pay.lockedUntil > new Date()) redirect(`/pay/${token}?error=locked`);
  if (String(fd.get("dob") ?? "") !== pay.patient.dob.toISOString().slice(0, 10)) {
    const n = pay.verifyAttempts + 1;
    await prisma.patientPayment.update({
      where: { id: pay.id },
      data: n >= MAX_ATTEMPTS ? { verifyAttempts: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { verifyAttempts: n },
    });
    redirect(`/pay/${token}?error=${n >= MAX_ATTEMPTS ? "locked" : "dob"}`);
  }
  const key = newToken();
  (await cookies()).set(`pp_pay_${pay.id}`, key, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60, secure: process.env.NODE_ENV === "production" });
  await prisma.patientPayment.update({ where: { id: pay.id }, data: { sessionHash: hashToken(key), verifyAttempts: 0, lockedUntil: null } });
  redirect(`/pay/${token}`);
}

export async function startPayment(token: string, fd: FormData) {
  const pay = await load(token);
  if (!(await verified(pay))) redirect(`/pay/${token}`);
  const { totalCents } = await patientBalance(pay.patientId);
  const choice = String(fd.get("choice") ?? "full");
  const other = Math.round(Number(String(fd.get("amount") ?? "").replace(/[$,\s]/g, "")) * 100);
  const amount = choice === "full" ? totalCents : other;
  if (!Number.isFinite(amount) || amount < MIN_PAYMENT_CENTS || amount > totalCents) redirect(`/pay/${token}?error=amount`);
  const h = await headers();
  const origin = h.get("host") ? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}` : null;
  let url: string;
  try {
    url = await startCheckout(pay, amount, origin, pay.patient.email, pay.practice.connectSettings?.displayName || pay.practice.name);
  } catch (err) {
    redirect(`/pay/${token}?error=${encodeURIComponent((err as Error).message).slice(0, 200)}`);
  }
  redirect(url);
}

// Test mode only: stands in for the provider's hosted checkout.
export async function completeTestPayment(token: string, fd: FormData) {
  const pay = await load(token);
  if (pay.provider !== "TEST" || !testPaymentsAllowed()) redirect(`/pay/${token}`);
  if (!(await verified(pay)) || !pay.amountCents) redirect(`/pay/${token}`);
  if (fd.get("outcome") !== "approve") redirect(`/pay/${token}?cancelled=1`);
  await recordOnlinePayment(pay.id, pay.amountCents, `TEST-${newToken().slice(0, 10).toUpperCase()}`);
  redirect(`/pay/${token}`);
}
