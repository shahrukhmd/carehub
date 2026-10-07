"use server";

import { rolesFor } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { claimNumber } from "@/lib/claim-format";

// "Go to claim #": accepts the claim number shown on screens and PDFs (CLM-26ABC123), the clearinghouse claim ID,
// or the internal id.
export async function goToClaim(fd: FormData) {
  const user = await requireUser(rolesFor("billing.work"));
  const raw = String(fd.get("claim") ?? "").trim();
  const back = (message: string): never => redirect(`/billing/claims?error=${encodeURIComponent(message)}`);
  if (!raw) back("Enter a claim number.");

  const tail = raw.toUpperCase().replace(/^CLM-?/, "");
  const candidates = await prisma.claim.findMany({
    where: {
      practiceId: user.practiceId,
      OR: [{ id: raw }, { clearinghouseClaimId: raw }, { id: { endsWith: tail.slice(-6).toLowerCase() } }],
    },
    select: { id: true, createdAt: true, clearinghouseClaimId: true },
    take: 20,
  });
  const match = candidates.find((c) => c.id === raw || c.clearinghouseClaimId === raw || claimNumber(c) === `CLM-${tail}` || claimNumber(c) === raw.toUpperCase());
  if (!match) back(`No claim found for "${raw.slice(0, 40)}".`);
  redirect(`/billing/claims/${match!.id}`);
}
