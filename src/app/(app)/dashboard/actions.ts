"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { parseTiles, tilesFor } from "@/lib/dashboard-tiles";

// Saves the user's own set of dashboard tiles ("My view").
export async function saveDashboardTiles(fd: FormData) {
  const user = await requireUser();
  const reset = fd.get("intent") === "reset";
  const allowed = new Set(tilesFor(user).map((t) => t.key));
  const tiles = reset ? [] : parseTiles(String(fd.get("tiles") ?? "[]")).filter((k) => allowed.has(k));
  await prisma.user.update({ where: { id: user.id }, data: { dashboardTiles: tiles.length ? JSON.stringify(tiles) : null } });
  revalidatePath("/dashboard");
  redirect(tiles.length ? "/dashboard?view=custom" : "/dashboard");
}
