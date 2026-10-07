import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { allowed, parseOverrides, type RoleList } from "@/lib/permissions";

const SESSION_COOKIE = "session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export async function createSession(userId: string, activePracticeId: string, opts: { twoFactorPending?: boolean } = {}) {
  const session = await prisma.session.create({
    data: { userId, activePracticeId, expiresAt: new Date(Date.now() + SESSION_TTL_MS), twoFactorPending: opts.twoFactorPending ?? false },
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: session.expiresAt,
    path: "/",
  });
  return session;
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

// A session that has passed the password but not yet the emailed code (only the verify page uses it).
export async function getPendingSession() {
  const session = await getSessionRecord();
  return session && session.twoFactorPending ? session : null;
}

// The organization's idle timeout: a session unused for longer than allowed ends; otherwise its last-seen
// time moves forward (at most once a minute, to keep writes down).
async function enforceIdle(session: NonNullable<Awaited<ReturnType<typeof getSessionRecord>>>) {
  const practice = await prisma.practice.findUnique({ where: { id: session.activePracticeId ?? session.user.practiceId }, select: { organization: { select: { idleTimeoutMinutes: true } } } });
  const idle = practice?.organization?.idleTimeoutMinutes ?? 0;
  const now = Date.now();
  if (idle > 0 && now - session.lastSeenAt.getTime() > idle * 60_000) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return false;
  }
  if (now - session.lastSeenAt.getTime() > 60_000) await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } }).catch(() => {});
  return true;
}

export async function getCurrentUser(opts: { allowPasswordChange?: boolean } = {}) {
  const session = await getSessionRecord();
  if (!session) return null;
  // Not signed in until the second factor is done.
  if (session.twoFactorPending) return null;
  if (!(await enforceIdle(session))) return null;
  // A user who must change their password can reach only the password page (and sign out).
  if (session.user.mustChangePassword && !opts.allowPasswordChange) return null;

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
    // This person's permission overrides in the active practice (Settings → Users & roles).
    overrides: parseOverrides(membership?.permissions),
    practice,
    memberships,
    sessionId: session.id,
  };
}

// Gate a page or action. A list from rolesFor(key) also honours the user's permission overrides; a hand-written
// role list is checked against the role alone.
export async function requireUser(allowedRoles?: RoleList | string[]) {
  const user = await getCurrentUser();
  if (!user) {
    // Signed in but owing a password change: send them there rather than to the sign-in page.
    const pending = await getSessionRecord();
    if (pending && !pending.twoFactorPending && pending.user.mustChangePassword) redirect("/login/password");
    redirect("/login");
  }
  if (allowedRoles && !allowed(user, allowedRoles)) redirect("/");
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
