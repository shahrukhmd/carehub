import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

const SESSION_COOKIE = "session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export async function createSession(userId: string, activePracticeId: string) {
  const session = await prisma.session.create({
    data: { userId, activePracticeId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: session.expiresAt,
    path: "/",
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (sessionId) {
    await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
  }
  cookieStore.delete(SESSION_COOKIE);
}

async function getSessionRecord() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });

  if (!session || session.expiresAt < new Date() || !session.user.active) {
    return null;
  }

  return session;
}

export async function getCurrentUser() {
  const session = await getSessionRecord();
  if (!session) return null;

  const activePracticeId = session.activePracticeId ?? session.user.practiceId;

  const [membership, practice, memberships] = await Promise.all([
    prisma.membership.findUnique({
      where: { userId_practiceId: { userId: session.user.id, practiceId: activePracticeId } },
    }),
    prisma.practice.findUnique({ where: { id: activePracticeId } }),
    prisma.membership.findMany({
      where: { userId: session.user.id },
      include: { practice: true },
      orderBy: { practice: { name: "asc" } },
    }),
  ]);

  if (!practice) return null;
  // Access to a practice other than the user's home practice comes only from a membership. When the membership was
  // revoked, the session no longer counts for that practice (the user is sent to sign in again).
  if (!membership && activePracticeId !== session.user.practiceId) return null;

  return {
    ...session.user,
    practiceId: activePracticeId,
    role: membership?.role ?? session.user.role,
    practice,
    memberships,
  };
}

export async function requireUser(allowedRoles?: string[]) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (allowedRoles && !allowedRoles.includes(user.role)) redirect("/");
  return user;
}

export async function setActivePractice(practiceId: string) {
  const session = await getSessionRecord();
  if (!session) redirect("/login");

  const membership = await prisma.membership.findUnique({
    where: { userId_practiceId: { userId: session.user.id, practiceId } },
  });
  if (!membership) throw new Error("Not a member of that practice");

  await prisma.session.update({ where: { id: session.id }, data: { activePracticeId: practiceId } });
}
