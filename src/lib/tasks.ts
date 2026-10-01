import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Unified work queue: staff messages, call-backs, results to review, referrals to chase, faxes to file.

export const TASK_TYPES: Record<string, string> = {
  MESSAGE: "Message",
  CALLBACK: "Call patient back",
  LAB_RESULT: "Lab result to review",
  IMAGING_RESULT: "Imaging result to review",
  REFILL: "Refill request",
  PRIOR_AUTH: "Prior authorization",
  REFERRAL: "Referral follow-up",
  DOCUMENT: "Document / fax to file",
  BILLING: "Billing question",
  GENERAL: "Task",
};

export const TASK_PRIORITIES: Record<string, string> = { LOW: "Low", NORMAL: "Normal", HIGH: "High", URGENT: "Urgent" };

// Team inboxes a task can be sent to instead of one person.
export const TASK_TEAMS: Record<string, string> = {
  FRONT_DESK: "Front desk",
  CLINICIAN: "Clinicians",
  BILLER: "Billing",
  INTAKE: "Intake / data entry",
  VERIFICATION: "Verification",
  SCHEDULER: "Scheduling",
  CDS: "Coding (CDS)",
  ADMIN: "Administrators",
};

export async function createTask(input: {
  practiceId: string;
  type: string;
  title: string;
  body?: string | null;
  patientId?: string | null;
  assignedToId?: string | null;
  assignedRole?: string | null;
  createdById?: string | null;
  priority?: string;
  dueAt?: Date | null;
  link?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
}) {
  // Don't stack duplicates for the same source (e.g. the same result arriving twice).
  if (input.sourceType && input.sourceId) {
    const open = await prisma.task.findFirst({ where: { practiceId: input.practiceId, sourceType: input.sourceType, sourceId: input.sourceId, status: "OPEN" } });
    if (open) return open;
  }
  return prisma.task.create({
    data: {
      practiceId: input.practiceId,
      type: TASK_TYPES[input.type] ? input.type : "GENERAL",
      title: input.title.slice(0, 200),
      body: input.body?.slice(0, 4000) ?? null,
      patientId: input.patientId ?? null,
      assignedToId: input.assignedToId ?? null,
      assignedRole: input.assignedToId ? null : (input.assignedRole ?? null),
      createdById: input.createdById ?? null,
      priority: TASK_PRIORITIES[input.priority ?? ""] ? input.priority! : "NORMAL",
      dueAt: input.dueAt ?? null,
      link: input.link ?? null,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
    },
  });
}

// Closes open tasks raised for a source once the work is done elsewhere (e.g. result reviewed).
export async function completeSourceTasks(practiceId: string, sourceType: string, sourceId: string, userId: string | null) {
  await prisma.task.updateMany({ where: { practiceId, sourceType, sourceId, status: "OPEN" }, data: { status: "DONE", completedAt: new Date(), completedById: userId } });
}

export function myTasksWhere(user: { id: string; practiceId: string; role: string }): Prisma.TaskWhereInput {
  return { practiceId: user.practiceId, status: "OPEN", OR: [{ assignedToId: user.id }, { assignedToId: null, assignedRole: user.role }] };
}

export async function openTaskCount(user: { id: string; practiceId: string; role: string }) {
  return prisma.task.count({ where: myTasksWhere(user) });
}
