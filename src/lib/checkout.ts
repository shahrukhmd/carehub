import "server-only";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { formatDate, formatMoney } from "@/lib/format";
import { logClaimEvent, refreshVisitBillingStatus } from "@/lib/claims";
import { Flow, MUTED, letterhead, newPdf } from "@/lib/pdf-kit";
import { practiceLetterhead } from "@/lib/prescriptions";
import { patientBalance } from "@/lib/connect/payments";

// Front-desk checkout: copays, balances and prepayments taken at the desk, with receipts.

export const CHECKOUT_ROLES = ["ADMIN", "FRONT_DESK", "BILLER", "SCHEDULER"];
export const RECEIPT_KINDS: Record<string, string> = { COPAY: "Copay", BALANCE: "Payment on balance", PREPAY: "Prepayment / deposit", OTHER: "Other" };
export const PAY_METHODS: Record<string, string> = { CASH: "Cash", CHECK: "Check", CARD: "Card (on the card terminal)", OTHER: "Other" };

// Copay expected for a visit: set on the appointment, else the latest eligibility response, else the card on file.
export async function copayFor(appointmentId: string) {
  const a = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
  if (a.copayDueCents !== null) return { cents: a.copayDueCents, source: "Set on the appointment" };
  const elig = await prisma.eligibilityCheck.findFirst({ where: { patientId: a.patientId, copayCents: { not: null }, checkedAt: { gte: new Date(Date.now() - 45 * 86_400_000) } }, orderBy: { checkedAt: "desc" } });
  if (elig?.copayCents !== null && elig?.copayCents !== undefined) return { cents: elig.copayCents, source: `Eligibility ${formatDate(elig.checkedAt)}` };
  const ins = await prisma.insurance.findFirst({ where: { patientId: a.patientId, active: true, isPrimary: true } });
  if (ins?.copayCents !== null && ins?.copayCents !== undefined) return { cents: ins.copayCents, source: "Insurance card on file" };
  return { cents: null as number | null, source: "Unknown — check eligibility" };
}

export async function collectedFor(appointmentId: string) {
  const rs = await prisma.receipt.findMany({ where: { appointmentId, voidedAt: null } });
  return { copay: rs.filter((r) => r.kind === "COPAY").reduce((s, r) => s + r.amountCents, 0), total: rs.reduce((s, r) => s + r.amountCents, 0) };
}

export async function patientCredit(patientId: string) {
  const deps = await prisma.deposit.findMany({ where: { patientId, payerType: "PATIENT", unappliedCents: { gt: 0 } } });
  return deps.reduce((s, d) => s + d.unappliedCents, 0);
}

// Applies the patient's unapplied desk payments to their open patient-responsibility claims, oldest first.
export async function applyPatientCredit(patientId: string, userId: string | null) {
  const deps = await prisma.deposit.findMany({ where: { patientId, payerType: "PATIENT", unappliedCents: { gt: 0 } }, orderBy: { postedAt: "asc" } });
  if (!deps.length) return 0;
  const { items } = await patientBalance(patientId);
  let applied = 0;
  for (const it of items) {
    let due = it.dueCents;
    for (const d of deps) {
      if (due <= 0) break;
      if (d.unappliedCents <= 0) continue;
      const amt = Math.min(due, d.unappliedCents);
      const claim = await prisma.claim.findUniqueOrThrow({ where: { id: it.claimId } });
      const paid = claim.paidCents + amt;
      await prisma.$transaction([
        prisma.paymentApplication.create({ data: { depositId: d.id, claimId: claim.id, amountCents: amt, type: "PAYMENT" } }),
        prisma.deposit.update({ where: { id: d.id }, data: { unappliedCents: d.unappliedCents - amt } }),
        prisma.claim.update({ where: { id: claim.id }, data: { paidCents: paid, status: claim.billedCents - paid - claim.adjustedCents <= 0 ? "PAID" : claim.status } }),
      ]);
      d.unappliedCents -= amt;
      due -= amt;
      applied += amt;
      await logClaimEvent(claim.id, userId, "PAYMENT", { note: `Patient payment applied from desk collection $${(amt / 100).toFixed(2)}` });
      await refreshVisitBillingStatus(claim.encounterId);
    }
  }
  return applied;
}

async function nextReceiptNumber(practiceId: string) {
  const d = new Date();
  const prefix = `RC${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const n = await prisma.receipt.count({ where: { practiceId, number: { startsWith: prefix } } });
  return `${prefix}-${String(n + 1).padStart(3, "0")}`;
}

export async function collectPayment(input: { practiceId: string; patientId: string; appointmentId?: string | null; encounterId?: string | null; amountCents: number; kind: string; method: string; reference?: string | null; note?: string | null; userId: string }) {
  const patient = await prisma.patient.findFirstOrThrow({ where: { id: input.patientId, practiceId: input.practiceId } });
  const deposit = await prisma.deposit.create({
    data: {
      practiceId: input.practiceId,
      patientId: patient.id,
      payerType: "PATIENT",
      payerName: `${patient.firstName} ${patient.lastName}`,
      paymentMethod: input.method,
      checkNumber: input.reference?.slice(0, 60) ?? null,
      totalCents: input.amountCents,
      unappliedCents: input.amountCents,
      note: `${RECEIPT_KINDS[input.kind] ?? "Payment"} at the front desk`,
    },
  });
  const receipt = await prisma.receipt.create({
    data: {
      practiceId: input.practiceId,
      patientId: patient.id,
      appointmentId: input.appointmentId ?? null,
      encounterId: input.encounterId ?? null,
      depositId: deposit.id,
      number: await nextReceiptNumber(input.practiceId),
      kind: input.kind,
      amountCents: input.amountCents,
      method: input.method,
      reference: input.reference ?? null,
      note: input.note ?? null,
      collectedById: input.userId,
    },
  });
  // Balance payments apply now; copays/prepayments wait as credit until the claim comes back.
  const applied = input.kind === "BALANCE" ? await applyPatientCredit(patient.id, input.userId) : 0;
  await logAudit(input.practiceId, input.userId, "COLLECT_PAYMENT", "Receipt", receipt.id, `${receipt.number} ${formatMoney(input.amountCents)} ${input.method}${applied ? ` · applied ${formatMoney(applied)}` : ""}`);
  return { receipt, applied };
}

export async function voidReceipt(receiptId: string, practiceId: string, userId: string, reason: string) {
  const r = await prisma.receipt.findFirstOrThrow({ where: { id: receiptId, practiceId } });
  if (r.voidedAt) throw new Error("This receipt is already void.");
  const dep = r.depositId ? await prisma.deposit.findUnique({ where: { id: r.depositId } }) : null;
  if (dep && dep.unappliedCents < dep.totalCents) throw new Error("Part of this payment was already applied to a claim — reverse it in billing instead.");
  await prisma.$transaction([
    prisma.receipt.update({ where: { id: r.id }, data: { voidedAt: new Date(), voidReason: reason.slice(0, 200) } }),
    ...(dep ? [prisma.deposit.update({ where: { id: dep.id }, data: { totalCents: 0, unappliedCents: 0, note: `${dep.note ?? ""} · VOIDED ${r.number}` } })] : []),
  ]);
  await logAudit(practiceId, userId, "VOID_RECEIPT", "Receipt", r.id, `${r.number}: ${reason}`);
}

export async function receiptPdf(receiptId: string, practiceId: string) {
  const r = await prisma.receipt.findFirstOrThrow({ where: { id: receiptId, practiceId }, include: { patient: true } });
  const by = r.collectedById ? await prisma.user.findUnique({ where: { id: r.collectedById } }) : null;
  const { totalCents } = await patientBalance(r.patientId);
  const { pdf, font, bold } = await newPdf(`Receipt ${r.number}`);
  const f = new Flow(pdf, font, bold);
  letterhead(f, await practiceLetterhead(practiceId));
  f.text(`RECEIPT ${r.number}${r.voidedAt ? " — VOID" : ""}`, { size: 14, bold: true });
  f.text(`${r.createdAt.toLocaleString("en-US")}`, { size: 10, color: MUTED });
  f.gap(10);
  f.text(`Received from: ${r.patient.firstName} ${r.patient.lastName} (MRN ${r.patient.mrn})`);
  f.text(`For: ${RECEIPT_KINDS[r.kind] ?? r.kind}`);
  f.text(`Amount: ${formatMoney(r.amountCents)}`, { size: 13, bold: true });
  f.text(`Paid by: ${PAY_METHODS[r.method] ?? r.method}${r.reference ? ` · ref ${r.reference}` : ""}`);
  if (r.note) f.text(`Note: ${r.note}`, { size: 10 });
  f.gap(8);
  f.text(`Remaining patient balance: ${formatMoney(totalCents)}`, { size: 10 });
  f.text("Copays and prepayments are applied to your account once your insurance processes the visit.", { size: 9, color: MUTED });
  f.gap(10);
  f.text(`Collected by ${by?.name ?? "front desk"}. Thank you!`, { size: 10 });
  return Buffer.from(await pdf.save());
}
