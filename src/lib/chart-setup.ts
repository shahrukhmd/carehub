import "server-only";
import { prisma } from "@/lib/prisma";
import { REVISED_TEMPLATES, STANDARD_TEMPLATES, STANDARD_VIEWS, STANDARD_WORKFLOWS } from "@/lib/document-catalog";
import { PATIENT_TEMPLATES } from "@/lib/connect/patient-forms";
import { finalizeGaps, parseFields, type DocState, type StepInput } from "@/lib/chart-forms";
import { packOf, parseSpecialties, specialtyWhere } from "@/lib/specialties";

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
  const missing = [...STANDARD_TEMPLATES, ...PATIENT_TEMPLATES].map((t, i) => ({ t, i })).filter(({ t }) => !have.has(t.key));
  if (missing.length) {
    await prisma.documentTemplate.createMany({
      data: missing.map(({ t, i }) => ({
        practiceId,
        key: t.key,
        name: t.name,
        description: t.description ?? null,
        section: t.section,
        kind: t.kind,
        audience: t.audience ?? "STAFF",
        builtin: t.kind === "BUILTIN" ? t.key : null,
        perWound: Boolean(t.perWound),
        fields: JSON.stringify(t.fields ?? []),
        standard: true,
        specialty: packOf("template", t.key),
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
          specialty: packOf("workflow", wf.name),
          steps: {
            create: wf.steps
              .filter(([key]) => byKey.has(key))
              .map(([key, required], i) => ({ templateId: byKey.get(key)!, sortOrder: (i + 1) * 10, requiredToFinalize: required })),
          },
        },
      });
    }
  }

  await reviseTemplates(practiceId);
  await reviseWorkflows(practiceId);

  // Standard views a practice doesn't have yet are added by name; its own views are left alone.
  const views = new Set((await prisma.documentationView.findMany({ where: { practiceId }, select: { name: true } })).map((v) => v.name));
  const newViews = STANDARD_VIEWS.map((v, i) => ({ v, i })).filter(({ v }) => !views.has(v.name) && (views.size === 0 || v.name === "Visit Report"));
  if (newViews.length) {
    await prisma.documentationView.createMany({
      data: newViews.map(({ v, i }) => ({ practiceId, name: v.name, description: v.description, parts: JSON.stringify(v.parts), sortOrder: (i + 1) * 10 })),
    });
  }

  await prisma.practiceSettings.upsert({ where: { practiceId }, update: {}, create: { practiceId } });
}

// Standard workflows. One a practice does not have yet (by name) is added, and the visit types it charts are taken
// off the practice's other workflows so the new one is the one used. One whose steps changed in the catalog is
// updated only if the practice still has exactly the steps it shipped with; an edited workflow is left alone.
async function reviseWorkflows(practiceId: string) {
  const templates = await prisma.documentTemplate.findMany({ where: { practiceId }, select: { id: true, key: true } });
  // A layout that was revised lives on as "<key>_v2", "<key>_v3"...; a standard workflow uses the newest copy.
  const baseOf = (key: string) => key.replace(/_v\d+$/, "");
  const versionOf = (key: string) => Number(key.match(/_v(\d+)$/)?.[1] ?? 1);
  const byKey = new Map<string, string>();
  for (const t of [...templates].sort((x, y) => versionOf(x.key) - versionOf(y.key))) byKey.set(baseOf(t.key), t.id);
  const stepsOf = (wf: (typeof STANDARD_WORKFLOWS)[number]) =>
    wf.steps.filter(([key]) => byKey.has(key)).map(([key, required], i) => ({ templateId: byKey.get(key)!, sortOrder: (i + 1) * 10, requiredToFinalize: required }));

  for (const wf of STANDARD_WORKFLOWS) {
    const current = await prisma.chartWorkflow.findFirst({
      where: { practiceId, name: wf.name },
      include: { steps: { orderBy: { sortOrder: "asc" }, include: { template: { select: { key: true } } } } },
    });
    if (!current) {
      const others = await prisma.chartWorkflow.findMany({ where: { practiceId } });
      for (const o of others) {
        const kept = (o.visitTypes ?? "").split(",").filter((v) => v && !wf.visitTypes.includes(v));
        if (kept.join(",") !== (o.visitTypes ?? "")) await prisma.chartWorkflow.update({ where: { id: o.id }, data: { visitTypes: kept.join(",") } });
      }
      await prisma.chartWorkflow.create({ data: { practiceId, name: wf.name, description: wf.description, visitTypes: wf.visitTypes.join(","), specialty: packOf("workflow", wf.name), steps: { create: stepsOf(wf) } } });
      continue;
    }
    if (!wf.previousSteps?.length) continue;
    const keys = current.steps.map((s) => baseOf(s.template.key)).join(",");
    if (!wf.previousSteps.some((old) => old.join(",") === keys)) continue;
    await prisma.$transaction([
      prisma.chartWorkflowStep.deleteMany({ where: { workflowId: current.id } }),
      prisma.chartWorkflow.update({ where: { id: current.id }, data: { description: wf.description, steps: { create: stepsOf(wf) } } }),
    ]);
  }
}

// Standard layouts that changed in the catalog. The practice's newest copy of the layout (the original, or a
// "(new layout)" copy added by an earlier change) takes the new fields in place if it was never edited and never
// documented with. Otherwise it is kept as it is, and the new layout is added beside it, so nothing already
// charted changes meaning.
async function reviseTemplates(practiceId: string) {
  for (const key of REVISED_TEMPLATES) {
    const latest = STANDARD_TEMPLATES.find((t) => t.key === key);
    if (!latest) continue;
    const fields = JSON.stringify(latest.fields ?? []);
    const copies = await prisma.documentTemplate.findMany({
      where: { practiceId, OR: [{ key }, { key: { startsWith: `${key}_v` } }] },
      include: { _count: { select: { documents: true } } },
    });
    const versionOf = (k: string) => (k === key ? 1 : Number(k.slice(key.length + 2)) || 0);
    const ordered = copies.filter((c) => versionOf(c.key) > 0).sort((a, b) => versionOf(a.key) - versionOf(b.key));
    const current = ordered[ordered.length - 1];
    const original = ordered[0];
    if (!current || !original || ordered.some((c) => c.fields === fields)) continue;
    if (current.standard && current.version === 1 && current._count.documents === 0) {
      await prisma.documentTemplate.update({
        where: { id: current.id },
        data: { fields, section: latest.section, perWound: Boolean(latest.perWound), signatureRequired: Boolean(latest.signatureRequired), ...(current.key === key ? { name: latest.name } : {}) },
      });
      continue;
    }
    const next = versionOf(current.key) + 1;
    await prisma.documentTemplate.create({
      data: {
        practiceId,
        key: `${key}_v${next}`,
        name: `${latest.name} (new layout${next > 2 ? ` ${next - 1}` : ""})`,
        description: latest.description ?? null,
        section: latest.section,
        kind: "FORM",
        perWound: Boolean(latest.perWound),
        fields,
        standard: true,
        signatureRequired: Boolean(latest.signatureRequired),
        inProgressNote: original.inProgressNote,
        noteOrder: current.noteOrder + 1,
        sortOrder: current.sortOrder + 1,
      },
    });
  }
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
  const packs = parseSpecialties((await getPracticeSettings(practiceId)).specialties);
  const all = await prisma.chartWorkflow.findMany({
    where: { practiceId, active: true, ...specialtyWhere(packs) },
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
