import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { getCredentialingAlerts } from "@/lib/credentialing";
import { CREDENTIALING_ROLES, credentialingPracticeIds } from "@/lib/scope";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const alertCount = CREDENTIALING_ROLES.includes(user.role)
    ? (await getCredentialingAlerts(credentialingPracticeIds(user))).length
    : 0;
  return (
    <AppShell user={user} credentialingAlertCount={alertCount}>
      {children}
    </AppShell>
  );
}
