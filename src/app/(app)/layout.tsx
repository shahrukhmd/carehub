import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { getCredentialingAlerts } from "@/lib/credentialing";
import { CREDENTIALING_ROLES, credentialingPracticeIds } from "@/lib/scope";
import { prisma } from "@/lib/prisma";
import { isMessageLive } from "@/lib/system-messages";
import { openTaskCount } from "@/lib/tasks";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const alertCount = CREDENTIALING_ROLES.includes(user.role)
    ? (await getCredentialingAlerts(credentialingPracticeIds(user))).length
    : 0;
  const taskCount = await openTaskCount(user);
  // Icon-only menu unless the user expanded it (remembered in a cookie).
  const navCollapsed = (await cookies()).get("ch_nav")?.value !== "expanded";
  const messages = (await prisma.systemMessage.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: { createdAt: "desc" } }))
    .filter((m) => isMessageLive(m))
    .map((m) => ({ id: m.id, title: m.title, message: m.message, level: m.level, version: m.updatedAt.toISOString() }));
  return (
    <AppShell user={user} credentialingAlertCount={alertCount} taskCount={taskCount} navCollapsed={navCollapsed} systemMessages={messages}>
      {children}
    </AppShell>
  );
}
