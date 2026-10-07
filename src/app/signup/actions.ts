"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { createSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

function required(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function signup(formData: FormData) {
  const practiceName = required(formData, "practiceName");
  const locationName = String(formData.get("locationName") ?? "").trim() || "Main Location";
  const city = String(formData.get("city") ?? "").trim() || null;
  const state = String(formData.get("state") ?? "").trim() || null;
  const adminName = required(formData, "adminName");
  const email = required(formData, "email").toLowerCase();
  const password = required(formData, "password");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    redirect("/signup?error=email");
  }

  const baseSlug = slugify(practiceName) || "practice";
  let slug = baseSlug;
  let suffix = 1;
  while (await prisma.practice.findUnique({ where: { slug } })) {
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }

  const { practice, admin } = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({ data: { name: practiceName } });
    const practice = await tx.practice.create({
      data: {
        name: practiceName,
        slug,
        state,
        organizationId: organization.id,
        locations: { create: { name: locationName, city, state } },
      },
    });

    const admin = await tx.user.create({
      data: {
        practiceId: practice.id,
        name: adminName,
        email,
        role: "ADMIN",
        passwordHash: hashPassword(password),
        passwordChangedAt: new Date(),
      },
    });

    await tx.membership.create({
      data: { userId: admin.id, practiceId: practice.id, role: "ADMIN" },
    });

    return { practice, admin };
  });

  await createSession(admin.id, practice.id);
  await logAudit(practice.id, admin.id, "PRACTICE_CREATED", "Practice", practice.id, practiceName);

  redirect("/");
}
