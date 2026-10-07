"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { rolesFor } from "@/lib/permissions";
import { logClaimEvent, refreshVisitBillingStatus } from "@/lib/claims";
import { FOLLOWUP_ACTIONS, OPEN_FOLLOWUP_STATUSES, ensureFollowUp, resolveFollowUps } from "@/lib/followups";

const DAY = 86_400_000;
const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? "").trim().slice(0, max);

function back(to: string, msg: { ok?: string; error?: string }): never {
  const sep = to.includes("?") ? "&" : "?";
  redirect(`${to}${msg.error ? `${sep}error=${encodeURIComponent(msg.error)}` : msg.ok ? `${sep}ok=${encodeURIComponent(msg.ok)}` : ""}`);
}

async function ownFollowUp(practiceId: string, id: string) {
  const f = await prisma.claimFollowUp.findFirst({ where: { id, practiceId }, include: { claim: true } });
  if (!f) throw new Error("Follow-up not found");
  return f;
}

async function memberOrNull(practiceId: string, userId: string) {
  if (!userId) return null;
  const m = await prisma.membership.findFirst({ where: { userId, practiceId } });
  return m ? userId : null;
}

// Record what was done on an item: the action sets the next status and tickle date; the note goes on the claim log.
export async function workFollowUp(followUpId: string, fd: FormData) {
  const user = await requireUser(rolesFor("billing.work"));
  const f = await ownFollowUp(user.practiceId, followUpId);
  const to = `/billing/claims/${f.claimId}?view=payments#followup`;
  const action = str(fd, "action", 30);
  const def = FOLLOWUP_ACTIONS[action];
  if (!def) back(to, { error: "Pick what was done." });
  const note = str(fd, "note");
  const reference = str(fd, "reference", 80);
  const representative = str(fd, "representative", 80);
  if (!note && !reference) back(to, { error: "Add a note or the payer's reference number." });
  const tickleRaw = str(fd, "tickleAt", 10);
  const tickleAt = /^\d{4}-\d{2}-\d{2}$/.test(tickleRaw) ? new Date(`${tickleRaw}T09:00:00`) : new Date(Date.now() + def.tickleDays * DAY);
  const detail = [def.label, reference ? `ref ${reference}` : "", representative ? `spoke with ${representative}` : "", note].filter(Boolean).join(" · ");
  await prisma.claimFollowUp.update({
    where: { id: f.id },
    data: { status: def.status, tickleAt, tickles: { increment: 1 }, lastActionAt: new Date(), lastAction: action, note: detail.slice(0, 500), ownerId: f.ownerId ?? user.id },
  });
  if (action === "TO_PATIENT" && f.claim.balanceResponsibility !== "PATIENT") {
    await prisma.claim.update({ where: { id: f.claimId }, data: { balanceResponsibility: "PATIENT" } });
    await refreshVisitBillingStatus(f.claim.encounterId);
  }
  await logClaimEvent(f.claimId, user.id, "FOLLOWUP", { note: detail });
  await logAudit(user.practiceId, user.id, "WORK_FOLLOWUP", "Claim", f.claimId, detail.slice(0, 120));
  revalidatePath("/billing/followups");
  back(to, { ok: `Recorded: ${def.label}. Next check ${tickleAt.toISOString().slice(0, 10)}.` });
}

export async function assignFollowUp(followUpId: string, fd: FormData) {
  const user = await requireUser(rolesFor("billing.work"));
  const f = await ownFollowUp(user.practiceId, followUpId);
  const ownerId = await memberOrNull(user.practiceId, str(fd, "ownerId", 40));
  await prisma.claimFollowUp.update({ where: { id: f.id }, data: { ownerId } });
  await logClaimEvent(f.claimId, user.id, "FOLLOWUP", { note: ownerId ? "Follow-up assigned" : "Follow-up unassigned" });
  revalidatePath("/billing/followups");
  back(String(fd.get("back") ?? `/billing/claims/${f.claimId}?view=payments#followup`), { ok: "Owner updated." });
}

export async function resolveFollowUp(followUpId: string, fd: FormData) {
  const user = await requireUser(rolesFor("billing.work"));
  const f = await ownFollowUp(user.practiceId, followUpId);
  const to = `/billing/claims/${f.claimId}?view=payments#followup`;
  const reason = str(fd, "reason", 200);
  if (!reason) back(to, { error: "Say why the follow-up is resolved." });
  const writeOff = fd.get("writeOff") === "on";
  if (writeOff) {
    const balance = Math.max(0, f.claim.billedCents - f.claim.paidCents - f.claim.adjustedCents);
    if (balance > 0) {
      await prisma.claim.update({ where: { id: f.claimId }, data: { adjustedCents: f.claim.adjustedCents + balance, status: "WRITTEN_OFF", statusNote: `Written off from follow-up: ${reason}` } });
      await logClaimEvent(f.claimId, user.id, "ADJUSTMENT", { field: "status", oldValue: f.claim.status, newValue: "WRITTEN_OFF", note: `Follow-up write-off $${(balance / 100).toFixed(2)}: ${reason}` });
      await refreshVisitBillingStatus(f.claim.encounterId);
    }
  }
  await resolveFollowUps(f.claimId, writeOff ? "WRITTEN_OFF" : reason, user.id);
  await logAudit(user.practiceId, user.id, writeOff ? "WRITEOFF_FOLLOWUP" : "RESOLVE_FOLLOWUP", "Claim", f.claimId, reason);
  revalidatePath("/billing/followups");
  back(to, { ok: writeOff ? "Balance written off and follow-up closed." : "Follow-up resolved." });
}

// Worklist bulk actions: assign the ticked items, or open follow-ups for ticked claims that have none.
export async function bulkAssign(fd: FormData) {
  const user = await requireUser(rolesFor("billing.work"));
  const ids = fd.getAll("followUp").map(String);
  const ownerId = await memberOrNull(user.practiceId, str(fd, "ownerId", 40));
  if (ids.length === 0) back("/billing/followups", { error: "Tick the follow-ups to assign." });
  const r = await prisma.claimFollowUp.updateMany({ where: { id: { in: ids }, practiceId: user.practiceId, status: { in: OPEN_FOLLOWUP_STATUSES } }, data: { ownerId } });
  await logAudit(user.practiceId, user.id, "ASSIGN_FOLLOWUPS", "Claim", undefined, `${r.count} follow-ups ${ownerId ? "assigned" : "unassigned"}`);
  revalidatePath("/billing/followups");
  back("/billing/followups", { ok: `${r.count} follow-up${r.count === 1 ? "" : "s"} ${ownerId ? "assigned" : "put back in the pool"}.` });
}

export async function openFollowUps(fd: FormData) {
  const user = await requireUser(rolesFor("billing.work"));
  const ids = fd.getAll("claim").map(String);
  const ownerId = await memberOrNull(user.practiceId, str(fd, "ownerId", 40));
  if (ids.length === 0) back("/billing/followups?view=aging", { error: "Tick the claims to work." });
  let n = 0;
  for (const id of ids) {
    const claim = await prisma.claim.findFirst({ where: { id, practiceId: user.practiceId }, select: { id: true, status: true, balanceResponsibility: true } });
    if (!claim) continue;
    const trigger = claim.status === "DENIED" ? "DENIAL" : claim.status === "EDI_REJECTED" ? "REJECTION" : claim.balanceResponsibility === "PATIENT" ? "PATIENT_BALANCE" : "NO_RESPONSE";
    const f = await ensureFollowUp({ claimId: claim.id, trigger, note: "Opened from the aging worklist", userId: user.id, status: trigger === "PATIENT_BALANCE" ? "WAITING_PATIENT" : "OPEN" });
    if (ownerId) await prisma.claimFollowUp.update({ where: { id: f.id }, data: { ownerId } });
    n++;
  }
  await logAudit(user.practiceId, user.id, "OPEN_FOLLOWUPS", "Claim", undefined, `${n} follow-ups opened from aging`);
  revalidatePath("/billing/followups");
  back("/billing/followups", { ok: `${n} follow-up${n === 1 ? "" : "s"} opened${ownerId ? " and assigned" : ""}.` });
}

