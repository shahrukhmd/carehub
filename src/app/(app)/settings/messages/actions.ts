"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

// "2026-09-29" + "08:30" (local) -> Date, or null.
function when(fd: FormData, dateKey: string, timeKey: string, endOfDay: boolean) {
  const d = str(fd, dateKey);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = str(fd, timeKey);
  const time = /^\d{2}:\d{2}$/.test(t) ? t : endOfDay ? "23:59" : "00:00";
  return new Date(`${d}T${time}:00`);
}

export async function saveSystemMessage(id: string, fd: FormData) {
  const user = await requireUser(["ADMIN"]);
  const title = str(fd, "title");
  const message = str(fd, "message");
  const back = id === "new" ? "/settings/messages" : `/settings/messages?edit=${id}`;
  if (!title || !message) redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent("A message needs a title and text.")}`);
  const activeFrom = when(fd, "fromDate", "fromTime", false);
  const activeTo = when(fd, "toDate", "toTime", true);
  if (activeFrom && activeTo && activeTo <= activeFrom) {
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent("The end must be after the start.")}`);
  }
  const data = {
    title: title.slice(0, 120),
    message: message.slice(0, 2000),
    level: ["INFO", "WARNING", "URGENT"].includes(str(fd, "level")) ? str(fd, "level") : "INFO",
    active: fd.get("active") === "on",
    activeFrom,
    activeTo,
  };
  if (id === "new") {
    const m = await prisma.systemMessage.create({ data: { ...data, practiceId: user.practiceId, createdById: user.id } });
    await logAudit(user.practiceId, user.id, "CREATE_SYSTEM_MESSAGE", "SystemMessage", m.id, data.title);
  } else {
    await prisma.systemMessage.updateMany({ where: { id, practiceId: user.practiceId }, data });
    await logAudit(user.practiceId, user.id, "UPDATE_SYSTEM_MESSAGE", "SystemMessage", id, data.title);
  }
  revalidatePath("/", "layout");
  redirect("/settings/messages?saved=1");
}

export async function deleteSystemMessage(id: string) {
  const user = await requireUser(["ADMIN"]);
  await prisma.systemMessage.deleteMany({ where: { id, practiceId: user.practiceId } });
  await logAudit(user.practiceId, user.id, "DELETE_SYSTEM_MESSAGE", "SystemMessage", id);
  revalidatePath("/", "layout");
  redirect("/settings/messages?saved=1");
}
