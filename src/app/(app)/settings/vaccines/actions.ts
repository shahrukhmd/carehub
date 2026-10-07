"use server";

import { rolesFor } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { MANUFACTURERS, VACCINES } from "@/lib/immunizations";

const STOCK_ROLES = rolesFor("immunizations.stock");
const FUNDING = ["PRIVATE", "VFC", "STATE"];
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function back(msg: { error?: string; ok?: string }): never {
  revalidatePath("/settings/vaccines");
  redirect(`/settings/vaccines?${msg.error ? `error=${encodeURIComponent(msg.error)}` : `ok=${encodeURIComponent(msg.ok ?? "Saved.")}`}`);
}

export async function addVaccineLot(fd: FormData) {
  const user = await requireUser(STOCK_ROLES);
  const known = VACCINES.find((v) => v.cvx === str(fd, "cvx"));
  if (!known) back({ error: "Choose the vaccine." });
  const lotNumber = str(fd, "lotNumber").toUpperCase().slice(0, 40);
  if (!lotNumber) back({ error: "Enter the lot number from the box." });
  const doses = Number(str(fd, "doses"));
  if (!Number.isInteger(doses) || doses <= 0 || doses > 10_000) back({ error: "Enter how many doses were received." });
  const expText = str(fd, "expirationDate");
  const exp = /^\d{4}-\d{2}-\d{2}$/.test(expText) ? new Date(`${expText}T12:00:00`) : null;
  if (!exp || Number.isNaN(exp.getTime())) back({ error: "Enter the expiration date." });
  if (await prisma.vaccineLot.findFirst({ where: { practiceId: user.practiceId, lotNumber, cvxCode: known!.cvx, active: true } })) {
    back({ error: `Lot ${lotNumber} of this vaccine is already in stock — adjust its count instead.` });
  }
  const mfr = str(fd, "manufacturer");
  const row = await prisma.vaccineLot.create({
    data: {
      practiceId: user.practiceId,
      vaccine: known!.name,
      cvxCode: known!.cvx,
      manufacturer: mfr in MANUFACTURERS ? mfr : (known!.mfr ?? null),
      lotNumber,
      expirationDate: exp,
      dosesReceived: doses,
      dosesOnHand: doses,
      funding: FUNDING.includes(str(fd, "funding")) ? str(fd, "funding") : "PRIVATE",
      notes: str(fd, "notes").slice(0, 300) || null,
    },
  });
  await logAudit(user.practiceId, user.id, "ADD_VACCINE_LOT", "VaccineLot", row.id, `${known!.name} lot ${lotNumber} · ${doses} doses`);
  back({ ok: `${doses} doses of ${known!.name} (lot ${lotNumber}) added to stock.` });
}

// A count correction (wasted, expired, spoiled, miscount). The reason goes to the audit log.
export async function adjustVaccineLot(lotId: string, fd: FormData) {
  const user = await requireUser(STOCK_ROLES);
  const lot = await prisma.vaccineLot.findFirst({ where: { id: lotId, practiceId: user.practiceId } });
  if (!lot) back({ error: "Lot not found." });
  const onHand = Number(str(fd, "dosesOnHand"));
  if (!Number.isInteger(onHand) || onHand < 0 || onHand > 10_000) back({ error: "Enter the number of doses on hand." });
  const reason = str(fd, "reason").slice(0, 200);
  if (onHand !== lot!.dosesOnHand && !reason) back({ error: "Say why the count changed (wasted, expired, miscount…)." });
  await prisma.vaccineLot.update({ where: { id: lot!.id }, data: { dosesOnHand: onHand } });
  await logAudit(user.practiceId, user.id, "ADJUST_VACCINE_LOT", "VaccineLot", lot!.id, `${lot!.vaccine} lot ${lot!.lotNumber}: ${lot!.dosesOnHand} → ${onHand}${reason ? ` · ${reason}` : ""}`);
  back({ ok: `Lot ${lot!.lotNumber} now shows ${onHand} doses.` });
}

export async function retireVaccineLot(lotId: string) {
  const user = await requireUser(STOCK_ROLES);
  const lot = await prisma.vaccineLot.findFirst({ where: { id: lotId, practiceId: user.practiceId } });
  if (!lot) back({ error: "Lot not found." });
  await prisma.vaccineLot.update({ where: { id: lot!.id }, data: { active: !lot!.active } });
  await logAudit(user.practiceId, user.id, lot!.active ? "RETIRE_VACCINE_LOT" : "RESTORE_VACCINE_LOT", "VaccineLot", lot!.id, `${lot!.vaccine} lot ${lot!.lotNumber} · ${lot!.dosesOnHand} doses on hand`);
  back({ ok: lot!.active ? `Lot ${lot!.lotNumber} removed from stock.` : `Lot ${lot!.lotNumber} is back in stock.` });
}
