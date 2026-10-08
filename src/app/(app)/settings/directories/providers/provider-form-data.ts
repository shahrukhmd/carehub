import "server-only";
import { prisma } from "@/lib/prisma";

// The BD owners a referring physician / source can be given: active users with the business development role in
// this practice (plus the current owner, so an edit keeps showing them if they have since changed role).
export async function bdOwnerOptions(practiceId: string, currentOwnerId?: string | null) {
  const users = await prisma.user.findMany({
    where: {
      OR: [{ active: true, memberships: { some: { practiceId, role: "BD" } } }, ...(currentOwnerId ? [{ id: currentOwnerId }] : [])],
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return users;
}

// Choices the provider form needs: logins that can still be linked, supervising
// physicians, group names to suggest, and BD owners for referring providers.
export async function providerFormOptions(practiceId: string, providerId?: string, linkedUserId?: string | null, bdOwnerId?: string | null) {
  const [users, supervisors, groups, bdOwners] = await Promise.all([
    prisma.user.findMany({
      where: {
        practiceId,
        active: true,
        OR: [{ renderingProvider: { is: null } }, ...(linkedUserId ? [{ id: linkedUserId }] : [])],
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.renderingProvider.findMany({
      where: { practiceId, isSupervising: true, status: "ACTIVE", ...(providerId ? { id: { not: providerId } } : {}) },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.billingProvider.findMany({ where: { practiceId }, orderBy: { name: "asc" }, select: { name: true } }),
    bdOwnerOptions(practiceId, bdOwnerId),
  ]);
  return { users, supervisors, groupNames: groups.map((g) => g.name), bdOwners };
}

// Records created before the unified form only have a display name ("Last, First Middle").
export function splitDisplayName(name: string) {
  const [last, rest = ""] = name.split(",").map((s) => s.trim());
  const parts = rest.split(/\s+/).filter(Boolean);
  if (!rest) {
    const words = name.trim().split(/\s+/);
    return { firstName: words[0] ?? "", middleName: "", lastName: words.slice(1).join(" ") };
  }
  return { firstName: parts[0] ?? "", middleName: parts.slice(1).join(" "), lastName: last };
}
