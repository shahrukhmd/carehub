"use server";

import { rolesFor } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export async function saveLetterTemplate(id: string, fd: FormData) {
  const user = await requireUser(rolesFor("settings.admin"));
  const name = String(fd.get("name") ?? "").trim().slice(0, 80);
  const body = String(fd.get("body") ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 20000);
  if (!name || !body) redirect(`/settings/letters?edit=${id}&error=${encodeURIComponent("Name and letter text are required.")}`);
  const data = { name, subject: String(fd.get("subject") ?? "").trim().slice(0, 200) || null, body, active: fd.get("active") === "on" };
  if (id === "new") {
    const t = await prisma.letterTemplate.create({ data: { ...data, practiceId: user.practiceId, key: `custom_${Date.now().toString(36)}` } });
    await logAudit(user.practiceId, user.id, "CREATE_LETTER_TEMPLATE", "LetterTemplate", t.id, name);
  } else {
    await prisma.letterTemplate.updateMany({ where: { id, practiceId: user.practiceId }, data });
    await logAudit(user.practiceId, user.id, "UPDATE_LETTER_TEMPLATE", "LetterTemplate", id, name);
  }
  revalidatePath("/settings/letters");
  redirect("/settings/letters?saved=1");
}

export async function deleteLetterTemplate(id: string) {
  const user = await requireUser(rolesFor("settings.admin"));
  await prisma.letterTemplate.deleteMany({ where: { id, practiceId: user.practiceId, standard: false } });
  revalidatePath("/settings/letters");
  redirect("/settings/letters");
}
