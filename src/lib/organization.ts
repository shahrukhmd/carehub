import "server-only";
import { prisma } from "@/lib/prisma";

// The client organization above the practices: a billing company's customer. Holds the account status and
// commercial terms, the onboarding checklist, and the login policy that applies to everyone in its practices.

export const PASSWORD_MIN = 10;
export const PASSWORD_ERRORS: Record<string, string> = {
  current: "The current password is not right.",
  weak: `Use at least ${PASSWORD_MIN} characters with letters and a number.`,
  match: "The two new passwords do not match.",
  same: "Pick a password you have not used before.",
};

export const ORG_STATUSES: Record<string, string> = {
  ONBOARDING: "Onboarding",
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  TERMINATED: "Terminated",
};

export const ONBOARDING_STEPS: [string, string][] = [
  ["practice", "Practice, sites and providers set up"],
  ["credentialing", "Provider credentialing and payer enrollment started"],
  ["clearinghouse", "Clearinghouse submitter set up"],
  ["payers", "Payer plans and billing rules entered"],
  ["migration", "Patients, coverage and open balances migrated"],
  ["sop", "Billing SOP and payer expectations on file"],
  ["golive", "First live claim submitted"],
];

export type LoginPolicy = {
  maxFailedLogins: number;
  lockoutMinutes: number;
  passwordMaxAgeDays: number;
  twoFactorRequired: boolean;
  idleTimeoutMinutes: number;
  ipAllowlist: string[];
  ipAllowlistExempt: string[];
};

const DEFAULT_POLICY: LoginPolicy = { maxFailedLogins: 5, lockoutMinutes: 15, passwordMaxAgeDays: 0, twoFactorRequired: false, idleTimeoutMinutes: 0, ipAllowlist: [], ipAllowlistExempt: [] };

const list = (v: string | null | undefined) =>
  (v ?? "")
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

export async function organizationForPractice(practiceId: string) {
  const p = await prisma.practice.findUnique({ where: { id: practiceId }, select: { organization: true } });
  return p?.organization ?? null;
}

export async function loginPolicyForUser(user: { practiceId: string }): Promise<LoginPolicy> {
  const org = await organizationForPractice(user.practiceId);
  if (!org) return DEFAULT_POLICY;
  return {
    maxFailedLogins: org.maxFailedLogins,
    lockoutMinutes: org.lockoutMinutes,
    passwordMaxAgeDays: org.passwordMaxAgeDays,
    twoFactorRequired: org.twoFactorRequired,
    idleTimeoutMinutes: org.idleTimeoutMinutes,
    ipAllowlist: list(org.ipAllowlist),
    ipAllowlistExempt: list(org.ipAllowlistExempt).map((e) => e.toLowerCase()),
  };
}

// Is the organization open for business? Returns the reason it is not, or null.
export function organizationBlock(org: { status: string; statusReason: string | null; terminatedAt: Date | null } | null): string | null {
  if (!org) return null;
  if (org.status === "TERMINATED" && (!org.terminatedAt || org.terminatedAt <= new Date())) return `This client account is terminated${org.statusReason ? `: ${org.statusReason}` : ""}.`;
  return null;
}

// Claim release and statements stop while the client is on hold (a billing-company control).
export async function organizationHold(practiceId: string): Promise<string | null> {
  const org = await organizationForPractice(practiceId);
  if (!org) return null;
  if (org.status === "ON_HOLD") return `Client account on hold${org.statusReason ? `: ${org.statusReason}` : ""} — claims and statements are not released until the hold is lifted (Settings → Organization).`;
  if (org.status === "TERMINATED") return "Client account terminated — nothing further is released.";
  return null;
}

// IP allow-list check: exact IPs or CIDR blocks (IPv4). An empty list allows everyone.
export function ipAllowed(ip: string | null, allow: string[]): boolean {
  if (allow.length === 0) return true;
  if (!ip) return false;
  const addr = ip.replace(/^::ffff:/, "");
  if (addr === "::1" || addr === "127.0.0.1") return true;
  const num = (s: string) => s.split(".").reduce((a, b) => (a << 8) + Number(b), 0) >>> 0;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(addr)) return false;
  const a = num(addr);
  return allow.some((rule) => {
    const [base, bits] = rule.split("/");
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(base)) return false;
    const mask = bits === undefined ? 32 : Number(bits);
    if (!(mask >= 0 && mask <= 32)) return false;
    const m = mask === 0 ? 0 : (0xffffffff << (32 - mask)) >>> 0;
    return (a & m) === (num(base) & m);
  });
}

export function parseOnboarding(json: string | null | undefined): Set<string> {
  try {
    const arr = JSON.parse(json ?? "[]");
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}
