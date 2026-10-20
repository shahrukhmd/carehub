import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/gis/notify";

// Share links: a short URL-safe code is the secret; only its hash is stored. The public page looks the hash up,
// checks expiry and the open cap, counts the open and returns the shared layers.

const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newCode(length = 10) {
  const bytes = randomBytes(length);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}
export const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");
export const isCode = (v: string) => /^[A-Za-z0-9]{8,24}$/.test(v);

export type LinkState = "ACTIVE" | "EXPIRED" | "USED";
export function linkState(l: { expiresAt: Date; expiredAt: Date | null; maxAccess: number; accessCount: number }, now = new Date()): LinkState {
  if (l.expiredAt || l.expiresAt < now) return "EXPIRED";
  if (l.accessCount >= l.maxAccess) return "USED";
  return "ACTIVE";
}

export function parseRouteIds(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// Opens a link: null when unknown; otherwise the link with its state. Counts the open only when it is usable.
export async function openShareLink(code: string) {
  if (!isCode(code)) return null;
  const link = await prisma.gisShareLink.findUnique({
    where: { codeHash: hashCode(code) },
    include: { map: { include: { provider: true, practice: { select: { name: true, connectSettings: true } } } } },
  });
  if (!link) return null;
  const state = linkState(link);
  if (state !== "ACTIVE") return { link, state, routes: [] };
  await prisma.gisShareLink.update({ where: { id: link.id }, data: { accessCount: { increment: 1 }, lastOpenedAt: new Date() } });
  // Tell the coordinator on the first open and when the cap is reached.
  if (link.createdById && (link.accessCount === 0 || link.accessCount + 1 === link.maxAccess)) {
    await notify(link.practiceId, [link.createdById], { title: link.accessCount === 0 ? "Route link opened" : "Route link used up", message: `The link ${link.codeHint} for "${link.map.label}" ${link.accessCount === 0 ? "was opened for the first time" : "has reached its open limit"}.`, href: "/gis/links" });
  }
  const ids = parseRouteIds(link.routeIds);
  const routes = await prisma.gisRoute.findMany({
    where: { id: { in: ids }, mapId: link.mapId },
    include: { stops: { orderBy: { index: "asc" }, include: { patient: { select: { id: true, firstName: true, lastName: true, addressLine1: true, addressLine2: true, city: true, state: true, zip: true, latitude: true, longitude: true, phone: true } } } } },
    orderBy: [{ visitDate: "asc" }, { createdAt: "asc" }],
  });
  return { link, state, routes };
}

export const publicBase = () => (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
