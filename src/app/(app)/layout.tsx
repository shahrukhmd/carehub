import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { getCredentialingAlerts } from "@/lib/credentialing";
import { CREDENTIALING_ROLES, credentialingPracticeIds } from "@/lib/scope";
import { prisma } from "@/lib/prisma";
import { isMessageLive } from "@/lib/system-messages";
import { teamHome, waitingPatientCount } from "@/lib/patient-thread";
import { documentAiLabel, documentAiProvider } from "@/lib/document-reader";
import { allowed } from "@/lib/permissions";
import { organizationHold } from "@/lib/organization";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const alertCount = allowed(user, CREDENTIALING_ROLES)
    ? (await getCredentialingAlerts(credentialingPracticeIds(user))).length
    : 0;
  const taskCount = await waitingPatientCount(user);
  // Icon-only menu unless the user expanded it (remembered in a cookie).
  const jar = await cookies();
  const navCollapsed = jar.get("ch_nav")?.value === "collapsed";
  const theme = jar.get("ch_theme")?.value === "dark" ? "dark" : "light";
  const settings = await prisma.practiceSettings.findUnique({ where: { practiceId: user.practiceId }, select: { documentAiEnabled: true } });
  const provider = settings?.documentAiEnabled ? documentAiProvider() : null;
  const messages = (await prisma.systemMessage.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: { createdAt: "desc" } }))
    .filter((m) => isMessageLive(m))
    .map((m) => ({ id: m.id, title: m.title, message: m.message, level: m.level, version: m.updatedAt.toISOString() }));
  const hold = await organizationHold(user.practiceId);
  if (hold) messages.unshift({ id: "org-hold", title: "Client account on hold", message: hold, level: "WARNING", version: "hold" });
  return (
    <AppShell user={user} credentialingAlertCount={alertCount} taskCount={taskCount} waitingHome={teamHome(user.role)} navCollapsed={navCollapsed} theme={theme} ai={provider ? documentAiLabel[provider] : null} systemMessages={messages}>
      {children}
    </AppShell>
  );
}
