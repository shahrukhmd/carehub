"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { atLeast, mapRoleFor } from "@/lib/gis/maps";
import { getGisSettings } from "@/lib/gis/settings";
import { hashCode, newCode, publicBase } from "@/lib/gis/share";
import { fail, guarded } from "@/lib/gis/guard";

// Generate Link from the map workspace: one link for the chosen layers of a map. Returns the URL (shown once;
// only the hash is kept). Needs the Editor role on the map.
export type LinkResult = { ok: true; url: string; expiresAt: string } | { ok: false; error: string };

export async function createShareLink(mapId: string, routeIds: string[]): Promise<LinkResult> {
  const user = await requireUser();
  if (!can(user, "gis.edit")) return { ok: false, error: "You don't have GIS edit rights" };
  const map = await prisma.gisMap.findFirst({ where: { id: mapId, practiceId: user.practiceId, deletedAt: null }, select: { id: true, label: true } });
  if (!map) return { ok: false, error: "Map not found" };
  if (!atLeast(await mapRoleFor(user.id, map.id), "EDITOR")) return { ok: false, error: "Viewers can't share this map" };
  const ids = [...new Set(routeIds.filter((id) => /^[a-z0-9]{10,40}$/.test(id)))];
  const routes = await prisma.gisRoute.findMany({ where: { id: { in: ids }, mapId: map.id }, select: { id: true, label: true } });
  if (!routes.length) return { ok: false, error: "Tick at least one layer to share" };
  const settings = await getGisSettings(user.practiceId);
  const code = newCode();
  const expiresAt = new Date(Date.now() + settings.shareLinkDays * 86_400_000);
  const link = await prisma.gisShareLink.create({
    data: { practiceId: user.practiceId, mapId: map.id, codeHash: hashCode(code), codeHint: `${code.slice(0, 3)}…${code.slice(-2)}`, routeIds: JSON.stringify(routes.map((r) => r.id)), expiresAt, maxAccess: settings.shareLinkMaxOpens, createdById: user.id },
  });
  await logAudit(user.practiceId, user.id, "GIS_LINK_CREATE", "GisShareLink", link.id, `${map.label}: ${routes.map((r) => r.label).join(", ")} · ${settings.shareLinkDays} days · ${settings.shareLinkMaxOpens} opens`);
  const h = await headers();
  const base = publicBase() || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`;
  return { ok: true, url: `${base}/r/${code}`, expiresAt: expiresAt.toISOString() };
}

const BACK = "/gis/links";

async function ownLink(user: { id: string; practiceId: string }, id: string) {
  const link = await prisma.gisShareLink.findFirst({ where: { id, practiceId: user.practiceId }, include: { map: { select: { id: true, label: true } } } });
  if (!link) fail("Link not found");
  if (!atLeast(await mapRoleFor(user.id, link!.mapId), "EDITOR")) fail(`You need the Editor role on "${link!.map.label}"`);
  return link!;
}

export async function expireShareLinks(fd: FormData) {
  return guarded("gis.edit", BACK, async (user) => {
    const ids = fd.getAll("ids").map(String);
    if (!ids.length) fail("Tick at least one link");
    let n = 0;
    for (const id of ids) {
      const l = await ownLink(user, id);
      if (!l.expiredAt) {
        await prisma.gisShareLink.update({ where: { id: l.id }, data: { expiredAt: new Date() } });
        n++;
      }
    }
    await logAudit(user.practiceId, user.id, "GIS_LINK_EXPIRE", "GisShareLink", undefined, ids.join(","));
    return `${n} link${n === 1 ? "" : "s"} expired`;
  });
}

export async function deleteShareLinks(fd: FormData) {
  return guarded("gis.edit", BACK, async (user) => {
    const ids = fd.getAll("ids").map(String);
    if (!ids.length) fail("Tick at least one link");
    for (const id of ids) await ownLink(user, id);
    const r = await prisma.gisShareLink.deleteMany({ where: { id: { in: ids }, practiceId: user.practiceId } });
    await logAudit(user.practiceId, user.id, "GIS_LINK_DELETE", "GisShareLink", undefined, ids.join(","));
    return `${r.count} link${r.count === 1 ? "" : "s"} deleted`;
  });
}

export async function purgeExpiredLinks() {
  return guarded("gis.edit", BACK, async (user) => {
    const r = await prisma.gisShareLink.deleteMany({ where: { practiceId: user.practiceId, OR: [{ expiredAt: { not: null } }, { expiresAt: { lt: new Date() } }] } });
    await logAudit(user.practiceId, user.id, "GIS_LINK_PURGE", "GisShareLink", undefined, `${r.count}`);
    return `${r.count} expired link${r.count === 1 ? "" : "s"} removed`;
  });
}

export async function expireOne(id: string) {
  return guarded("gis.edit", BACK, async (user) => {
    const l = await ownLink(user, id);
    await prisma.gisShareLink.update({ where: { id: l.id }, data: { expiredAt: new Date() } });
    await logAudit(user.practiceId, user.id, "GIS_LINK_EXPIRE", "GisShareLink", l.id, l.codeHint);
    return "Link expired";
  });
}
