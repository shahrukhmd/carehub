import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { hashToken, newToken } from "@/lib/connect/core";

const cookieName = (requestId: string) => `pc_${requestId}`;
export const MAX_DOB_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

export async function loadPortalRequest(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  return prisma.intakeRequest.findUnique({
    where: { token },
    include: {
      patient: true,
      packet: true,
      appointment: { include: { location: true } },
      practice: { include: { connectSettings: true } },
    },
  });
}

export type PortalRequest = NonNullable<Awaited<ReturnType<typeof loadPortalRequest>>>;

// The browser that passed the date-of-birth check (or started a kiosk session) holds a random key.
export async function isPortalVerified(r: { id: string; sessionHash: string | null }) {
  if (!r.sessionHash) return false;
  const v = (await cookies()).get(cookieName(r.id))?.value;
  return Boolean(v && hashToken(v) === r.sessionHash);
}

export async function startPortalSession(requestId: string) {
  const key = newToken();
  (await cookies()).set(cookieName(requestId), key, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 3, secure: process.env.NODE_ENV === "production" });
  await prisma.intakeRequest.update({ where: { id: requestId }, data: { sessionHash: hashToken(key) } });
}

export function portalState(r: { status: string; expiresAt: Date }) {
  if (r.status === "CANCELLED") return "cancelled" as const;
  if (r.status === "COMPLETED") return "completed" as const;
  if (r.status === "EXPIRED" || r.expiresAt < new Date()) return "expired" as const;
  return "open" as const;
}
