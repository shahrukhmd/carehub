import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { scheduleCsv } from "@/lib/charge-schedules";

const BOM = String.fromCharCode(0xfeff);

// The schedule's fees as a spreadsheet, in the layout Import reads back.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["ADMIN", "BILLER"]);
  const { id } = await params;
  const schedule = await prisma.chargeSchedule.findFirst({ where: { id, practiceId: user.practiceId }, include: { items: { orderBy: { code: "asc" } } } });
  if (!schedule) return new NextResponse("Not found", { status: 404 });
  await logAudit(user.practiceId, user.id, "EXPORT_CHARGE_SCHEDULE", "ChargeSchedule", schedule.id, `${schedule.items.length} codes`);
  const file = schedule.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "charge-schedule";
  return new NextResponse(BOM + scheduleCsv(schedule.items), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file}.csv"`, "Cache-Control": "no-store" },
  });
}
