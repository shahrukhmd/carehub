import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

// Map boards: who may open a map and what they may do on it. The practice-wide permission keys gate the pages;
// a map's member role gates that map. Viewers see everything and every write is refused.

export const MAP_ROLES = ["OWNER", "ADMIN", "EDITOR", "VIEWER"] as const;
export type MapRole = (typeof MAP_ROLES)[number];
const RANK: Record<MapRole, number> = { OWNER: 4, ADMIN: 3, EDITOR: 2, VIEWER: 1 };
export const MAP_ROLE_LABEL: Record<MapRole, string> = { OWNER: "Owner", ADMIN: "Admin", EDITOR: "Editor", VIEWER: "Viewer" };
export const MAP_ROLE_ABOUT: Record<MapRole, string> = { OWNER: "Everything, including delete", ADMIN: "Share, edit the map and its routes", EDITOR: "Routes and stops", VIEWER: "Read only" };
export const GRANTABLE_ROLES = ["ADMIN", "EDITOR", "VIEWER"] as const;

export const atLeast = (role: MapRole | null, min: MapRole) => Boolean(role && RANK[role] >= RANK[min]);
export const isMapRole = (v: string): v is MapRole => (MAP_ROLES as readonly string[]).includes(v);

export async function mapRoleFor(userId: string, mapId: string): Promise<MapRole | null> {
  const m = await prisma.gisMapMember.findUnique({ where: { mapId_userId: { mapId, userId } }, select: { role: true } });
  return m && isMapRole(m.role) ? m.role : null;
}

// Short public id in the map URL, like PersonicGIS's MAP-FFA43903.
export async function newMaskId() {
  for (let i = 0; i < 5; i++) {
    const id = `MAP-${randomBytes(4).toString("hex").toUpperCase()}`;
    if (!(await prisma.gisMap.findUnique({ where: { maskId: id }, select: { id: true } }))) return id;
  }
  throw new Error("Could not allocate a map id");
}

// The maps this user belongs to in the practice, with their role and counts.
export async function myMaps(userId: string, practiceId: string) {
  const maps = await prisma.gisMap.findMany({
    where: { practiceId, deletedAt: null, members: { some: { userId } } },
    include: {
      members: { select: { userId: true, role: true, user: { select: { name: true } } } },
      provider: { select: { id: true, name: true, gisTitle: true, latitude: true, longitude: true } },
      _count: { select: { routes: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  return maps.map((m) => {
    const mine = m.members.find((x) => x.userId === userId)?.role;
    const owner = m.members.find((x) => x.role === "OWNER")?.user.name ?? "";
    return { ...m, myRole: (mine && isMapRole(mine) ? mine : "VIEWER") as MapRole, ownerName: owner, memberCount: m.members.length };
  });
}

// A map the user may open (member of it), with everything the map page needs.
export async function openMap(userId: string, practiceId: string, mapId: string) {
  const map = await prisma.gisMap.findFirst({
    where: { id: mapId, practiceId, deletedAt: null, members: { some: { userId } } },
    include: {
      provider: true,
      members: { include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "asc" } },
      pinStyles: { select: { patientId: true, color: true } },
      routes: { include: { stops: { orderBy: { index: "asc" }, include: { patient: true } } }, orderBy: [{ visitDate: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!map) return null;
  const mine = map.members.find((m) => m.userId === userId)?.role ?? "VIEWER";
  return { map, role: (isMapRole(mine) ? mine : "VIEWER") as MapRole };
}
