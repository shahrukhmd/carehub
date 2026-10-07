import "server-only";
import { prisma } from "@/lib/prisma";
import { OPEN_AR_STATUSES } from "@/lib/claim-format";

// Patient sticky alerts: a short message that shows wherever the patient is opened, in the places the alert
// was given (chart, booking, check-in, billing), during its date range. STOP alerts must be acknowledged before
// booking or check-in goes ahead. Some alerts are computed from the record (balance, authorization) and are
// never stored.

export const ALERT_PLACEMENTS: [string, string][] = [
  ["chart", "Patient chart"],
  ["schedule", "Booking"],
  ["checkin", "Check-in (flow board)"],
  ["billing", "Claims and billing"],
];

export const ALERT_SEVERITIES: Record<string, string> = { INFO: "Info", WARNING: "Warning", STOP: "Stop — must be acknowledged" };

// Each type carries a default severity and placement that the user can change.
export const ALERT_TYPES: Record<string, { label: string; severity: string; showOn: string[] }> = {
  BALANCE: { label: "Collect balance", severity: "WARNING", showOn: ["schedule", "checkin", "billing"] },
  INSURANCE: { label: "Insurance card / coverage", severity: "WARNING", showOn: ["schedule", "checkin", "billing"] },
  AUTH: { label: "Authorization", severity: "WARNING", showOn: ["schedule", "checkin", "chart", "billing"] },
  SCHEDULING: { label: "Scheduling note", severity: "INFO", showOn: ["schedule"] },
  SAFETY: { label: "Safety", severity: "STOP", showOn: ["chart", "schedule", "checkin"] },
  INTERPRETER: { label: "Interpreter / accessibility", severity: "INFO", showOn: ["schedule", "checkin", "chart"] },
  CONSENT: { label: "Consent or form needed", severity: "WARNING", showOn: ["checkin", "chart"] },
  MAIL: { label: "Returned mail / bad contact", severity: "WARNING", showOn: ["schedule", "checkin", "billing"] },
  OTHER: { label: "Other", severity: "INFO", showOn: ["chart"] },
};

export type Placement = "chart" | "schedule" | "checkin" | "billing";

export type AlertView = {
  id: string | null; // null for computed alerts
  type: string;
  severity: string;
  message: string;
  showOn: string[];
  activeTo: Date | null;
  assignedTo: string | null;
  createdBy: string | null;
  createdAt: Date | null;
  computed: boolean;
  acknowledged: boolean;
};

const today = () => new Date(new Date().toISOString().slice(0, 10));

export function parseShowOn(csv: string | null | undefined): string[] {
  const all = ALERT_PLACEMENTS.map(([k]) => k);
  return (csv ?? "").split(",").map((s) => s.trim()).filter((s) => all.includes(s));
}

// Stored alerts that are active today, with whether this user acknowledged each one (today).
export async function storedAlerts(practiceId: string, patientId: string, userId?: string | null): Promise<AlertView[]> {
  const now = today();
  const rows = await prisma.patientAlert.findMany({
    where: { practiceId, patientId, status: "ACTIVE", activeFrom: { lte: new Date(now.getTime() + 86_400_000) }, OR: [{ activeTo: null }, { activeTo: { gte: now } }] },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    include: { assignedTo: { select: { name: true } }, createdBy: { select: { name: true } }, acknowledgements: userId ? { where: { userId, createdAt: { gte: new Date(Date.now() - 86_400_000) } }, select: { id: true } } : false },
  });
  return rows.map((a) => ({
    id: a.id,
    type: a.type,
    severity: a.severity,
    message: a.message,
    showOn: parseShowOn(a.showOn),
    activeTo: a.activeTo,
    assignedTo: a.assignedTo?.name ?? null,
    createdBy: a.createdBy?.name ?? null,
    createdAt: a.createdAt,
    computed: false,
    acknowledged: Array.isArray(a.acknowledgements) ? a.acknowledgements.length > 0 : false,
  }));
}

// Alerts computed from the record each time: a patient balance over the practice's threshold, an authorization
// about to run out, coverage that has ended. Never stored, never acknowledged.
export async function computedAlerts(practiceId: string, patientId: string): Promise<AlertView[]> {
  const [settings, claims, auths, coverage] = await Promise.all([
    prisma.practiceSettings.findUnique({ where: { practiceId }, select: { alertBalanceCents: true } }),
    prisma.claim.findMany({ where: { practiceId, patientId, balanceResponsibility: "PATIENT", status: { in: OPEN_AR_STATUSES } }, select: { billedCents: true, paidCents: true, adjustedCents: true } }),
    prisma.insuranceAuthorization.findMany({ where: { practiceId, patientId, endDate: { gte: new Date(Date.now() - 86_400_000) } }, select: { authNumber: true, endDate: true, authorizedCount: true, kind: true, procedureCode: true } }),
    prisma.insurance.findMany({ where: { patientId, active: true, terminationDate: { not: null, lt: new Date() } }, select: { payer: { select: { name: true } }, terminationDate: true } }),
  ]);
  const out: AlertView[] = [];
  const balance = claims.reduce((s, c) => s + Math.max(0, c.billedCents - c.paidCents - c.adjustedCents), 0);
  const threshold = settings?.alertBalanceCents ?? 10_000;
  if (threshold > 0 && balance >= threshold) {
    out.push({ id: null, type: "BALANCE", severity: "WARNING", message: `Patient balance ${(balance / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} — collect or set up a payment plan.`, showOn: ["schedule", "checkin", "billing"], activeTo: null, assignedTo: null, createdBy: "Rule", createdAt: null, computed: true, acknowledged: true });
  }
  for (const a of auths) {
    const days = a.endDate ? Math.ceil((a.endDate.getTime() - Date.now()) / 86_400_000) : null;
    if (days !== null && days <= 14) {
      out.push({ id: null, type: "AUTH", severity: "WARNING", message: `Authorization ${a.authNumber ?? ""}${a.procedureCode ? ` (${a.procedureCode})` : ""} ends ${days <= 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`} — renew it before the next visit.`, showOn: ["schedule", "checkin", "chart", "billing"], activeTo: a.endDate, assignedTo: null, createdBy: "Rule", createdAt: null, computed: true, acknowledged: true });
    }
  }
  for (const c of coverage) {
    out.push({ id: null, type: "INSURANCE", severity: "WARNING", message: `${c.payer.name} coverage ended ${c.terminationDate!.toISOString().slice(0, 10)} but is still marked active — update the insurance.`, showOn: ["schedule", "checkin", "billing"], activeTo: null, assignedTo: null, createdBy: "Rule", createdAt: null, computed: true, acknowledged: true });
  }
  return out;
}

export async function alertsFor(practiceId: string, patientId: string, placement: Placement | null, userId?: string | null): Promise<AlertView[]> {
  const [stored, computed] = await Promise.all([storedAlerts(practiceId, patientId, userId), computedAlerts(practiceId, patientId)]);
  const all = [...stored, ...computed];
  return placement ? all.filter((a) => a.showOn.includes(placement)) : all;
}

// A STOP alert for this placement that this user has not acknowledged today blocks the step.
export async function stopBlock(practiceId: string, patientId: string, placement: Placement, userId: string): Promise<string | null> {
  const stops = (await storedAlerts(practiceId, patientId, userId)).filter((a) => a.severity === "STOP" && a.showOn.includes(placement) && !a.acknowledged);
  if (stops.length === 0) return null;
  return `Patient alert must be acknowledged first: "${stops[0].message}"${stops.length > 1 ? ` (+${stops.length - 1} more)` : ""}.`;
}

// For boards that list many patients: the highest severity active alert per patient.
export async function alertMarks(practiceId: string, patientIds: string[]): Promise<Map<string, { severity: string; count: number }>> {
  if (patientIds.length === 0) return new Map();
  const now = today();
  const rows = await prisma.patientAlert.findMany({
    where: { practiceId, patientId: { in: patientIds }, status: "ACTIVE", OR: [{ activeTo: null }, { activeTo: { gte: now } }] },
    select: { patientId: true, severity: true },
  });
  const rank: Record<string, number> = { INFO: 1, WARNING: 2, STOP: 3 };
  const out = new Map<string, { severity: string; count: number }>();
  for (const r of rows) {
    const cur = out.get(r.patientId);
    if (!cur) out.set(r.patientId, { severity: r.severity, count: 1 });
    else out.set(r.patientId, { severity: rank[r.severity] > rank[cur.severity] ? r.severity : cur.severity, count: cur.count + 1 });
  }
  return out;
}

// Expired alerts close by themselves (run with the other automations).
export async function expireAlerts(practiceId?: string) {
  const r = await prisma.patientAlert.updateMany({ where: { ...(practiceId ? { practiceId } : {}), status: "ACTIVE", activeTo: { lt: today() } }, data: { status: "EXPIRED" } });
  return r.count;
}
