"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { hashApiToken, newApiToken } from "@/lib/fhir";

export async function createApiClient(fd: FormData) {
  const user = await requireUser(["ADMIN"]);
  const name = String(fd.get("name") ?? "").trim().slice(0, 80);
  if (!name) redirect(`/settings/interop?error=${encodeURIComponent("Name the connected system.")}`);
  const token = newApiToken();
  const c = await prisma.apiClient.create({ data: { practiceId: user.practiceId, name, tokenHash: hashApiToken(token), tokenHint: token.slice(-4), createdById: user.id } });
  await logAudit(user.practiceId, user.id, "CREATE_API_CLIENT", "ApiClient", c.id, name);
  // Shown once on the next page view; never stored in plain text.
  (await cookies()).set("ch_new_token", token, { httpOnly: true, sameSite: "strict", path: "/settings/interop", maxAge: 60 });
  revalidatePath("/settings/interop");
  redirect("/settings/interop?created=1");
}

export async function revokeApiClient(id: string) {
  const user = await requireUser(["ADMIN"]);
  await prisma.apiClient.updateMany({ where: { id, practiceId: user.practiceId }, data: { active: false } });
  await logAudit(user.practiceId, user.id, "REVOKE_API_CLIENT", "ApiClient", id, "revoked");
  revalidatePath("/settings/interop");
  redirect("/settings/interop");
}
