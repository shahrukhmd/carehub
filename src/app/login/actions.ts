"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { createSession, destroySession, getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const user = email ? await prisma.user.findUnique({ where: { email } }) : null;

  if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
    await logAudit(user?.practiceId ?? null, user?.id ?? null, "LOGIN_FAILED", "User", user?.id, email);
    redirect("/login?error=1");
  }

  await createSession(user.id, user.practiceId);
  await logAudit(user.practiceId, user.id, "LOGIN_SUCCESS", "User", user.id);
  redirect("/");
}

export async function logout() {
  const user = await getCurrentUser();
  if (user) await logAudit(user.practiceId, user.id, "LOGOUT", "User", user.id);
  await destroySession();
  redirect("/login");
}
