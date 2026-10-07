import "server-only";
import { prisma } from "@/lib/prisma";
import { CDS_STAGES } from "@/lib/visit-workflow";

// Separation of duties on a visit (Practice setup → Workflow rules → "No self-review"). Nobody reviews or codes
// a chart they documented, and nobody codes a chart they reviewed — whatever their role or permissions, an
// administrator included. Each check returns the reason the step is refused for this person, or null.

export type ReviewStep = "cds" | "coding";

// Who did what on the visit so far: the rendering provider and clinical staff documented it, as did anyone
// who sent it to CDS; anyone who moved it out of a CDS stage reviewed it.
async function hands(encounterId: string) {
  const e = await prisma.encounter.findUnique({
    where: { id: encounterId },
    select: { providerId: true, clinicalStaffId: true, practiceId: true, events: { select: { userId: true, fromStatus: true, toStatus: true } } },
  });
  if (!e) return null;
  const documented = new Set<string>([e.providerId, ...(e.clinicalStaffId ? [e.clinicalStaffId] : [])]);
  const reviewed = new Set<string>();
  for (const ev of e.events) {
    if (!ev.userId) continue;
    if (ev.toStatus === "READY_FOR_CDS") documented.add(ev.userId);
    if (ev.fromStatus && CDS_STAGES.includes(ev.fromStatus) && ["READY_FOR_CODING", "CDS_QUERY"].includes(ev.toStatus)) reviewed.add(ev.userId);
  }
  return { practiceId: e.practiceId, documented, reviewed };
}

export async function selfReviewBlock(encounterId: string, userId: string, step: ReviewStep): Promise<string | null> {
  const h = await hands(encounterId);
  if (!h) return null;
  const s = await prisma.practiceSettings.findUnique({ where: { practiceId: h.practiceId }, select: { separateDuties: true } });
  if (s && !s.separateDuties) return null;
  if (h.documented.has(userId)) {
    return step === "cds"
      ? "You documented this visit, so you can't be its CDS reviewer — another reviewer has to take it (no self-review rule)."
      : "You documented this visit, so you can't code it — the coding team has to take it (no self-review rule).";
  }
  if (step === "coding" && h.reviewed.has(userId)) {
    return "You reviewed this visit for CDS, so you can't also code it — another coder has to take it (no self-review rule).";
  }
  return null;
}
