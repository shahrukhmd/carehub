import "server-only";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CANCELLATION_REASONS, DEFAULT_VISIT_TYPES } from "@/lib/scheduler";
import { visitTypeLabel } from "@/lib/format";

// One setup run per practice, shared by concurrent callers (pages load settings and types in parallel).
const setups = new Map<string, Promise<void>>();

// Visit types, cancellation reasons and scheduler settings are created once per practice, then owned by it.
export function ensureSchedulerSetup(practiceId: string) {
  let run = setups.get(practiceId);
  if (!run) {
    run = setup(practiceId).catch((err) => {
      setups.delete(practiceId);
      throw err;
    });
    setups.set(practiceId, run);
  }
  return run;
}

async function setup(practiceId: string) {
  if ((await prisma.visitType.count({ where: { practiceId } })) === 0) {
    await prisma.visitType.createMany({
      data: DEFAULT_VISIT_TYPES.map((t, i) => ({
        practiceId,
        code: t.code,
        name: t.name,
        durationMin: t.durationMin,
        billable: t.billable ?? true,
        sortOrder: (i + 1) * 10,
      })),
    });
    // The telehealth visit types chart with the Telehealth workflow, where one exists.
    const tele = (await prisma.chartWorkflow.findMany({ where: { practiceId } })).find((w) => (w.visitTypes ?? "").split(",").includes("TELE"));
    if (tele) {
      const codes = new Set((tele.visitTypes ?? "").split(",").filter(Boolean));
      ["TELE_INIT", "TELE_EST"].forEach((c) => codes.add(c));
      await prisma.chartWorkflow.update({ where: { id: tele.id }, data: { visitTypes: [...codes].join(",") } });
    }
  }
  if ((await prisma.cancellationReason.count({ where: { practiceId } })) === 0) {
    await prisma.cancellationReason.createMany({
      data: DEFAULT_CANCELLATION_REASONS.map((name, i) => ({ practiceId, name, sortOrder: (i + 1) * 10 })),
    });
  }
  await prisma.schedulerSettings.upsert({ where: { practiceId }, update: {}, create: { practiceId } });
}

export async function getSchedulerSettings(practiceId: string) {
  await ensureSchedulerSetup(practiceId);
  return prisma.schedulerSettings.findUniqueOrThrow({ where: { practiceId } });
}

export async function getVisitTypes(practiceId: string, { includeInactive = false } = {}) {
  await ensureSchedulerSetup(practiceId);
  return prisma.visitType.findMany({
    where: { practiceId, ...(includeInactive ? {} : { active: true }) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

// code -> display name, including retired types still on old visits.
export async function visitTypeNames(practiceId: string) {
  const types = await getVisitTypes(practiceId, { includeInactive: true });
  return { ...visitTypeLabel, ...Object.fromEntries(types.map((t) => [t.code, t.name])) } as Record<string, string>;
}
