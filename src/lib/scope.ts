import "server-only";
import type { getCurrentUser } from "@/lib/auth";

type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

export const CREDENTIALING_ROLES = ["ADMIN", "CREDENTIALING"];

// Practices whose credentialing data this user may read and edit. A regular user is
// confined to the practice they signed into; a master login spans every practice
// where they hold a credentialing-capable role.
export function credentialingPracticeIds(user: CurrentUser) {
  if (!user.isMaster) return [user.practiceId];
  const ids = user.memberships.filter((m) => CREDENTIALING_ROLES.includes(m.role)).map((m) => m.practiceId);
  return ids.includes(user.practiceId) ? ids : [user.practiceId, ...ids];
}

export function credentialingPractices(user: CurrentUser) {
  const ids = new Set(credentialingPracticeIds(user));
  return user.memberships
    .filter((m) => ids.has(m.practiceId))
    .map((m) => m.practice)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Master users can narrow any view to a subset via ?practices=id1,id2; anyone else
// always gets their single practice, whatever the URL says.
export function selectedPracticeIds(user: CurrentUser, param: string | undefined) {
  const allowed = credentialingPracticeIds(user);
  if (!user.isMaster || !param) return allowed;
  const picked = param.split(",").filter((id) => allowed.includes(id));
  return picked.length > 0 ? picked : allowed;
}
