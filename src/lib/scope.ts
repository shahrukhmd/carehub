import "server-only";
import type { getCurrentUser } from "@/lib/auth";
import { rolesFor } from "@/lib/permissions";

type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

export const CREDENTIALING_ROLES = rolesFor("credentialing.work");

// Practices whose credentialing data this user may read and edit: always and only the practice they are
// working in. A master login switches practices from the top bar; it never sees several at once.
export function credentialingPracticeIds(user: CurrentUser) {
  return [user.practiceId];
}

export function credentialingPractices(user: CurrentUser) {
  const ids = new Set(credentialingPracticeIds(user));
  return user.memberships
    .filter((m) => ids.has(m.practiceId))
    .map((m) => m.practice)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The URL may still carry an old ?p= practice selection; it is ignored — the view is the working practice.
export function selectedPracticeIds(user: CurrentUser, _param: string | undefined) {
  void _param;
  return credentialingPracticeIds(user);
}
