"use server";

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { atLeast, GRANTABLE_ROLES, isMapRole, MAP_ROLE_LABEL, type MapRole } from "@/lib/gis/maps";
import { groupRoleFor, GROUP_ICONS, GROUP_SORTS } from "@/lib/gis/groups";
import { FIELD_PROVIDER_WHERE } from "@/lib/gis/settings";
import { fail, guarded, str, type Actor } from "@/lib/gis/guard";
import { notify } from "@/lib/gis/notify";

const BASE = "/gis/groups";
const back = (groupId?: string | null, extra = "") => `${BASE}${groupId ? `?groupId=${groupId}${extra}` : ""}`;
const color = (v: string, fallback: string) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback);

async function ownGroup(user: Actor, groupId: string, min: MapRole) {
  const g = await prisma.gisGroup.findFirst({ where: { id: groupId, practiceId: user.practiceId }, include: { members: true } });
  if (!g) fail("Group not found");
  const role = await groupRoleFor(user.id, g!.id);
  if (!atLeast(role, min)) fail(role ? `This needs the ${MAP_ROLE_LABEL[min]} role on the group; you are ${MAP_ROLE_LABEL[role]}` : "You are not a member of this group");
  return { group: g!, role: role! };
}

function readGroup(fd: FormData, prev?: { color: string; icon: string; sortBy: string }) {
  const name = str(fd, "name").slice(0, 80);
  if (!name) fail("Name the group");
  const icon = str(fd, "icon");
  const sortBy = str(fd, "sortBy");
  return {
    name,
    description: str(fd, "description").slice(0, 300) || null,
    color: color(str(fd, "color"), prev?.color ?? "#2563eb"),
    icon: GROUP_ICONS.some(([k]) => k === icon) ? icon : (prev?.icon ?? "USERS"),
    visibility: str(fd, "visibility") === "SHARED" ? "SHARED" : "PRIVATE",
    sortBy: GROUP_SORTS.some(([k]) => k === sortBy) ? sortBy : (prev?.sortBy ?? "name"),
    showAge: fd.get("showAge") === "on",
  };
}

export async function createGroup(fd: FormData) {
  return guarded("gis.edit", BASE, async (user) => {
    const data = readGroup(fd);
    const groupType = str(fd, "groupType") === "PROVIDER" ? "PROVIDER" : "PATIENT";
    const g = await prisma.gisGroup.create({ data: { ...data, groupType, practiceId: user.practiceId, ownerId: user.id, members: { create: { userId: user.id, role: "OWNER", addedById: user.id } } } });
    await logAudit(user.practiceId, user.id, "GIS_GROUP_CREATE", "GisGroup", g.id, `${data.name} · ${groupType} · ${data.visibility}`);
    return `${back(g.id)}&ok=${encodeURIComponent(`Group "${data.name}" created`)}`;
  });
}

export async function updateGroup(groupId: string, fd: FormData) {
  return guarded("gis.edit", back(groupId, "&tab=settings"), async (user) => {
    const { group } = await ownGroup(user, groupId, "ADMIN");
    const data = readGroup(fd, group);
    await prisma.gisGroup.update({ where: { id: group.id }, data });
    await logAudit(user.practiceId, user.id, "GIS_GROUP_UPDATE", "GisGroup", group.id, JSON.stringify({ before: { name: group.name, visibility: group.visibility, color: group.color }, after: data }).slice(0, 1000));
    return "Group saved";
  });
}

export async function setGroupActive(groupId: string, fd: FormData) {
  return guarded("gis.edit", back(groupId, "&tab=settings"), async (user) => {
    const { group } = await ownGroup(user, groupId, "ADMIN");
    const active = fd.get("active") === "on";
    await prisma.gisGroup.update({ where: { id: group.id }, data: { active } });
    await logAudit(user.practiceId, user.id, "GIS_GROUP_UPDATE", "GisGroup", group.id, `active: ${active}`);
    return active ? "Group activated" : "Group deactivated";
  });
}

export async function deleteGroup(groupId: string) {
  return guarded("gis.edit", BASE, async (user) => {
    const { group } = await ownGroup(user, groupId, "OWNER");
    await prisma.gisGroup.delete({ where: { id: group.id } });
    await logAudit(user.practiceId, user.id, "GIS_GROUP_DELETE", "GisGroup", group.id, group.name);
    return `Group "${group.name}" deleted`;
  });
}

export async function shareGroup(groupId: string, fd: FormData) {
  return guarded("gis.edit", back(groupId, "&tab=members"), async (user) => {
    const { group } = await ownGroup(user, groupId, "ADMIN");
    const userId = str(fd, "userId");
    const role = str(fd, "role");
    if (!isMapRole(role) || !(GRANTABLE_ROLES as readonly string[]).includes(role)) fail("Pick Admin, Editor or Viewer");
    const member = await prisma.membership.findFirst({ where: { userId, practiceId: user.practiceId, user: { active: true } }, include: { user: { select: { name: true } } } });
    if (!member) fail("Pick a colleague of this practice");
    if (group.members.some((m) => m.userId === userId)) fail(`${member.user.name} is already on this group`);
    await prisma.gisGroupMember.create({ data: { groupId: group.id, userId, role, addedById: user.id } });
    if (group.visibility !== "SHARED") await prisma.gisGroup.update({ where: { id: group.id }, data: { visibility: "SHARED" } });
    await logAudit(user.practiceId, user.id, "GIS_GROUP_SHARE", "GisGroup", group.id, `${member.user.name} as ${role}`);
    await notify(user.practiceId, [userId], { title: "Group shared with you", message: `${user.name} shared the group "${group.name}" with you as ${MAP_ROLE_LABEL[role]}.`, href: back(group.id) });
    return `Shared with ${member.user.name} as ${MAP_ROLE_LABEL[role]}`;
  });
}

export async function setGroupMemberRole(memberId: string, fd: FormData) {
  const member = await prisma.gisGroupMember.findUnique({ where: { id: memberId } });
  return guarded("gis.edit", back(member?.groupId, "&tab=members"), async (user) => {
    if (!member) fail("Member not found");
    const { group } = await ownGroup(user, member!.groupId, "ADMIN");
    const role = str(fd, "role");
    if (member!.role === "OWNER") fail("The owner's role can't change");
    if (!isMapRole(role) || !(GRANTABLE_ROLES as readonly string[]).includes(role)) fail("Pick Admin, Editor or Viewer");
    await prisma.gisGroupMember.update({ where: { id: member!.id }, data: { role } });
    await logAudit(user.practiceId, user.id, "GIS_GROUP_ROLE", "GisGroup", group.id, `${member!.userId}: ${member!.role} -> ${role}`);
  });
}

export async function removeGroupMember(memberId: string) {
  const member = await prisma.gisGroupMember.findUnique({ where: { id: memberId } });
  return guarded("gis.edit", back(member?.groupId, "&tab=members"), async (user) => {
    if (!member) fail("Member not found");
    if (member!.role === "OWNER") fail("The owner can't be removed; delete the group instead");
    const leaving = member!.userId === user.id;
    const { group } = await ownGroup(user, member!.groupId, leaving ? "VIEWER" : "ADMIN");
    await prisma.gisGroupMember.delete({ where: { id: member!.id } });
    await logAudit(user.practiceId, user.id, "GIS_GROUP_UNSHARE", "GisGroup", group.id, `${member!.userId}${leaving ? " (left)" : ""}`);
    return leaving ? `${BASE}?ok=${encodeURIComponent(`You left "${group.name}"`)}` : "Member removed";
  });
}

// Whether this group shows in My Groups on the caller's maps.
export async function toggleGroupOnMap(groupId: string, fd: FormData) {
  const returnTo = str(fd, "back") || back(groupId);
  return guarded("gis.view", returnTo, async (user) => {
    const m = await prisma.gisGroupMember.findUnique({ where: { groupId_userId: { groupId, userId: user.id } } });
    if (!m) fail("You are not a member of this group");
    await prisma.gisGroupMember.update({ where: { id: m.id }, data: { visibleOnMap: !m.visibleOnMap } });
    return m.visibleOnMap ? "Group hidden from your maps" : "Group shown on your maps";
  });
}

// Add patients (ticked in the Add Patients dialog, or one id), skipping ones already in the group.
export async function addGroupPatients(groupId: string, fd: FormData) {
  return guarded("gis.edit", back(groupId, "&tab=patients"), async (user) => {
    const { group } = await ownGroup(user, groupId, "EDITOR");
    if (group.groupType !== "PATIENT") fail("This is a clinician group");
    const ids = [...new Set(fd.getAll("ids").map(String).filter((id) => /^[a-z0-9]{10,40}$/.test(id)))];
    if (!ids.length) fail("Tick at least one patient");
    const have = new Set((await prisma.gisGroupPatient.findMany({ where: { groupId: group.id }, select: { patientId: true } })).map((p) => p.patientId));
    const patients = await prisma.patient.findMany({ where: { id: { in: ids }, practiceId: user.practiceId }, select: { id: true } });
    const fresh = patients.map((p) => p.id).filter((id) => !have.has(id));
    if (fresh.length) await prisma.gisGroupPatient.createMany({ data: fresh.map((patientId) => ({ groupId: group.id, patientId, addedById: user.id })) });
    await logAudit(user.practiceId, user.id, "GIS_GROUP_PATIENTS_ADD", "GisGroup", group.id, fresh.join(",").slice(0, 2000));
    return `${fresh.length} patient${fresh.length === 1 ? "" : "s"} added${ids.length - fresh.length ? ` (${ids.length - fresh.length} already in the group)` : ""}`;
  });
}

export async function removeGroupPatients(groupId: string, fd: FormData) {
  return guarded("gis.edit", back(groupId, "&tab=patients"), async (user) => {
    const { group } = await ownGroup(user, groupId, "EDITOR");
    const ids = fd.getAll("ids").map(String);
    if (!ids.length) fail("Tick at least one patient");
    const r = await prisma.gisGroupPatient.deleteMany({ where: { groupId: group.id, patientId: { in: ids } } });
    await logAudit(user.practiceId, user.id, "GIS_GROUP_PATIENTS_REMOVE", "GisGroup", group.id, ids.join(",").slice(0, 2000));
    return `${r.count} removed`;
  });
}

export async function addGroupProvider(groupId: string, fd: FormData) {
  return guarded("gis.edit", back(groupId, "&tab=patients"), async (user) => {
    const { group } = await ownGroup(user, groupId, "EDITOR");
    if (group.groupType !== "PROVIDER") fail("This is a patient group");
    const id = str(fd, "providerId");
    const p = await prisma.renderingProvider.findFirst({ where: { id, practiceId: user.practiceId, ...FIELD_PROVIDER_WHERE, gisTitle: { not: null } } });
    if (!p) fail("Pick a field clinician");
    if (await prisma.gisGroupProvider.findUnique({ where: { groupId_renderingProviderId: { groupId: group.id, renderingProviderId: p.id } } })) fail(`${p.name} is already in the group`);
    await prisma.gisGroupProvider.create({ data: { groupId: group.id, renderingProviderId: p.id, addedById: user.id } });
    await logAudit(user.practiceId, user.id, "GIS_GROUP_PROVIDER_ADD", "GisGroup", group.id, p.name);
    return `${p.name} added`;
  });
}

export async function removeGroupProvider(groupId: string, providerId: string) {
  return guarded("gis.edit", back(groupId, "&tab=patients"), async (user) => {
    const { group } = await ownGroup(user, groupId, "EDITOR");
    await prisma.gisGroupProvider.deleteMany({ where: { groupId: group.id, renderingProviderId: providerId } });
    await logAudit(user.practiceId, user.id, "GIS_GROUP_PROVIDER_REMOVE", "GisGroup", group.id, providerId);
    return "Clinician removed";
  });
}
