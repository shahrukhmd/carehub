import "server-only";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CANCELLATION_REASONS, DEFAULT_VISIT_TYPES } from "@/lib/scheduler";
import { visitTypeLabel } from "@/lib/format";
import { packOf, parseSpecialties, specialtyWhere } from "@/lib/specialties";

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
  // Standard visit types the practice does not have yet (a fresh practice gets them all; an existing one gets
  // the ones added since, e.g. a new specialty pack). Types the practice retired stay retired.
  const have = new Set((await prisma.visitType.findMany({ where: { practiceId }, select: { code: true } })).map((t) => t.code));
  const fresh = have.size === 0;
  const missing = DEFAULT_VISIT_TYPES.map((t, i) => ({ t, i })).filter(({ t }) => !have.has(t.code));
  if (missing.length) {
    await prisma.visitType.createMany({
      data: missing.map(({ t, i }) => ({
        practiceId,
        code: t.code,
        name: t.name,
        durationMin: t.durationMin,
        billable: t.billable ?? true,
        specialty: packOf("visitType", t.code),
        sortOrder: (i + 1) * 10,
      })),
    });
  }
  if (fresh) {
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

// Active types of the specialty packs that are on (for pickers); includeInactive lists everything (for Settings).
export async function getVisitTypes(practiceId: string, { includeInactive = false } = {}) {
  await ensureSchedulerSetup(practiceId);
  const packs = includeInactive ? null : parseSpecialties((await prisma.practiceSettings.findUnique({ where: { practiceId }, select: { specialties: true } }))?.specialties);
  return prisma.visitType.findMany({
    where: { practiceId, ...(includeInactive ? {} : { active: true, ...specialtyWhere(packs!) }) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

// code -> display name, including retired types still on old visits.
export async function visitTypeNames(practiceId: string) {
  const types = await getVisitTypes(practiceId, { includeInactive: true });
  return { ...visitTypeLabel, ...Object.fromEntries(types.map((t) => [t.code, t.name])) } as Record<string, string>;
}
