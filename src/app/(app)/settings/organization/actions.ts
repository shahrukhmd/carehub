"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { rolesFor } from "@/lib/permissions";
import { ONBOARDING_STEPS, ORG_STATUSES, organizationForPractice } from "@/lib/organization";

const str = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max) || null;
const int = (fd: FormData, k: string, lo: number, hi: number, dflt: number) => {
  const n = Number(fd.get(k));
  return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt;
};
function back(msg: { ok?: string; error?: string }): never {
  const q = msg.error ? `?error=${encodeURIComponent(msg.error)}` : msg.ok ? `?saved=1` : "";
  redirect(`/settings/organization${q}`);
}

async function orgForAdmin() {
  const user = await requireUser(rolesFor("settings.admin"));
  const org = await organizationForPractice(user.practiceId);
  if (!org) back({ error: "This practice is not under a client organization yet." });
  return { user, org: org! };
}

// Account details, status and commercial terms.
export async function saveOrganization(fd: FormData) {
  const { user, org } = await orgForAdmin();
  const status = String(fd.get("status") ?? org.status);
  if (!(status in ORG_STATUSES)) back({ error: "Pick a valid status." });
  const feeRaw = str(fd, "feePercent", 10);
  const feePercent = feeRaw ? Number(feeRaw.replace(/[%\s]/g, "")) : null;
  if (feePercent !== null && !(feePercent >= 0 && feePercent <= 100)) back({ error: "Fee percentage must be between 0 and 100." });
  const minRaw = str(fd, "minimumMonthly", 12);
  const minimumMonthlyCents = minRaw ? Math.round(Number(minRaw.replace(/[$,\s]/g, "")) * 100) : null;
  if (minimumMonthlyCents !== null && !(minimumMonthlyCents >= 0)) back({ error: "Minimum monthly fee must be a number." });
  const terminatedAtRaw = str(fd, "terminatedAt", 10);
  const terminatedAt = status === "TERMINATED" ? (terminatedAtRaw ? new Date(`${terminatedAtRaw}T00:00:00`) : new Date()) : null;
  const statusReason = str(fd, "statusReason", 300);
  if ((status === "ON_HOLD" || status === "TERMINATED") && !statusReason) back({ error: `Say why the account is ${status === "ON_HOLD" ? "on hold" : "terminated"}.` });

  await prisma.organization.update({
    where: { id: org.id },
    data: {
      name: str(fd, "name", 120) ?? org.name,
      legalName: str(fd, "legalName", 160),
      taxId: str(fd, "taxId", 20),
      contactName: str(fd, "contactName", 120),
      contactEmail: str(fd, "contactEmail", 160)?.toLowerCase() ?? null,
      contactPhone: str(fd, "contactPhone", 40),
      accountManager: str(fd, "accountManager", 120),
      status,
      statusReason: status === "ACTIVE" ? null : statusReason,
      terminatedAt,
      feePercent,
      minimumMonthlyCents,
      invoiceDay: int(fd, "invoiceDay", 1, 28, 1),
      notes: str(fd, "notes", 2000),
    },
  });
  if (status === "TERMINATED") {
    // Client-user sessions end now; sign-in is refused from the termination date.
    const practiceIds = (await prisma.practice.findMany({ where: { organizationId: org.id }, select: { id: true } })).map((p) => p.id);
    if (terminatedAt && terminatedAt <= new Date()) await prisma.session.deleteMany({ where: { user: { practiceId: { in: practiceIds } }, NOT: { userId: user.id } } });
  }
  if (status !== org.status) await logAudit(user.practiceId, user.id, "ORGANIZATION_STATUS", "Organization", org.id, `${org.status} -> ${status}${statusReason ? `: ${statusReason}` : ""}`);
  await logAudit(user.practiceId, user.id, "UPDATE_ORGANIZATION", "Organization", org.id, org.name);
  revalidatePath("/settings/organization");
  revalidatePath("/", "layout");
  back({ ok: "1" });
}

// The sign-in policy for everyone in the organization's practices.
export async function saveLoginPolicy(fd: FormData) {
  const { user, org } = await orgForAdmin();
  await prisma.organization.update({
    where: { id: org.id },
    data: {
      maxFailedLogins: int(fd, "maxFailedLogins", 3, 20, 5),
      lockoutMinutes: int(fd, "lockoutMinutes", 1, 1440, 15),
      passwordMaxAgeDays: int(fd, "passwordMaxAgeDays", 0, 365, 0),
      twoFactorRequired: fd.get("twoFactorRequired") === "on",
      idleTimeoutMinutes: int(fd, "idleTimeoutMinutes", 0, 720, 0),
      ipAllowlist: str(fd, "ipAllowlist", 2000),
      ipAllowlistExempt: str(fd, "ipAllowlistExempt", 2000)?.toLowerCase() ?? null,
    },
  });
  await logAudit(user.practiceId, user.id, "UPDATE_LOGIN_POLICY", "Organization", org.id);
  revalidatePath("/settings/organization");
  back({ ok: "1" });
}

// Tick the onboarding checklist; the account goes ACTIVE by itself when every step is done.
export async function saveOnboarding(fd: FormData) {
  const { user, org } = await orgForAdmin();
  const done = ONBOARDING_STEPS.map(([k]) => k).filter((k) => fd.get(`step:${k}`) === "on");
  const complete = done.length === ONBOARDING_STEPS.length;
  await prisma.organization.update({
    where: { id: org.id },
    data: { onboarding: JSON.stringify(done), ...(complete && org.status === "ONBOARDING" ? { status: "ACTIVE", statusReason: null } : {}) },
  });
  await logAudit(user.practiceId, user.id, "UPDATE_ONBOARDING", "Organization", org.id, `${done.length}/${ONBOARDING_STEPS.length} steps${complete && org.status === "ONBOARDING" ? " · account now active" : ""}`);
  revalidatePath("/settings/organization");
  back({ ok: "1" });
}

// A practice created before client organizations existed: give it one, named after the practice.
export async function createOrganization() {
  const user = await requireUser(rolesFor("settings.admin"));
  const practice = await prisma.practice.findUniqueOrThrow({ where: { id: user.practiceId }, select: { id: true, name: true, organizationId: true } });
  if (practice.organizationId) back({ ok: "1" });
  const org = await prisma.organization.create({ data: { name: practice.name, status: "ACTIVE" } });
  await prisma.practice.update({ where: { id: practice.id }, data: { organizationId: org.id } });
  await logAudit(user.practiceId, user.id, "CREATE_ORGANIZATION", "Organization", org.id, practice.name);
  revalidatePath("/settings/organization");
  back({ ok: "1" });
}

// A new practice under the same client; the admin who adds it gets access to it.
export async function addPractice(fd: FormData) {
  const { user, org } = await orgForAdmin();
  const name = str(fd, "name", 120);
  if (!name) back({ error: "Name the practice." });
  const state = str(fd, "state", 2)?.toUpperCase() ?? null;
  const locationName = str(fd, "locationName", 120) ?? "Main office";
  const city = str(fd, "city", 80);
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "practice";
  let slug = base;
  for (let n = 2; await prisma.practice.findUnique({ where: { slug } }); n++) slug = `${base}-${n}`;
  const practice = await prisma.practice.create({
    data: { name, slug, state, organizationId: org.id, locations: { create: { name: locationName, city, state } }, settings: { create: {} } },
  });
  await prisma.membership.create({ data: { userId: user.id, practiceId: practice.id, role: "ADMIN" } });
  await logAudit(user.practiceId, user.id, "ADD_PRACTICE", "Practice", practice.id, name);
  revalidatePath("/settings/organization");
  revalidatePath("/", "layout");
  back({ ok: "1" });
}
