import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { collectionsExport } from "@/lib/statements";

// The agency placement file: every account currently referred, one CSV row each.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  if (!can(user, "billing.work")) return new Response("Forbidden", { status: 403 });
  const csv = await collectionsExport(user.practiceId);
  await logAudit(user.practiceId, user.id, "EXPORT_COLLECTIONS", "CollectionsCase", undefined, `${csv.split("\r\n").length - 1} accounts`);
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="collections-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
  });
}
