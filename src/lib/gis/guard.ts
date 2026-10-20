import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { rolesFor, type PermissionKey } from "@/lib/permissions";

// Shared by every GIS server action: a user-facing failure, and the wrapper that runs the work and returns to the
// page with ?ok= or ?error=.

export class GisError extends Error {}
// A function declaration (not an arrow) so TypeScript narrows after `if (!x) fail(...)`.
export function fail(m: string): never {
  throw new GisError(m);
}
export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const join = (b: string) => `${b}${b.includes("?") ? "&" : "?"}`;

export type Actor = Awaited<ReturnType<typeof requireUser>>;

// Runs the work, then returns to `back` with ?ok= or ?error=. A GisError is a message for the user; anything else
// is a bug and still throws. A returned path is followed instead of the message.
export async function guarded(permission: PermissionKey, back: string, work: (user: Actor) => Promise<string | void>) {
  const user = await requireUser(rolesFor(permission));
  let target = back;
  try {
    const ok = await work(user);
    if (ok && ok.startsWith("/")) target = ok;
    else if (ok) target = `${join(back)}ok=${encodeURIComponent(ok.slice(0, 200))}`;
  } catch (err) {
    if (!(err instanceof GisError)) throw err;
    target = `${join(back)}error=${encodeURIComponent(err.message.slice(0, 300))}`;
  }
  revalidatePath("/gis", "layout");
  redirect(target);
}
