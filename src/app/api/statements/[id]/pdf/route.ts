import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { statementPdf } from "@/lib/statements";

// The printable statement (paper delivery).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  if (!can(user, "billing.work") && !can(user, "payments.take")) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  let bytes: Buffer;
  try {
    bytes = await statementPdf(id, user.practiceId);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  await logAudit(user.practiceId, user.id, "PRINT_STATEMENT", "Statement", id);
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="statement-${id}.pdf"`, "Cache-Control": "no-store" },
  });
}
