"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { claimNumber } from "@/lib/claim-format";
import { buildTest835, importEra, matchEraClaim, postEra, skipEraClaim } from "@/lib/era";

const BILLING_ROLES = ["ADMIN", "BILLER"];

async function run(back: string, work: (user: Awaited<ReturnType<typeof requireUser>>) => Promise<string | void>) {
  const user = await requireUser(BILLING_ROLES);
  let target = back;
  try {
    target = (await work(user)) ?? back;
  } catch (err) {
    if (!(err instanceof Error) || (err as { digest?: string }).digest?.startsWith("NEXT_")) throw err;
    target = `${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(err.message.slice(0, 300))}`;
  }
  revalidatePath("/billing", "layout");
  redirect(target);
}

export async function uploadEra(fd: FormData) {
  return run("/billing?tab=era", async (user) => {
    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw new Error("Choose an 835 file to upload.");
    let last = "";
    for (const f of files) {
      if (f.size > 5_000_000) throw new Error(`${f.name} is larger than 5 MB.`);
      const era = await importEra(user.practiceId, f.name, await f.text(), user.id);
      last = era.id;
    }
    return files.length === 1 ? `/billing/era/${last}` : "/billing?tab=era&imported=" + files.length;
  });
}

export async function createTestEra(fd: FormData) {
  return run("/billing?tab=era", async (user) => {
    const payerId = String(fd.get("payerId") ?? "");
    const claims = await prisma.claim.findMany({
      where: { practiceId: user.practiceId, payerId, status: { in: ["SUBMITTED", "ACCEPTED"] } },
      include: { lines: true, patient: true, insurance: true, payer: true },
      take: 10,
      orderBy: { submittedAt: "asc" },
    });
    if (claims.length === 0) throw new Error("No submitted claims waiting on that payer.");
    const text = buildTest835(
      { name: claims[0].payer?.name ?? claims[0].payerName, code: claims[0].payer?.payerCode ?? null },
      claims.map((c) => ({
        number: claimNumber(c),
        billedCents: c.billedCents,
        patient: c.patient,
        memberId: c.insurance?.memberId ?? null,
        lines: c.lines.map((l) => ({ cptCode: l.cptCode, chargeCents: l.chargeCents, units: l.units })),
      })),
      { denyFirst: fd.get("deny") === "on" && claims.length > 1 }
    );
    const era = await importEra(user.practiceId, `TEST-835-${new Date().toISOString().slice(0, 10)}.835`, text, user.id);
    return `/billing/era/${era.id}`;
  });
}

export async function postEraFile(id: string) {
  return run(`/billing/era/${id}`, async (user) => {
    const r = await postEra(id, user.practiceId, user.id);
    return `/billing/era/${id}?posted=${r.posted}&skipped=${r.skipped}`;
  });
}

export async function setEraMatch(eraClaimId: string, eraFileId: string, fd: FormData) {
  return run(`/billing/era/${eraFileId}`, async (user) => {
    await matchEraClaim(eraClaimId, String(fd.get("claimId") ?? "") || null, user.practiceId);
  });
}

export async function skipEraLine(eraClaimId: string, eraFileId: string, fd: FormData) {
  return run(`/billing/era/${eraFileId}`, async (user) => {
    await skipEraClaim(eraClaimId, user.practiceId, String(fd.get("note") ?? "").slice(0, 200));
  });
}
