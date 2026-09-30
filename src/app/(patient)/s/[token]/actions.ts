"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export async function answerSurvey(token: string, fd: FormData) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) redirect("/");
  const score = Number(fd.get("score"));
  if (Number.isInteger(score) && score >= 0 && score <= 10) {
    await prisma.surveyResponse.updateMany({
      where: { token, respondedAt: null },
      data: { score, comment: String(fd.get("comment") ?? "").trim().slice(0, 1000) || null, respondedAt: new Date() },
    });
  }
  redirect(`/s/${token}`);
}
