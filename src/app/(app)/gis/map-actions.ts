"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { rolesFor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { atLeast, GRANTABLE_ROLES, isMapRole, MAP_ROLE_LABEL, mapRoleFor, newMaskId, type MapRole } from "@/lib/gis/maps";
import { FIELD_PROVIDER_WHERE } from "@/lib/gis/settings";
import { fail, guarded as run, str } from "@/lib/gis/guard";
import { notify } from "@/lib/gis/notify";

const mapUrl = (id: string, extra = "") => `/gis/maps/${id}${extra}`;

type Actor = { id: string; practiceId: string };

// The map, checked for this practice and the caller's role (at least `min`).
export async function ownMap(user: Actor, mapId: string, min: MapRole) {
  const map = await prisma.gisMap.findFirst({ where: { id: mapId, practiceId: user.practiceId, deletedAt: null }, include: { members: true, provider: true } });
  if (!map) fail("Map not found");
  const role = await mapRoleFor(user.id, map!.id);
  if (!atLeast(role, min)) fail(role ? `This needs the ${MAP_ROLE_LABEL[min]} role on the map; you are ${MAP_ROLE_LABEL[role]}` : "You are not a member of this map");
  return { map: map!, role: role! };
}

async function fieldProvider(practiceId: string, id: string) {
  const p = await prisma.renderingProvider.findFirst({ where: { id, practiceId, ...FIELD_PROVIDER_WHERE, gisActive: true, gisTitle: { not: null } } });
  if (!p) fail("Pick a field clinician (a directory provider with a GIS title)");
  return p!;
}

export async function createMap(fd: FormData) {
  return run("gis.edit", "/gis", async (user) => {
    const label = str(fd, "label").slice(0, 80);
    if (!label) fail("Name the map");
    const mapType = str(fd, "mapType") === "GENERAL" ? "GENERAL" : "PROVIDER";
    const providerId = mapType === "PROVIDER" ? str(fd, "providerId") : "";
    if (mapType === "PROVIDER") await fieldProvider(user.practiceId, providerId);
    const map = await prisma.gisMap.create({
      data: { practiceId: user.practiceId, label, mapType, providerId: providerId || null, maskId: await newMaskId(), ownerId: user.id, members: { create: { userId: user.id, role: "OWNER", addedById: user.id } } },
    });
    await logAudit(user.practiceId, user.id, "GIS_MAP_CREATE", "GisMap", map.id, `${label} · ${mapType}${providerId ? ` · provider ${providerId}` : ""}`);
    return mapUrl(map.id, `?ok=${encodeURIComponent(`Map "${label}" created`)}`);
  });
}

export async function updateMap(mapId: string, fd: FormData) {
  return run("gis.edit", mapUrl(mapId, "/settings"), async (user) => {
    const { map } = await ownMap(user, mapId, "ADMIN");
    const label = str(fd, "label").slice(0, 80) || map.label;
    const mapType = str(fd, "mapType") === "GENERAL" ? "GENERAL" : "PROVIDER";
    const providerId = mapType === "PROVIDER" ? str(fd, "providerId") : "";
    if (mapType === "PROVIDER") await fieldProvider(user.practiceId, providerId);
    await prisma.gisMap.update({ where: { id: map.id }, data: { label, mapType, providerId: providerId || null } });
    await logAudit(user.practiceId, user.id, "GIS_MAP_UPDATE", "GisMap", map.id, JSON.stringify({ before: { label: map.label, mapType: map.mapType, providerId: map.providerId }, after: { label, mapType, providerId: providerId || null } }));
    return "Map saved";
  });
}

export async function deleteMap(mapId: string) {
  return run("gis.edit", "/gis", async (user) => {
    const { map } = await ownMap(user, mapId, "OWNER");
    await prisma.gisMap.update({ where: { id: map.id }, data: { deletedAt: new Date() } });
    await logAudit(user.practiceId, user.id, "GIS_MAP_DELETE", "GisMap", map.id, map.label);
    return `Map "${map.label}" deleted`;
  });
}

// Share with a colleague of this practice as Admin, Editor or Viewer. Owner is not grantable.
export async function shareMap(mapId: string, fd: FormData) {
  return run("gis.edit", mapUrl(mapId, "/settings"), async (user) => {
    const { map } = await ownMap(user, mapId, "ADMIN");
    const userId = str(fd, "userId");
    const role = str(fd, "role");
    if (!isMapRole(role) || !(GRANTABLE_ROLES as readonly string[]).includes(role)) fail("Pick Admin, Editor or Viewer");
    const member = await prisma.membership.findFirst({ where: { userId, practiceId: user.practiceId, user: { active: true } }, include: { user: { select: { name: true } } } });
    if (!member) fail("Pick a colleague of this practice");
    if (map.members.some((m) => m.userId === userId)) fail(`${member.user.name} is already on this map`);
    await prisma.gisMapMember.create({ data: { mapId: map.id, userId, role, addedById: user.id } });
    await logAudit(user.practiceId, user.id, "GIS_MAP_SHARE", "GisMap", map.id, `${member.user.name} as ${role}`);
    await notify(user.practiceId, [userId], { title: "Map shared with you", message: `${user.name} shared the map "${map.label}" with you as ${MAP_ROLE_LABEL[role]}.`, href: mapUrl(map.id) });
    return `Shared with ${member.user.name} as ${MAP_ROLE_LABEL[role]}`;
  });
}

export async function setMemberRole(memberId: string, fd: FormData) {
  const member = await prisma.gisMapMember.findUnique({ where: { id: memberId } });
  return run("gis.edit", mapUrl(member?.mapId ?? "", "/settings"), async (user) => {
    if (!member) fail("Member not found");
    const { map } = await ownMap(user, member!.mapId, "ADMIN");
    const role = str(fd, "role");
    if (member!.role === "OWNER") fail("The owner's role can't change");
    if (!isMapRole(role) || !(GRANTABLE_ROLES as readonly string[]).includes(role)) fail("Pick Admin, Editor or Viewer");
    await prisma.gisMapMember.update({ where: { id: member!.id }, data: { role } });
    await logAudit(user.practiceId, user.id, "GIS_MAP_ROLE", "GisMap", map.id, `${member!.userId}: ${member!.role} -> ${role}`);
  });
}

// An admin removes a member, or a member leaves.
export async function removeMember(memberId: string) {
  const member = await prisma.gisMapMember.findUnique({ where: { id: memberId } });
  return run("gis.edit", mapUrl(member?.mapId ?? "", "/settings"), async (user) => {
    if (!member) fail("Member not found");
    if (member!.role === "OWNER") fail("The owner can't be removed; delete the map instead");
    const leaving = member!.userId === user.id;
    const { map } = await ownMap(user, member!.mapId, leaving ? "VIEWER" : "ADMIN");
    await prisma.gisMapMember.delete({ where: { id: member!.id } });
    await logAudit(user.practiceId, user.id, "GIS_MAP_UNSHARE", "GisMap", map.id, `${member!.userId}${leaving ? " (left)" : ""}`);
    return leaving ? `/gis?ok=${encodeURIComponent(`You left "${map.label}"`)}` : "Member removed";
  });
}

// Where the map was left: saved as the map is panned (Editors and above; Viewers never save). No redirect.
export async function saveMapCenter(mapId: string, fd: FormData) {
  const user = await requireUser(rolesFor("gis.view"));
  const lat = Number(str(fd, "lat"));
  const lng = Number(str(fd, "lng"));
  const zoom = Number(str(fd, "zoom"));
  if (![lat, lng, zoom].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
  const map = await prisma.gisMap.findFirst({ where: { id: mapId, practiceId: user.practiceId, deletedAt: null }, select: { id: true } });
  if (!map || !atLeast(await mapRoleFor(user.id, mapId), "EDITOR")) return;
  await prisma.gisMap.update({ where: { id: mapId }, data: { centerLat: lat, centerLng: lng, zoom } });
}
