"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { logAudit } from "@/lib/audit";

const ROLES = ["ADMIN", "FRONT_DESK", "CLINICIAN", "BILLER"];

function required(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

export async function createStaff(formData: FormData) {
  const actor = await requireUser(["ADMIN"]);

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
      npi: String(formData.get("npi") ?? "").trim() || null,
      specialty: String(formData.get("specialty") ?? "").trim() || null,
    },
  });

  await prisma.membership.create({
    data: { userId: user.id, practiceId: actor.practiceId, role },
  });

  await logAudit(actor.practiceId, actor.id, "CREATE_STAFF", "User", user.id, `${email} (${role})`);

  revalidatePath("/staff");
}

export async function updateStaffRole(userId: string, formData: FormData) {
  const actor = await requireUser(["ADMIN"]);
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

  await logAudit(actor.practiceId, actor.id, "UPDATE_STAFF_ROLE", "User", userId, `${membership.role} -> ${role}`);

  revalidatePath("/staff");
}

export async function toggleStaffActive(userId: string) {
  const actor = await requireUser(["ADMIN"]);
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

  revalidatePath("/staff");
}

export async function resetStaffPassword(userId: string, formData: FormData) {
  const actor = await requireUser(["ADMIN"]);
  const password = required(formData, "password");

  const target = await prisma.user.findFirstOrThrow({ where: { id: userId, practiceId: actor.practiceId } });
  await prisma.user.update({
    where: { id: target.id },
    data: { passwordHash: hashPassword(password) },
  });
  await prisma.session.deleteMany({ where: { userId: target.id } });

  await logAudit(actor.practiceId, actor.id, "RESET_PASSWORD", "User", userId, target.email);

  revalidatePath("/staff");
}

export async function addPracticeMember(formData: FormData) {
  const actor = await requireUser(["ADMIN"]);
  const email = required(formData, "email").toLowerCase();
  const role = required(formData, "role");
  if (!ROLES.includes(role)) throw new Error("Invalid role");

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error("No account exists with that email. Ask them to sign in once first, or create a new staff account instead.");
  }

  const existing = await prisma.membership.findUnique({
    where: { userId_practiceId: { userId: user.id, practiceId: actor.practiceId } },
  });
  if (existing) throw new Error("That user already has access to this practice");

  await prisma.membership.create({
    data: { userId: user.id, practiceId: actor.practiceId, role },
  });

  await logAudit(actor.practiceId, actor.id, "GRANT_PRACTICE_ACCESS", "User", user.id, `${email} (${role})`);

  revalidatePath("/staff");
}

export async function removeMembership(membershipId: string) {
  const actor = await requireUser(["ADMIN"]);

  const membership = await prisma.membership.findFirstOrThrow({
    where: { id: membershipId, practiceId: actor.practiceId },
    include: { user: true },
  });

  if (membership.user.practiceId === actor.practiceId) {
    throw new Error("Cannot revoke access to a staff member's home practice — deactivate their account instead");
  }

  await prisma.membership.delete({ where: { id: membership.id } });

  await logAudit(actor.practiceId, actor.id, "REVOKE_PRACTICE_ACCESS", "User", membership.userId, membership.user.email);

  revalidatePath("/staff");
}
