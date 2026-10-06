import { getCurrentUser } from "@/lib/auth";
import { chartAccess } from "@/lib/privacy";
import { logAudit } from "@/lib/audit";
import { renderCms1500 } from "@/lib/cms1500-pdf";
import { cms1500ForClaims } from "@/lib/cms1500-data";
import { claimNumber } from "@/lib/claim-format";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  if (!["ADMIN", "BILLER"].includes(user.role)) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  const formImage = new URL(request.url).searchParams.get("form") !== "0";

  const [form] = await cms1500ForClaims(user.practiceId, [id]);
  if (!form) return new Response("Not found", { status: 404 });
  const { claim, data } = form;
  if ((await chartAccess(user, claim.patientId)) === "BLOCKED") return new Response("This chart is restricted", { status: 403 });

  const bytes = await renderCms1500(data, formImage);
  await logAudit(user.practiceId, user.id, "PRINT_CMS1500", "Claim", claim.id, formImage ? "form image" : "data only");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${claimNumber(claim)}-CMS1500.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
