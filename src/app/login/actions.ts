"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { createSession, destroySession, getCurrentUser, setActivePractice } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export async function login(formData: FormData) {
  const identifier = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const user = identifier
    ? await prisma.user.findFirst({ where: { OR: [{ email: identifier }, { username: identifier }] } })
    : null;

  if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
    await logAudit(user?.practiceId ?? null, user?.id ?? null, "LOGIN_FAILED", "User", user?.id, identifier);
    redirect("/login?error=1");
  }

  await createSession(user.id, user.practiceId);
  await logAudit(user.practiceId, user.id, "LOGIN_SUCCESS", "User", user.id);

  // Users who work in more than one practice choose their facility before entering.
  const memberships = await prisma.membership.count({ where: { userId: user.id } });
  redirect(memberships > 1 ? "/select-facility" : "/");
}

export async function chooseFacility(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const practiceId = String(formData.get("practiceId") ?? "");
  await setActivePractice(practiceId);
  await logAudit(practiceId, user.id, "SELECT_FACILITY", "Practice", practiceId);
  redirect("/");
}

export async function logout() {
  const user = await getCurrentUser();
  if (user) await logAudit(user.practiceId, user.id, "LOGOUT", "User", user.id);
  await destroySession();
  redirect("/login");
}
