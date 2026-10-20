import "server-only";
import { prisma } from "@/lib/prisma";

// In-app GIS notifications: one row per recipient. Read from the GIS Notifications tab; the unread count shows on
// the GIS home.

export async function notify(practiceId: string, userIds: string[], n: { kind?: "INFO" | "SUCCESS" | "WARNING"; title: string; message: string; href?: string }) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return 0;
  const r = await prisma.gisNotification.createMany({ data: ids.map((userId) => ({ practiceId, userId, kind: n.kind ?? "INFO", title: n.title.slice(0, 120), message: n.message.slice(0, 500), href: n.href ?? null })) });
  return r.count;
}

export const unreadCount = (userId: string) => prisma.gisNotification.count({ where: { userId, readAt: null } });
