import "server-only";
import { prisma } from "@/lib/prisma";
import { STANDARD_TEMPLATES, STANDARD_VIEWS, STANDARD_WORKFLOWS } from "@/lib/document-catalog";
import { finalizeGaps, parseFields, type DocState, type StepInput } from "@/lib/chart-forms";

// Standard templates are added once per practice (and when the catalog grows); practices then own them.
// Workflows and documentation views are only created when a practice has none.
// One setup run per practice, shared by concurrent callers.
const setups = new Map<string, Promise<void>>();

export function ensureChartSetup(practiceId: string) {
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
  const existing = await prisma.documentTemplate.findMany({ where: { practiceId }, select: { key: true } });
  const have = new Set(existing.map((t) => t.key));
  const missing = STANDARD_TEMPLATES.map((t, i) => ({ t, i })).filter(({ t }) => !have.has(t.key));
  if (missing.length) {
    await prisma.documentTemplate.createMany({
      data: missing.map(({ t, i }) => ({
        practiceId,
        key: t.key,
        name: t.name,
        description: t.description ?? null,
        section: t.section,
        kind: t.kind,
        builtin: t.kind === "BUILTIN" ? t.key : null,
        perWound: Boolean(t.perWound),
        fields: JSON.stringify(t.fields ?? []),
        standard: true,
        signatureRequired: Boolean(t.signatureRequired),
        critical: Boolean(t.critical),
        inProgressNote: t.inProgressNote ?? t.section !== "BILLING",
        noteOrder: (i + 1) * 10,
        sortOrder: (i + 1) * 10,
      })),
    });
  }

  if ((await prisma.chartWorkflow.count({ where: { practiceId } })) === 0) {
    const templates = await prisma.documentTemplate.findMany({ where: { practiceId }, select: { id: true, key: true } });
    const byKey = new Map(templates.map((t) => [t.key, t.id]));
    for (const wf of STANDARD_WORKFLOWS) {
      await prisma.chartWorkflow.create({
        data: {
          practiceId,
          name: wf.name,
          description: wf.description,
          visitTypes: wf.visitTypes.join(","),
          isDefault: Boolean(wf.isDefault),
          steps: {
            create: wf.steps
              .filter(([key]) => byKey.has(key))
              .map(([key, required], i) => ({ templateId: byKey.get(key)!, sortOrder: (i + 1) * 10, requiredToFinalize: required })),
          },
        },
      });
    }
  }

  if ((await prisma.documentationView.count({ where: { practiceId } })) === 0) {
    await prisma.documentationView.createMany({
      data: STANDARD_VIEWS.map((v, i) => ({ practiceId, name: v.name, description: v.description, parts: JSON.stringify(v.parts), sortOrder: (i + 1) * 10 })),
    });
  }

  await prisma.practiceSettings.upsert({ where: { practiceId }, update: {}, create: { practiceId } });
}

export async function getPracticeSettings(practiceId: string) {
  return (
    (await prisma.practiceSettings.findUnique({ where: { practiceId } })) ??
    (await prisma.practiceSettings.create({ data: { practiceId } }))
  );
}

const workflowInclude = {
  steps: { include: { template: true }, orderBy: { sortOrder: "asc" as const } },
};

// The visit's own workflow, else one assigned to its visit type, else the practice default.
export async function resolveWorkflow(practiceId: string, e: { workflowId: string | null; appointment?: { visitType: string } | null }) {
  await ensureChartSetup(practiceId);
  if (e.workflowId) {
    const own = await prisma.chartWorkflow.findFirst({ where: { id: e.workflowId, practiceId }, include: workflowInclude });
    if (own) return own;
  }
  const all = await prisma.chartWorkflow.findMany({
    where: { practiceId, active: true },
    include: workflowInclude,
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  const visitType = e.appointment?.visitType;
  return (
    (visitType && all.find((w) => (w.visitTypes ?? "").split(",").includes(visitType))) ||
    all.find((w) => w.isDefault) ||
    all[0] ||
    null
  );
}

export type ResolvedWorkflow = NonNullable<Awaited<ReturnType<typeof resolveWorkflow>>>;

export function workflowSteps(wf: ResolvedWorkflow | null): (StepInput & { templateId: string; section: string; fieldCount: number })[] {
  if (!wf) return [];
  return wf.steps
    .filter((s) => s.template.active)
    .map((s) => ({
      templateId: s.templateId,
      key: s.template.key,
      name: s.template.name,
      section: s.template.section === "ADDITIONAL" ? "DOCUMENTATION" : s.template.section,
      perWound: s.template.perWound,
      kind: s.template.kind,
      signatureRequired: s.template.signatureRequired,
      critical: s.template.critical,
      required: s.requiredToFinalize,
      fieldCount: parseFields(s.template.fields).length,
    }));
}

// Finalize gate used by the "Finalize visit" action.
export async function workflowFinalizeGaps(
  practiceId: string,
  e: { id: string; workflowId: string | null; appointment: { visitType: string } | null },
  builtinDone: Record<string, boolean>,
  openWoundIds: string[]
) {
  const wf = await resolveWorkflow(practiceId, e);
  const docs = await prisma.encounterDocument.findMany({ where: { encounterId: e.id }, include: { template: { select: { key: true } } } });
  const states: DocState[] = docs.map((d) => ({ templateKey: d.template.key, woundKey: d.woundKey, status: d.status, signedAt: d.signedAt }));
  return finalizeGaps(workflowSteps(wf), states, builtinDone, openWoundIds);
}
