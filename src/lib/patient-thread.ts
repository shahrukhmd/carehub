import "server-only";
import { prisma } from "@/lib/prisma";
import { roleLabel } from "@/lib/format";
import { intakeStageLabel } from "@/lib/gateway";
import { visitStatusLabel } from "@/lib/visit-workflow";
import { rolesFor } from "@/lib/permissions";

// The patient thread: one running record per patient of what the teams said to each other and what happened to
// the patient's case, visits and claims. Team messages are stored (PatientMessage); everything else is read from
// the histories the system already keeps, so the thread shows the whole story without copying it.

// Teams a message can be addressed to (the role that team signs in with).
export const THREAD_TEAMS: Record<string, string> = {
  INTAKE: "DSS · Data support",
  VERIFICATION: "EVBV · VOB & Auth",
  SCHEDULER: "PCC · Patient care coordination",
  CLINICIAN: "Clinical team",
  CDS: "CDS · Documentation review",
  CODER: "Coding",
  BILLER: "Billing",
  CREDENTIALING: "Credentialing",
  FRONT_DESK: "Front desk",
  ADMIN: "Administrators",
};

// Everyone who works with patient records; credentialing has no patient access.
export const THREAD_ROLES = rolesFor("patients.thread");

export type ThreadItem = {
  key: string;
  at: Date;
  kind: "MESSAGE" | "CASE" | "VISIT" | "CLAIM" | "TASK";
  // Who wrote or did it, and the team they belong to.
  who: string;
  team: string | null;
  text: string;
  link: string | null;
  // Team messages only.
  message?: { id: string; toTeam: string | null; needsReply: boolean; answeredAt: Date | null; answeredBy: string | null; replyToId: string | null; authorRole: string | null };
};

const sentence = (action: string) => {
  const s = action.replaceAll("_", " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export async function loadPatientThread(practiceId: string, patientId: string, take = 300): Promise<ThreadItem[]> {
  const [messages, cases, visits, claims, tasks, members] = await Promise.all([
    prisma.patientMessage.findMany({ where: { practiceId, patientId }, orderBy: { createdAt: "desc" }, take }),
    prisma.intakeActivity.findMany({ where: { case: { practiceId, patientId } }, orderBy: { createdAt: "desc" }, take }),
    prisma.encounterEvent.findMany({ where: { encounter: { practiceId, patientId } }, orderBy: { createdAt: "desc" }, take }),
    // Claim history is long (every field edit); the thread carries the entries someone wrote a note on.
    prisma.claimEvent.findMany({ where: { claim: { practiceId, patientId }, note: { not: null } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.task.findMany({ where: { practiceId, patientId }, include: { comments: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.membership.findMany({ where: { practiceId }, select: { userId: true, role: true, user: { select: { name: true } } } }),
  ]);
  const nameOf = new Map(members.map((m) => [m.userId, m.user.name]));
  const teamOf = new Map(members.map((m) => [m.userId, THREAD_TEAMS[m.role] ?? roleLabel[m.role] ?? m.role]));
  const who = (id: string | null | undefined) => (id ? (nameOf.get(id) ?? "Staff") : "System");
  const team = (id: string | null | undefined) => (id ? (teamOf.get(id) ?? null) : null);

  const items: ThreadItem[] = [
    ...messages.map((m) => ({
      key: `m-${m.id}`,
      at: m.createdAt,
      kind: "MESSAGE" as const,
      who: who(m.authorId),
      team: m.authorRole ? (THREAD_TEAMS[m.authorRole] ?? m.authorRole) : team(m.authorId),
      text: m.body,
      link: m.link,
      message: { id: m.id, toTeam: m.toTeam, needsReply: m.needsReply, answeredAt: m.answeredAt, answeredBy: m.answeredById ? who(m.answeredById) : null, replyToId: m.replyToId, authorRole: m.authorRole },
    })),
    ...cases.map((a) => ({
      key: `c-${a.id}`,
      at: a.createdAt,
      kind: "CASE" as const,
      who: who(a.userId),
      team: team(a.userId),
      text: `${a.note ?? sentence(a.action)} (${intakeStageLabel[a.stage] ?? a.stage})`,
      link: `/gateway/${a.caseId}`,
    })),
    ...visits.map((e) => ({
      key: `v-${e.id}`,
      at: e.createdAt,
      kind: "VISIT" as const,
      who: who(e.userId),
      team: team(e.userId),
      text: `${e.fromStatus !== e.toStatus ? `${visitStatusLabel[e.toStatus] ?? e.toStatus}` : "Visit"}${e.note ? `: ${e.note}` : ""}`,
      link: `/encounters/${e.encounterId}`,
    })),
    ...claims.map((e) => ({
      key: `b-${e.id}`,
      at: e.createdAt,
      kind: "CLAIM" as const,
      who: who(e.userId),
      team: team(e.userId),
      text: `${sentence(e.action)}: ${e.note}`,
      link: `/billing/claims/${e.claimId}`,
    })),
    ...tasks.flatMap((t) => [
      {
        key: `t-${t.id}`,
        at: t.createdAt,
        kind: "TASK" as const,
        who: who(t.createdById),
        team: team(t.createdById),
        text: `Task${t.assignedRole ? ` for ${THREAD_TEAMS[t.assignedRole] ?? t.assignedRole}` : ""}: ${t.title}${t.body ? ` — ${t.body}` : ""}${t.status === "DONE" ? " (done)" : ""}`,
        link: `/tasks?open=${t.id}`,
      },
      ...t.comments.map((c) => ({ key: `tc-${c.id}`, at: c.createdAt, kind: "TASK" as const, who: who(c.userId), team: team(c.userId), text: `On “${t.title}”: ${c.body}`, link: `/tasks?open=${t.id}` })),
    ]),
  ];
  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, take);
}

// Messages addressed to a team that still wait for a reply.
export function waitingFor(items: ThreadItem[], role: string) {
  return items.filter((i) => i.message && i.message.needsReply && !i.message.answeredAt && i.message.toTeam === role);
}

export type WaitingRow = { key: string; kind: "MESSAGE" | "TASK"; patientId: string; patient: string; mrn: string; text: string; from: string; at: Date; days: number; href: string };

// Unanswered messages addressed to the user's team, and open tasks for the team or the user, on patients.
// Oldest first: the longest wait is at the top.
export async function loadWaitingForTeam(user: { id: string; practiceId: string; role: string }): Promise<WaitingRow[]> {
  const [messages, tasks, members] = await Promise.all([
    prisma.patientMessage.findMany({
      where: { practiceId: user.practiceId, toTeam: user.role, needsReply: true, answeredAt: null },
      include: { patient: { select: { firstName: true, lastName: true, mrn: true } } },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.task.findMany({
      where: { practiceId: user.practiceId, status: "OPEN", patientId: { not: null }, OR: [{ assignedToId: user.id }, { assignedToId: null, assignedRole: user.role }] },
      include: { patient: { select: { firstName: true, lastName: true, mrn: true } } },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.membership.findMany({ where: { practiceId: user.practiceId }, select: { userId: true, role: true, user: { select: { name: true } } } }),
  ]);
  const byUser = new Map(members.map((m) => [m.userId, `${m.user.name} (${THREAD_TEAMS[m.role] ?? roleLabel[m.role] ?? m.role})`]));
  const now = Date.now();
  const days = (at: Date) => Math.max(0, Math.floor((now - at.getTime()) / 86_400_000));
  const rows: WaitingRow[] = [
    ...messages.map((m) => ({
      key: `m-${m.id}`,
      kind: "MESSAGE" as const,
      patientId: m.patientId,
      patient: `${m.patient.lastName}, ${m.patient.firstName}`,
      mrn: m.patient.mrn,
      text: m.body.slice(0, 240),
      from: m.authorId ? (byUser.get(m.authorId) ?? "Staff") : "System",
      at: m.createdAt,
      days: days(m.createdAt),
      // Back to the screen it was written from, where the work is; otherwise the patient's thread.
      href: `${m.link ?? `/patients/${m.patientId}/thread`}#thread`,
    })),
    ...tasks.map((t) => ({
      key: `t-${t.id}`,
      kind: "TASK" as const,
      patientId: t.patientId!,
      patient: t.patient ? `${t.patient.lastName}, ${t.patient.firstName}` : "",
      mrn: t.patient?.mrn ?? "",
      text: `${t.title}${t.body ? ` — ${t.body.slice(0, 160)}` : ""}`,
      from: t.createdById ? (byUser.get(t.createdById) ?? "Staff") : "System",
      at: t.createdAt,
      days: days(t.createdAt),
      href: t.link ?? `/tasks?open=${t.id}`,
    })),
  ];
  return rows.sort((a, b) => a.at.getTime() - b.at.getTime());
}

// How many patients have something waiting for the user's team (the number on the side menu).
export async function waitingPatientCount(user: { id: string; practiceId: string; role: string }) {
  return new Set((await loadWaitingForTeam(user)).map((r) => r.patientId)).size;
}

// The side-menu item where a role works its patients; the waiting count is shown there.
export function teamHome(role: string) {
  if (["CLINICIAN", "CDS", "CODER"].includes(role)) return "/encounters";
  if (role === "BILLER") return "/billing";
  return "/";
}
