import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { rolesFor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { completeSourceTasks, createTask } from "@/lib/tasks";
import type { DocValues, FieldDef } from "@/lib/chart-forms";

// UltraMist (ultrasonic mist debridement) tracker. One UltramistOrder per course of therapy; the UM status and prior
// authorization live on the order, the visit counts and dates are worked out from the patient's MIST appointments.

export const ULTRAMIST_ROLES = rolesFor("ultramist.work");
export const ULTRAMIST_EDIT_ROLES = rolesFor("ultramist.edit");

// Scheduler visit types that count as a UM treatment.
export const MIST_VISIT_TYPES = ["PROV_MIST", "NPWCN_MIST", "NON_PROVIDER"];
// The flag the RCM team watches: a course past this many treatments needs a second look.
export const UM_VISIT_LIMIT = 18;
// Terminal orders are archived this many days after completion.
export const UM_ARCHIVE_DAYS = 7;

export type UmStatusDef = { key: string; label: string; tone: string; terminal?: boolean; needsReason?: boolean };

export const UM_STATUSES: UmStatusDef[] = [
  { key: "RCM_CHECK_NEEDED", label: "RCM check needed", tone: "#9aa3ad" },
  { key: "ELIGIBLE", label: "Eligible for UM", tone: "#7cb342" },
  { key: "READY_TO_SCHEDULE", label: "Ready to schedule (RCM)", tone: "#f4a53a" },
  { key: "SCHEDULED", label: "Scheduled for UM", tone: "#1fa971" },
  { key: "HOLD", label: "Hold", tone: "#e05aa7", needsReason: true },
  { key: "NOT_ELIGIBLE", label: "Not eligible for UM", tone: "#d9434f", terminal: true, needsReason: true },
  { key: "ORDER_CANCELLED", label: "Order cancelled", tone: "#6b7280", terminal: true, needsReason: true },
  { key: "DENIED", label: "Denied", tone: "#e0007f", terminal: true, needsReason: true },
  { key: "COMPLETED", label: "UM course completed", tone: "#b5a230", terminal: true },
];

export const umStatusLabel: Record<string, string> = Object.fromEntries(UM_STATUSES.map((s) => [s.key, s.label]));
export const umStatusTone: Record<string, string> = Object.fromEntries(UM_STATUSES.map((s) => [s.key, s.tone]));
export const TERMINAL_UM_STATUSES = UM_STATUSES.filter((s) => s.terminal).map((s) => s.key);
export const OPEN_UM_STATUSES = UM_STATUSES.filter((s) => !s.terminal).map((s) => s.key);
export const umStatusNeedsReason = (key: string) => UM_STATUSES.find((s) => s.key === key)?.needsReason === true;

export const PRIOR_AUTH_STATUSES: { key: string; label: string; tone: string }[] = [
  { key: "APPROVED", label: "UM approved", tone: "#1fa971" },
  { key: "IN_PROCESS", label: "UM in process", tone: "#f4a53a" },
  { key: "DENIED", label: "UM denied", tone: "#d9434f" },
  { key: "NOT_REQUIRED", label: "UM not required", tone: "#6aa9c9" },
  { key: "NOT_COVERED", label: "UM not covered", tone: "#8b5cf6" },
];
export const priorAuthLabel: Record<string, string> = Object.fromEntries(PRIOR_AUTH_STATUSES.map((s) => [s.key, s.label]));
export const priorAuthTone: Record<string, string> = Object.fromEntries(PRIOR_AUTH_STATUSES.map((s) => [s.key, s.tone]));

// The standard orders on the Physician Orders document and the treatments they allow.
export const SERIES_PLANS: { label: string; visits: number }[] = [
  { label: "2x/week x 3 weeks or 6 treatments (whichever comes first)", visits: 6 },
  { label: "3x/week x 2 weeks or 6 treatments (whichever comes first)", visits: 6 },
  { label: "2-3x/week for 6 weeks", visits: 18 },
];

export const ULTRAMIST_VIEWS: [string, string][] = [
  ["open", "Open orders"],
  ["rcm", "RCM check needed"],
  ["auth", "Prior auth in process"],
  ["ready", "Ready to schedule"],
  ["scheduled", "Scheduled / in course"],
  ["flagged", "Over 18 visits"],
  ["completed", "Completed & closed"],
  ["archived", "Archived"],
];

export function viewWhere(view: string): Prisma.UltramistOrderWhereInput {
  switch (view) {
    case "rcm":
      return { isArchived: false, umStatus: "RCM_CHECK_NEEDED" };
    case "auth":
      return { isArchived: false, priorAuthStatus: "IN_PROCESS" };
    case "ready":
      return { isArchived: false, umStatus: { in: ["ELIGIBLE", "READY_TO_SCHEDULE"] } };
    case "scheduled":
      return { isArchived: false, umStatus: "SCHEDULED" };
    case "flagged":
      return { isArchived: false, greaterThan18VisitFlag: true };
    case "completed":
      return { isArchived: false, umStatus: { in: TERMINAL_UM_STATUSES } };
    case "archived":
      return { isArchived: true };
    default:
      return { isArchived: false, umStatus: { in: OPEN_UM_STATUSES } };
  }
}

// ---- Counts from the scheduler -------------------------------------------------------------------------------

type ApptLite = { patientId: string; visitType: string; status: string; startsAt: Date; hasEncounter: boolean };

export type UmCounts = {
  made: number;
  sinceProvider: number;
  lastSeenByProvider: Date | null;
  nextUm: Date | null;
  flag: boolean;
};

const UPCOMING = ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_ROOM"];

// Treatments made: MIST visits that happened (completed, or charted) on or after the order date. "Since last provider
// visit" counts the ones after the latest completed provider visit (any billable, non-"Non-Provider" visit type).
export function countsFrom(appts: ApptLite[], billable: Map<string, boolean>, dateOrdered: Date | null, now = new Date()): UmCounts {
  const happened = (a: ApptLite) => a.startsAt <= now && (a.status === "COMPLETED" || a.hasEncounter);
  const mistDone = appts.filter((a) => MIST_VISIT_TYPES.includes(a.visitType) && happened(a) && (!dateOrdered || a.startsAt >= dateOrdered));
  const providerDone = appts.filter((a) => a.visitType !== "NON_PROVIDER" && billable.get(a.visitType) !== false && happened(a));
  const lastSeen = providerDone.reduce<Date | null>((m, a) => (!m || a.startsAt > m ? a.startsAt : m), null);
  const sinceProvider = lastSeen ? mistDone.filter((a) => a.startsAt > lastSeen).length : mistDone.length;
  const upcoming = appts.filter((a) => MIST_VISIT_TYPES.includes(a.visitType) && UPCOMING.includes(a.status) && a.startsAt >= now);
  const nextUm = upcoming.reduce<Date | null>((m, a) => (!m || a.startsAt < m ? a.startsAt : m), null);
  return { made: mistDone.length, sinceProvider, lastSeenByProvider: lastSeen, nextUm, flag: mistDone.length > UM_VISIT_LIMIT };
}

async function loadAppointments(practiceId: string, patientIds: string[]) {
  if (patientIds.length === 0) return { appts: [] as ApptLite[], billable: new Map<string, boolean>() };
  const [rows, types] = await Promise.all([
    prisma.appointment.findMany({
      where: { practiceId, patientId: { in: patientIds }, status: { notIn: ["CANCELLED", "NO_SHOW", "REQUESTED"] } },
      select: { patientId: true, visitType: true, status: true, startsAt: true, encounter: { select: { id: true } } },
    }),
    prisma.visitType.findMany({ where: { practiceId }, select: { code: true, billable: true } }),
  ]);
  return {
    appts: rows.map((r) => ({ patientId: r.patientId, visitType: r.visitType, status: r.status, startsAt: r.startsAt, hasEncounter: Boolean(r.encounter) })),
    billable: new Map(types.map((t) => [t.code, t.billable])),
  };
}

function snapshot(c: UmCounts) {
  return {
    numberOfMadeUmAppointments: c.made,
    umAppointmentsSinceLastProviderVisit: c.sinceProvider,
    dateLastSeenByProvider: c.lastSeenByProvider,
    dateOfNextUm: c.nextUm,
    greaterThan18VisitFlag: c.flag,
    countsRefreshedAt: new Date(),
  };
}

// Recomputes and stores the counts for a set of orders (every open order of the practice when none are given).
export async function refreshUmCounts(practiceId: string, orderIds?: string[]) {
  const orders = await prisma.ultramistOrder.findMany({
    where: { practiceId, ...(orderIds ? { id: { in: orderIds } } : { isArchived: false, umStatus: { in: OPEN_UM_STATUSES } }) },
    select: { id: true, patientId: true, dateOrdered: true, numberOfMadeUmAppointments: true, umAppointmentsSinceLastProviderVisit: true, dateLastSeenByProvider: true, dateOfNextUm: true, greaterThan18VisitFlag: true },
    take: 2000,
  });
  const { appts, billable } = await loadAppointments(practiceId, [...new Set(orders.map((o) => o.patientId))]);
  const byPatient = new Map<string, ApptLite[]>();
  for (const a of appts) byPatient.set(a.patientId, [...(byPatient.get(a.patientId) ?? []), a]);
  let changed = 0;
  for (const o of orders) {
    const c = countsFrom(byPatient.get(o.patientId) ?? [], billable, o.dateOrdered);
    const same =
      c.made === o.numberOfMadeUmAppointments &&
      c.sinceProvider === o.umAppointmentsSinceLastProviderVisit &&
      (c.lastSeenByProvider?.getTime() ?? null) === (o.dateLastSeenByProvider?.getTime() ?? null) &&
      (c.nextUm?.getTime() ?? null) === (o.dateOfNextUm?.getTime() ?? null) &&
      c.flag === o.greaterThan18VisitFlag;
    if (same) continue;
    await prisma.ultramistOrder.update({ where: { id: o.id }, data: snapshot(c) });
    changed++;
  }
  return changed;
}

// ---- Status changes -----------------------------------------------------------------------------------------

export async function setUmStatus(orderId: string, practiceId: string, status: string, userId: string | null, reason?: string | null) {
  if (!umStatusLabel[status]) throw new Error("Unknown UM status.");
  const order = await prisma.ultramistOrder.findFirst({ where: { id: orderId, practiceId } });
  if (!order) throw new Error("UltraMist order not found.");
  if (order.umStatus === status) return order;
  const terminal = TERMINAL_UM_STATUSES.includes(status);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const updated = await prisma.ultramistOrder.update({
    where: { id: order.id },
    data: {
      umStatus: status,
      dateCompleted: terminal ? (order.dateCompleted ?? today) : null,
      unableToSeeReason: umStatusNeedsReason(status) ? (reason?.trim() || order.unableToSeeReason) : status === "SCHEDULED" || status === "ELIGIBLE" ? null : order.unableToSeeReason,
      updatedById: userId,
    },
  });
  if (status !== "RCM_CHECK_NEEDED") await completeSourceTasks(practiceId, "ULTRAMIST_RCM", order.id, userId);
  if (terminal) {
    await completeSourceTasks(practiceId, "ULTRAMIST_18", order.id, userId);
    await completeSourceTasks(practiceId, "ULTRAMIST_PLAN", order.id, userId);
  }
  await logAudit(practiceId, userId, "ULTRAMIST_STATUS", "UltramistOrder", order.id, `${umStatusLabel[order.umStatus] ?? order.umStatus} → ${umStatusLabel[status]}${reason ? ` · ${reason.slice(0, 200)}` : ""}`);
  return updated;
}

// ---- Physician Orders hook ----------------------------------------------------------------------------------

const plannedVisitsOf = (plan: string) => {
  const m = plan.match(/total of (\d+)/i) ?? plan.match(/(\d+)\s*treatments/i);
  if (m) return Number(m[1]);
  const weeks = plan.match(/for (\d+) weeks/i);
  const perWeek = plan.match(/(\d+)\s*-\s*(\d+)x\/week/i);
  if (weeks && perWeek) return Number(perWeek[2]) * Number(weeks[1]);
  return null;
};

// Called after a Physician Orders document is saved: a ticked Ultrasound Mist order opens (or re-orders) the
// patient's UM tracker; "Discontinue" closes it. Other documents and documents without a MIST section do nothing.
export async function applyPhysicianOrdersUltramist(input: { encounterId: string; practiceId: string; userId: string; templateKey: string; fields: FieldDef[]; values: DocValues }) {
  if (!input.templateKey.startsWith("physician_orders")) return;
  const field = input.fields.find((f) => f.type === "checkboxes" && /ultrasound mist treatment order/i.test(f.label));
  if (!field) return;
  const raw = input.values[field.id];
  const chosen = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((v) => String(v).trim()).filter(Boolean);
  if (chosen.length === 0) return;
  const e = await prisma.encounter.findFirst({ where: { id: input.encounterId, practiceId: input.practiceId }, include: { provider: { select: { id: true, name: true } } } });
  if (!e) return;
  const open = await prisma.ultramistOrder.findFirst({
    where: { practiceId: input.practiceId, patientId: e.patientId, isArchived: false, umStatus: { in: OPEN_UM_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
  const stamp = new Date().toLocaleDateString("en-US");
  if (chosen.some((o) => /discontinue/i.test(o))) {
    if (open) {
      await setUmStatus(open.id, input.practiceId, "ORDER_CANCELLED", input.userId, `Discontinued on the Physician Orders of ${stamp}`);
      await prisma.ultramistOrder.update({ where: { id: open.id }, data: { notes: [open.notes, `${stamp}: discontinued by ${e.provider.name} (Physician Orders)`].filter(Boolean).join("\n").slice(-4000) } });
    }
    return;
  }
  const plans = chosen.filter((o) => /to be performed/i.test(o));
  if (plans.length === 0) return;
  const plan = plans[0].replace(/^Ultrasound Mist Therapy to be performed\s*/i, "");
  const necessity = chosen.filter((o) => !/to be performed/i.test(o)).join("\n");
  const base = {
    encounterId: e.id,
    orderingProviderId: e.provider.id,
    orderingPhysician: e.provider.name,
    dateOrdered: e.date,
    seriesPlan: plan.slice(0, 300),
    plannedVisits: plannedVisitsOf(plan),
    updatedById: input.userId,
  };
  if (open) {
    // The same document saved again keeps the order; a later visit's order re-orders the course on the open row.
    const reordered = open.encounterId !== e.id;
    await prisma.ultramistOrder.update({
      where: { id: open.id },
      data: {
        ...base,
        notesOnMedicalNecessity: necessity || open.notesOnMedicalNecessity,
        ...(reordered ? { notes: [open.notes, `${stamp}: re-ordered by ${e.provider.name} — ${plan}`].filter(Boolean).join("\n").slice(-4000) } : {}),
      },
    });
    if (reordered) await logAudit(input.practiceId, input.userId, "ULTRAMIST_REORDER", "UltramistOrder", open.id, plan);
    return;
  }
  const order = await prisma.ultramistOrder.create({
    data: { practiceId: input.practiceId, patientId: e.patientId, ...base, notesOnMedicalNecessity: necessity || null, createdById: input.userId },
  });
  await refreshUmCounts(input.practiceId, [order.id]);
  await createTask({
    practiceId: input.practiceId,
    type: "PRIOR_AUTH",
    title: "UltraMist order needs an RCM check",
    body: `${e.provider.name} ordered ultrasound mist therapy: ${plan}. Check eligibility and prior authorization, then set the UM status.`,
    patientId: e.patientId,
    assignedRole: "VERIFICATION",
    createdById: input.userId,
    link: `/ultramist/${order.id}`,
    sourceType: "ULTRAMIST_RCM",
    sourceId: order.id,
  });
  await logAudit(input.practiceId, input.userId, "ULTRAMIST_ORDER", "UltramistOrder", order.id, plan);
}

// ---- Nightly job ---------------------------------------------------------------------------------------------

// Refreshes every open order's counts, raises tasks for courses past the planned treatments or the 18-visit limit,
// and archives closed orders a week after completion.
export async function runUltramistJob() {
  const practices = await prisma.practice.findMany({ where: { ultramistOrders: { some: {} } }, select: { id: true } });
  let refreshed = 0;
  let tasks = 0;
  for (const p of practices) {
    refreshed += await refreshUmCounts(p.id);
    const open = await prisma.ultramistOrder.findMany({
      where: { practiceId: p.id, isArchived: false, umStatus: { in: OPEN_UM_STATUSES } },
      include: { patient: { select: { firstName: true, lastName: true } } },
    });
    for (const o of open) {
      const who = `${o.patient.lastName}, ${o.patient.firstName}`;
      if (o.greaterThan18VisitFlag) {
        const t = await createTask({
          practiceId: p.id,
          type: "PRIOR_AUTH",
          title: `UltraMist: ${who} is past ${UM_VISIT_LIMIT} treatments`,
          body: `${o.numberOfMadeUmAppointments} UM treatments made. Review medical necessity and the authorization before the next visit.`,
          patientId: o.patientId,
          assignedToId: o.assignedToId,
          assignedRole: "VERIFICATION",
          priority: "HIGH",
          link: `/ultramist/${o.id}`,
          sourceType: "ULTRAMIST_18",
          sourceId: o.id,
        });
        if (t.createdAt.getTime() > Date.now() - 60_000) tasks++;
      }
      if (o.plannedVisits && o.numberOfMadeUmAppointments >= o.plannedVisits) {
        const t = await createTask({
          practiceId: p.id,
          type: "GENERAL",
          title: `UltraMist: ${who} reached the ordered treatments`,
          body: `${o.numberOfMadeUmAppointments} of ${o.plannedVisits} treatments made (${o.seriesPlan ?? "series"}). Close the course or get a new order from the provider.`,
          patientId: o.patientId,
          assignedToId: o.assignedToId,
          assignedRole: "SCHEDULER",
          link: `/ultramist/${o.id}`,
          sourceType: "ULTRAMIST_PLAN",
          sourceId: o.id,
        });
        if (t.createdAt.getTime() > Date.now() - 60_000) tasks++;
      }
    }
  }
  const cutoff = new Date(Date.now() - UM_ARCHIVE_DAYS * 86_400_000);
  const archived = await prisma.ultramistOrder.updateMany({
    where: { isArchived: false, umStatus: { in: TERMINAL_UM_STATUSES }, dateCompleted: { not: null, lte: cutoff } },
    data: { isArchived: true, archivedAt: new Date() },
  });
  return `${refreshed} counts refreshed · ${tasks} tasks raised · ${archived.count} archived`;
}
