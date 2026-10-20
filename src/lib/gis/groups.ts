import "server-only";
import { prisma } from "@/lib/prisma";
import { atLeast, isMapRole, type MapRole } from "@/lib/gis/maps";

// Groups: reusable patient or clinician lists shared by role (same OWNER / ADMIN / EDITOR / VIEWER ladder as maps).

export const GROUP_ICONS = [
  ["HEART", "♥", "Heart"],
  ["STETHOSCOPE", "⚕", "Stethoscope"],
  ["CALENDAR", "▦", "Calendar"],
  ["ACTIVITY", "⚡", "Activity"],
  ["USERS", "👥", "Users"],
  ["TRENDING", "↗", "Trending"],
  ["MEDICATION", "💊", "Medication"],
  ["LOCATION", "⌖", "Location"],
] as const;
export const groupIcon = (key: string) => GROUP_ICONS.find(([k]) => k === key)?.[1] ?? "👥";
export const GROUP_SORTS = [
  ["name", "Name"],
  ["mrn", "MRN"],
  ["dob", "Date of birth"],
  ["status", "Status"],
  ["zip", "ZIP"],
] as const;

export async function groupRoleFor(userId: string, groupId: string): Promise<MapRole | null> {
  const m = await prisma.gisGroupMember.findUnique({ where: { groupId_userId: { groupId, userId } }, select: { role: true } });
  return m && isMapRole(m.role) ? m.role : null;
}

// Groups this user belongs to, with role and counts.
export async function myGroups(userId: string, practiceId: string) {
  const groups = await prisma.gisGroup.findMany({
    where: { practiceId, members: { some: { userId } } },
    include: { members: { select: { userId: true, role: true, visibleOnMap: true, user: { select: { name: true } } } }, _count: { select: { patients: true, providers: true } } },
    orderBy: { name: "asc" },
  });
  return groups.map((g) => {
    const me = g.members.find((m) => m.userId === userId);
    return { ...g, myRole: (me && isMapRole(me.role) ? me.role : "VIEWER") as MapRole, visibleOnMap: me?.visibleOnMap ?? true, ownerName: g.members.find((m) => m.role === "OWNER")?.user.name ?? "" };
  });
}

export async function openGroup(userId: string, practiceId: string, groupId: string) {
  const group = await prisma.gisGroup.findFirst({
    where: { id: groupId, practiceId, members: { some: { userId } } },
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "asc" } },
      patients: { include: { patient: { include: { npProvider: { select: { name: true } }, lpnProvider: { select: { name: true } }, maProvider: { select: { name: true } }, intakeCases: { orderBy: { createdAt: "desc" }, take: 1, select: { stage: true, careStatus: true } } } } } },
      providers: { include: { provider: { select: { id: true, name: true, gisTitle: true, latitude: true, longitude: true } } } },
    },
  });
  if (!group) return null;
  const mine = group.members.find((m) => m.userId === userId);
  return { group, role: (mine && isMapRole(mine.role) ? mine.role : "VIEWER") as MapRole, canEditGroup: atLeast(mine && isMapRole(mine.role) ? mine.role : null, "EDITOR") };
}

// The patient ids a group resolves to: its own list, or, for a PROVIDER group, every patient assigned to one of
// its clinicians in any field role.
export async function groupPatientIds(groupId: string) {
  const g = await prisma.gisGroup.findUnique({ where: { id: groupId }, include: { patients: { select: { patientId: true } }, providers: { select: { renderingProviderId: true } } } });
  if (!g) return [];
  if (g.groupType === "PATIENT") return g.patients.map((p) => p.patientId);
  const ids = g.providers.map((p) => p.renderingProviderId);
  if (!ids.length) return [];
  const rows = await prisma.patient.findMany({ where: { practiceId: g.practiceId, status: "ACTIVE", OR: [{ npProviderId: { in: ids } }, { lpnProviderId: { in: ids } }, { maProviderId: { in: ids } }] }, select: { id: true } });
  return rows.map((r) => r.id);
}
