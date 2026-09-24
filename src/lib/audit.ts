import "server-only";
import { prisma } from "@/lib/prisma";

export async function logAudit(
  practiceId: string | null,
  userId: string | null,
  action: string,
  entityType: string,
  entityId?: string,
  detail?: string
) {
  await prisma.auditLog.create({
    data: { practiceId, userId, action, entityType, entityId, detail },
  });
}
