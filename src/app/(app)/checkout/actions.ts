"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { CHECKOUT_ROLES, PAY_METHODS, RECEIPT_KINDS, applyPatientCredit, collectPayment, voidReceipt } from "@/lib/checkout";
import { rolesFor } from "@/lib/permissions";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function collect(fd: FormData) {
  const user = await requireUser(CHECKOUT_ROLES);
  const appointmentId = str(fd, "appointmentId") || null;
  const appt = appointmentId ? await prisma.appointment.findFirst({ where: { id: appointmentId, practiceId: user.practiceId }, include: { encounter: true } }) : null;
  const patientId = appt?.patientId ?? str(fd, "patientId");
  const back = appt ? `/checkout?appointmentId=${appt.id}` : `/checkout?patientId=${patientId}`;
  const amount = Math.round(Number(str(fd, "amount").replace(/[$,\s]/g, "")) * 100);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) redirect(`${back}&error=${encodeURIComponent("Enter the amount collected.")}`);
  const kind = RECEIPT_KINDS[str(fd, "kind")] ? str(fd, "kind") : "COPAY";
  const method = PAY_METHODS[str(fd, "method")] ? str(fd, "method") : "CASH";
  if (method === "CHECK" && !str(fd, "reference")) redirect(`${back}&error=${encodeURIComponent("Enter the check number.")}`);
  try {
    const { receipt } = await collectPayment({ practiceId: user.practiceId, patientId, appointmentId: appt?.id ?? null, encounterId: appt?.encounter?.id ?? null, amountCents: amount, kind, method, reference: str(fd, "reference") || null, note: str(fd, "note") || null, userId: user.id });
    revalidatePath("/checkout");
    revalidatePath("/schedule");
    revalidatePath(`/patients/${patientId}`);
    redirect(`${back}&receipt=${receipt.id}`);
  } catch (err) {
    if ((err as { digest?: string }).digest?.startsWith("NEXT_")) throw err;
    redirect(`${back}&error=${encodeURIComponent((err as Error).message)}`);
  }
}

export async function setCopay(appointmentId: string, fd: FormData) {
  const user = await requireUser(CHECKOUT_ROLES);
  const raw = str(fd, "copay");
  const cents = raw === "" ? null : Math.round(Number(raw.replace(/[$,\s]/g, "")) * 100);
  if (cents !== null && (!Number.isFinite(cents) || cents < 0)) redirect(`/checkout?appointmentId=${appointmentId}&error=${encodeURIComponent("Copay must be a dollar amount.")}`);
  await prisma.appointment.updateMany({ where: { id: appointmentId, practiceId: user.practiceId }, data: { copayDueCents: cents } });
  revalidatePath("/schedule");
  redirect(`/checkout?appointmentId=${appointmentId}`);
}

export async function applyCredit(patientId: string, fd: FormData) {
  const user = await requireUser(CHECKOUT_ROLES);
  const p = await prisma.patient.findFirst({ where: { id: patientId, practiceId: user.practiceId } });
  if (p) await applyPatientCredit(p.id, user.id);
  redirect(str(fd, "back").startsWith("/checkout") ? str(fd, "back") : `/checkout?patientId=${patientId}`);
}

export async function voidPayment(receiptId: string, fd: FormData) {
  const user = await requireUser(rolesFor("checkout.work"));
  const back = str(fd, "back").startsWith("/checkout") ? str(fd, "back") : "/checkout";
  try {
    await voidReceipt(receiptId, user.practiceId, user.id, str(fd, "reason") || "Voided at the desk");
  } catch (err) {
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent((err as Error).message)}`);
  }
  revalidatePath("/checkout");
  redirect(back);
}
