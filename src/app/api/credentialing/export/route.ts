import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { enrollmentStatusLabel, planSegmentLabel } from "@/lib/format";
import { CREDENTIALING_ROLES, selectedPracticeIds } from "@/lib/scope";

function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  // Leading =,+,-,@ would be executed as formulas when opened in Excel.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  if (!CREDENTIALING_ROLES.includes(user.role)) return new Response("Forbidden", { status: 403 });
  const params = new URL(request.url).searchParams;
  const practiceIds = selectedPracticeIds(user, params.getAll("p").join(",") || undefined);

  const rows = await prisma.providerEnrollment.findMany({
    where: { renderingProvider: { practiceId: { in: practiceIds } } },
    include: {
      renderingProvider: { include: { practice: true } },
      assignedTo: true,
      groupPayerEnrollment: { include: { payer: true, billingProvider: true } },
    },
    orderBy: [{ renderingProvider: { practice: { name: "asc" } } }, { renderingProvider: { name: "asc" } }],
  });

  const header = [
    "Practice", "Provider", "Credential", "NPI", "Group", "State", "Payer", "Plan segment", "Payer ID", "Plans included", "Status",
    "Payer provider #", "Submitted", "Effective", "Term", "Revalidation due", "Follow-up", "Blocking reason",
    "Next action", "Owner",
  ];
  const lines = rows.map((r) =>
    [
      r.renderingProvider.practice.name,
      r.renderingProvider.name,
      r.renderingProvider.credential,
      r.renderingProvider.npi,
      r.groupPayerEnrollment.billingProvider.name,
      r.state,
      r.groupPayerEnrollment.payer.name,
      planSegmentLabel[r.groupPayerEnrollment.planSegment] ?? r.groupPayerEnrollment.planSegment,
      r.groupPayerEnrollment.payer.payerCode,
      r.planTypes,
      enrollmentStatusLabel[r.status] ?? r.status,
      r.payerProviderId,
      r.submittedDate,
      r.effectiveDate,
      r.termDate,
      r.revalidationDate,
      r.followUpDate,
      r.blockingReason,
      r.nextAction,
      r.assignedTo?.name,
    ]
      .map(csvCell)
      .join(",")
  );

  await logAudit(user.practiceId, user.id, "EXPORT_CREDENTIALING", "ProviderEnrollment", undefined, `${rows.length} row(s) across ${practiceIds.length} practice(s)`);

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(`﻿${[header.join(","), ...lines].join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="credentialing-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
