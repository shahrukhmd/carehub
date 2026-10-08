"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { logAudit } from "@/lib/audit";
import { ensureRenderingProviderForUser } from "@/lib/credentialing";
import { PERMISSIONS, can, parseOverrideDetails, serializeOverrides, type OverrideDetails, type PermissionKey, rolesFor } from "@/lib/permissions";

const ROLES = ["ADMIN", "FRONT_DESK", "CLINICIAN", "BILLER", "CREDENTIALING", "INTAKE", "VERIFICATION", "SCHEDULER", "CDS", "CODER", "BD"];

function required(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

export async function createStaff(formData: FormData) {
  const actor = await requireUser(rolesFor("settings.admin"));

  const name = required(formData, "name");
  const email = required(formData, "email").toLowerCase();
  const role = required(formData, "role");
  if (!ROLES.includes(role)) throw new Error("Invalid role");
  const password = required(formData, "password");

  const user = await prisma.user.create({
    data: {
      practiceId: actor.practiceId,
      name,
      email,
      role,
      passwordHash: hashPassword(password),
      mustChangePassword: true,
      npi: String(formData.get("npi") ?? "").trim() || null,
      specialty: String(formData.get("specialty") ?? "").trim() || null,
    },
  });

  await prisma.membership.create({
    data: { userId: user.id, practiceId: actor.practiceId, role },
  });

  if (role === "CLINICIAN") {
    await ensureRenderingProviderForUser(user.id, actor.practiceId);
  }

  await logAudit(actor.practiceId, actor.id, "CREATE_STAFF", "User", user.id, `${email} (${role})`);

  revalidatePath("/settings/users");
  revalidatePath("/credentialing");
}

export async function updateStaffRole(userId: string, formData: FormData) {
  const actor = await requireUser(rolesFor("settings.admin"));
  const role = required(formData, "role");
  if (!ROLES.includes(role)) throw new Error("Invalid role");

  if (userId === actor.id && role !== "ADMIN") {
    throw new Error("You cannot remove your own admin role");
  }

  const membership = await prisma.membership.findFirstOrThrow({
    where: { userId, practiceId: actor.practiceId },
  });
  await prisma.membership.update({ where: { id: membership.id }, data: { role } });

  const targetUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (targetUser.practiceId === actor.practiceId) {
    await prisma.user.update({ where: { id: userId }, data: { role } });
  }

  // A clinician's directory record belongs to their home practice only.
  if (role === "CLINICIAN" && targetUser.practiceId === actor.practiceId) {
    await ensureRenderingProviderForUser(userId, actor.practiceId);
  }

  await logAudit(actor.practiceId, actor.id, "UPDATE_STAFF_ROLE", "User", userId, `${membership.role} -> ${role}`);

  revalidatePath("/settings/users");
  revalidatePath("/credentialing");
}

export async function toggleStaffActive(userId: string) {
  const actor = await requireUser(rolesFor("settings.admin"));
  if (userId === actor.id) {
    throw new Error("You cannot deactivate your own account");
  }

  const user = await prisma.user.findFirstOrThrow({ where: { id: userId, practiceId: actor.practiceId } });
  await prisma.user.update({ where: { id: userId }, data: { active: !user.active } });

  if (user.active) {
    await prisma.session.deleteMany({ where: { userId } });
  }

  await logAudit(
    actor.practiceId,
    actor.id,
    user.active ? "DEACTIVATE_STAFF" : "REACTIVATE_STAFF",
    "User",
    userId,
    user.email
  );

  revalidatePath("/settings/users");
}

export async function resetStaffPassword(userId: string, formData: FormData) {
  const actor = await requireUser(rolesFor("settings.admin"));
  const password = required(formData, "password");

  const target = await prisma.user.findFirstOrThrow({ where: { id: userId, practiceId: actor.practiceId } });
  await prisma.user.update({
    where: { id: target.id },
    data: { passwordHash: hashPassword(password), mustChangePassword: true, failedLogins: 0, lockedUntil: null },
  });
  await prisma.session.deleteMany({ where: { userId: target.id } });

  await logAudit(actor.practiceId, actor.id, "RESET_PASSWORD", "User", userId, target.email);

  revalidatePath("/settings/users");
}

export async function addPracticeMember(formData: FormData) {
  const actor = await requireUser(rolesFor("settings.admin"));
  const email = required(formData, "email").toLowerCase();
  const role = required(formData, "role");
  if (!ROLES.includes(role)) throw new Error("Invalid role");

  const user = await prisma.user.findUnique({ where: { email }, include: { practice: true } });
  if (!user) {
    throw new Error("No account exists with that email. Ask them to sign in once first, or create a new staff account instead.");
  }
  // Each user belongs to one client; access can only be shared between that client's practices.
  if (user.practice.organizationId !== actor.practice.organizationId) {
    throw new Error("That user belongs to a different client organization.");
  }

  const existing = await prisma.membership.findUnique({
    where: { userId_practiceId: { userId: user.id, practiceId: actor.practiceId } },
  });
  if (existing) throw new Error("That user already has access to this practice");

  await prisma.membership.create({
    data: { userId: user.id, practiceId: actor.practiceId, role },
  });

  await logAudit(actor.practiceId, actor.id, "GRANT_PRACTICE_ACCESS", "User", user.id, `${email} (${role})`);

  revalidatePath("/settings/users");
}

export async function removeMembership(membershipId: string) {
  const actor = await requireUser(rolesFor("settings.admin"));

  const membership = await prisma.membership.findFirstOrThrow({
    where: { id: membershipId, practiceId: actor.practiceId },
    include: { user: true },
  });

  if (membership.user.practiceId === actor.practiceId) {
    throw new Error("Cannot revoke access to a staff member's home practice — deactivate their account instead");
  }

  await prisma.membership.delete({ where: { id: membership.id } });
  // Any session the user has open in this practice ends now, not when it expires.
  await prisma.session.deleteMany({ where: { userId: membership.userId, activePracticeId: membership.practiceId } });

  await logAudit(actor.practiceId, actor.id, "REVOKE_PRACTICE_ACCESS", "User", membership.userId, membership.user.email);

  revalidatePath("/settings/users");
}

// Per-user permission overrides for this practice. Each permission is "default" (the role decides), "allow" or
// "deny"; only entries that differ from the role's default are stored. Admins cannot change their own access.
export async function savePermissionOverrides(membershipId: string, formData: FormData) {
  const actor = await requireUser(rolesFor("settings.admin"));
  const membership = await prisma.membership.findFirstOrThrow({
    where: { id: membershipId, practiceId: actor.practiceId },
    include: { user: true },
  });
  if (membership.userId === actor.id) throw new Error("You cannot change your own permissions");

  const before = parseOverrideDetails(membership.permissions);
  const overrides: OverrideDetails = {};
  if (formData.get("intent") !== "reset") {
    const reason = String(formData.get("reason") ?? "").trim().slice(0, 200);
    const until = String(formData.get("until") ?? "").trim();
    if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error("Pick a valid expiry date");
    const stamp = new Date().toISOString().slice(0, 10);
    let changed = 0;
    for (const key of Object.keys(PERMISSIONS) as PermissionKey[]) {
      const v = formData.get(`perm:${key}`);
      const allow = v === "allow" ? true : v === "deny" ? false : undefined;
      if (allow === undefined) continue;
      // Anti-escalation: an admin can only grant what they themselves hold in this practice.
      if (allow && !can(actor, key)) throw new Error(`You cannot grant "${PERMISSIONS[key].label}" — you do not hold it yourself in this practice.`);
      const prev = before[key];
      if (prev && prev.allow === allow && !reason && !until) overrides[key] = prev;
      else {
        overrides[key] = { allow, reason: reason || prev?.reason, by: actor.id, at: stamp, until: until || prev?.until };
        changed++;
      }
    }
    if (changed && !reason && !Object.values(overrides).some((d) => d?.reason)) throw new Error("Say why these permissions change (a reason is kept with the override).");
  }
  const json = serializeOverrides(membership.role, overrides);
  await prisma.membership.update({ where: { id: membership.id }, data: { permissions: json } });

  const after = parseOverrideDetails(json);
  const changes = (Object.keys(PERMISSIONS) as PermissionKey[])
    .filter((k) => before[k]?.allow !== after[k]?.allow || before[k]?.until !== after[k]?.until)
    .map((k) => `${k}: ${!after[k] ? "default" : `${after[k]!.allow ? "allow" : "deny"}${after[k]!.until ? ` until ${after[k]!.until}` : ""}${after[k]!.reason ? ` (${after[k]!.reason})` : ""}`}`);
  if (changes.length) {
    await logAudit(actor.practiceId, actor.id, "SET_PERMISSION_OVERRIDES", "User", membership.userId, `${membership.user.email}: ${changes.join(", ")}`);
  }

  revalidatePath("/settings/users");
  redirect(`/settings/users?perms=${membership.id}&saved=1#permissions-editor`);
}

// Lift a lockout before it expires.
export async function unlockStaff(userId: string) {
  const actor = await requireUser(["ADMIN"]);
  const target = await prisma.user.findFirstOrThrow({ where: { id: userId, memberships: { some: { practiceId: actor.practiceId } } } });
  await prisma.user.update({ where: { id: target.id }, data: { lockedUntil: null, failedLogins: 0 } });
  await logAudit(actor.practiceId, actor.id, "UNLOCK_ACCOUNT", "User", target.id, target.email);
  revalidatePath("/settings/users");
}

// Second factor per user: none, or a code by email at every sign-in.
export async function setTwoFactor(userId: string, formData: FormData) {
  const actor = await requireUser(["ADMIN"]);
  const method = String(formData.get("method") ?? "NONE") === "EMAIL" ? "EMAIL" : "NONE";
  const target = await prisma.user.findFirstOrThrow({ where: { id: userId, memberships: { some: { practiceId: actor.practiceId } } } });
  await prisma.user.update({ where: { id: target.id }, data: { twoFactorMethod: method } });
  await logAudit(actor.practiceId, actor.id, "SET_TWO_FACTOR", "User", target.id, `${target.email}: ${method}`);
  revalidatePath("/settings/users");
}
