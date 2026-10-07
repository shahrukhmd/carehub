import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { cms1500ForClaims, renderCms1500Batch } from "@/lib/cms1500-data";
import { PAPER_CLAIM_EVENT } from "@/lib/claim-submit";
import { can } from "@/lib/permissions";

const MAX_PAPER_CLAIMS = 75;

// One PDF with a CMS-1500 for each claim: ?claim=<id>&claim=<id> (preview of ticked claims) or ?batch=PB-… (the
// claims printed in a paper batch). omitPayments=on leaves box 29 empty; dataOnly=on prints on pre-printed forms.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  if (!can(user, "billing.work")) return new Response("Forbidden", { status: 403 });
  const q = new URL(request.url).searchParams;
  const batch = q.get("batch");

  let ids = [...new Set(q.getAll("claim").filter((id) => /^[a-z0-9]{10,40}$/.test(id)))];
  if (batch) {
    if (!/^PB-\d{6}-[0-9A-F]{4}$/.test(batch)) return new Response("Unknown batch", { status: 404 });
    const events = await prisma.claimEvent.findMany({
      where: { action: PAPER_CLAIM_EVENT, field: batch, newValue: "RELEASED", claim: { practiceId: user.practiceId } },
      orderBy: { createdAt: "asc" },
      select: { claimId: true },
    });
    ids = events.map((e) => e.claimId);
  }
  if (ids.length === 0) return new Response("Tick at least one claim, then choose Preview.", { status: 400 });
  if (ids.length > MAX_PAPER_CLAIMS) return new Response(`The maximum number of paper claims is ${MAX_PAPER_CLAIMS} at a time.`, { status: 400 });

  const forms = (await cms1500ForClaims(user.practiceId, ids, { omitPayments: q.get("omitPayments") === "on" })).filter((f) => f.claim.formType === "CMS1500");
  if (forms.length === 0) return new Response("Not found", { status: 404 });
  const bytes = await renderCms1500Batch(
    forms.map((f) => f.data),
    q.get("dataOnly") !== "on"
  );
  await logAudit(user.practiceId, user.id, "PRINT_CMS1500", "Claim", undefined, `${batch ?? "preview"} · ${forms.length} claim(s)`);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${batch ?? "paper-claims-preview"}-CMS1500.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
