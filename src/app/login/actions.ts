"use server";

import { randomInt } from "crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createSession, destroySession, getCurrentUser, getPendingSession, setActivePractice } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { hashToken, sendMessage } from "@/lib/connect/core";
import { PASSWORD_MIN, ipAllowed, loginPolicyForUser, organizationBlock, organizationForPractice } from "@/lib/organization";

const OTP_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 3;

async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
}

// After the password (and the second factor): the facility choice for multi-practice users, else home.
async function afterLogin(userId: string) {
  const memberships = await prisma.membership.count({ where: { userId } });
  redirect(memberships > 1 ? "/select-facility" : "/");
}

export async function login(formData: FormData) {
  const identifier = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const user = identifier ? await prisma.user.findFirst({ where: { OR: [{ email: identifier }, { username: identifier }] } }) : null;

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    await logAudit(user.practiceId, user.id, "LOGIN_LOCKED", "User", user.id, identifier);
    redirect("/login?error=locked");
  }

  if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
    await logAudit(user?.practiceId ?? null, user?.id ?? null, "LOGIN_FAILED", "User", user?.id, identifier);
    if (user) {
      // Lockout after the organization's number of failed attempts.
      const policy = await loginPolicyForUser(user);
      const failed = user.failedLogins + 1;
      if (failed >= policy.maxFailedLogins) {
        await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: new Date(Date.now() + policy.lockoutMinutes * 60_000) } });
        await logAudit(user.practiceId, user.id, "ACCOUNT_LOCKED", "User", user.id, `${failed} failed attempts · ${policy.lockoutMinutes} min`);
        redirect("/login?error=locked");
      }
      await prisma.user.update({ where: { id: user.id }, data: { failedLogins: failed } });
    }
    redirect("/login?error=1");
  }

  // The client account must be open.
  const org = await organizationForPractice(user.practiceId);
  const block = organizationBlock(org);
  if (block) {
    await logAudit(user.practiceId, user.id, "LOGIN_REFUSED", "User", user.id, block);
    redirect("/login?error=terminated");
  }

  // Office IP allow-list for the organization's staff (exempt addresses skip it).
  const policy = await loginPolicyForUser(user);
  const ip = await clientIp();
  if (policy.ipAllowlist.length && !policy.ipAllowlistExempt.includes(user.email.toLowerCase()) && !ipAllowed(ip, policy.ipAllowlist)) {
    await logAudit(user.practiceId, user.id, "LOGIN_BLOCKED_IP", "User", user.id, ip ?? "unknown");
    redirect("/login?error=ip");
  }

  // Password age: force a change when it is older than the policy allows.
  const stale = policy.passwordMaxAgeDays > 0 && (!user.passwordChangedAt || user.passwordChangedAt < new Date(Date.now() - policy.passwordMaxAgeDays * 86_400_000));
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, ...(stale ? { mustChangePassword: true } : {}) } });

  const needsSecondFactor = policy.twoFactorRequired || user.twoFactorMethod === "EMAIL";
  const session = await createSession(user.id, user.practiceId, { twoFactorPending: needsSecondFactor });
  await logAudit(user.practiceId, user.id, needsSecondFactor ? "LOGIN_PASSWORD_OK" : "LOGIN_SUCCESS", "User", user.id, ip ?? undefined);

  if (needsSecondFactor) {
    await issueCode(session.id, user);
    redirect("/login/verify");
  }
  await afterLogin(user.id);
}

// A six-digit code emailed to the user; only its hash is stored. With no email provider connected (test
// mode) the message lands in the message log and the verify page shows the code so the flow can be used.
async function issueCode(sessionId: string, user: { id: string; practiceId: string; email: string; name: string }) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.session.update({
    where: { id: sessionId },
    data: { otpHash: hashToken(code), otpExpiresAt: new Date(Date.now() + OTP_MINUTES * 60_000), otpAttempts: 0 },
  });
  await sendMessage({
    practiceId: user.practiceId,
    channel: "EMAIL",
    to: user.email,
    subject: "Your CareHub sign-in code",
    body: `Hello ${user.name}, your CareHub sign-in code is ${code}. It expires in ${OTP_MINUTES} minutes. If you did not try to sign in, tell your administrator.`,
    kind: "OTHER",
    userId: user.id,
  });
}

export async function resendCode() {
  const pending = await getPendingSession();
  if (!pending) redirect("/login");
  await issueCode(pending.id, pending.user);
  redirect("/login/verify?sent=1");
}

export async function verifyCode(formData: FormData) {
  const pending = await getPendingSession();
  if (!pending) redirect("/login");
  const code = String(formData.get("code") ?? "").replace(/\D/g, "");
  const expired = !pending.otpExpiresAt || pending.otpExpiresAt <= new Date();
  const ok = !expired && pending.otpHash && hashToken(code) === pending.otpHash;
  if (!ok) {
    const attempts = pending.otpAttempts + 1;
    if (attempts >= OTP_MAX_ATTEMPTS || expired) {
      await destroySession();
      await logAudit(pending.user.practiceId, pending.user.id, "LOGIN_2FA_FAILED", "User", pending.user.id, expired ? "code expired" : `${attempts} wrong codes`);
      redirect("/login?error=code");
    }
    await prisma.session.update({ where: { id: pending.id }, data: { otpAttempts: attempts } });
    redirect(`/login/verify?error=1&left=${OTP_MAX_ATTEMPTS - attempts}`);
  }
  await prisma.session.update({ where: { id: pending.id }, data: { twoFactorPending: false, otpHash: null, otpExpiresAt: null, otpAttempts: 0 } });
  await logAudit(pending.user.practiceId, pending.user.id, "LOGIN_SUCCESS", "User", pending.user.id, "second factor verified");
  await afterLogin(pending.user.id);
}

// Change the signed-in user's password: forced after a reset or by policy, or by choice from Settings.
export async function changePassword(formData: FormData) {
  const user = await getCurrentUser({ allowPasswordChange: true });
  if (!user) redirect("/login");
  const fromSettings = String(formData.get("back") ?? "") === "settings";
  const back = fromSettings ? "/settings/password" : "/login/password";
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("password") ?? "");
  const again = String(formData.get("confirm") ?? "");
  if (!verifyPassword(current, user.passwordHash)) redirect(`${back}?error=current`);
  if (next.length < PASSWORD_MIN || !/[a-z]/i.test(next) || !/\d/.test(next)) redirect(`${back}?error=weak`);
  if (next !== again) redirect(`${back}?error=match`);
  if (next === current) redirect(`${back}?error=same`);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(next), passwordChangedAt: new Date(), mustChangePassword: false } });
  // Every other session of this user ends; the current one continues.
  await prisma.session.deleteMany({ where: { userId: user.id, NOT: { id: user.sessionId } } });
  await logAudit(user.practiceId, user.id, "PASSWORD_CHANGED", "User", user.id);
  redirect(fromSettings ? "/settings/password?saved=1" : "/");
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
  const user = await getCurrentUser({ allowPasswordChange: true });
  if (user) await logAudit(user.practiceId, user.id, "LOGOUT", "User", user.id);
  await destroySession();
  redirect("/login");
}
