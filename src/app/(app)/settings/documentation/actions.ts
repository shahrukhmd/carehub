"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { DOCUMENT_SECTIONS, FIELD_TYPES, parseFields, slugId, type FieldDef, type FieldType } from "@/lib/chart-forms";
import { VIEW_PARTS } from "@/lib/document-catalog";
import { getVisitTypes } from "@/lib/scheduler-setup";

class SetupError extends Error {}

function fail(message: string): never {
  throw new SetupError(message);
}

async function guarded(back: string, work: () => Promise<string | void>) {
  let target = back;
  try {
    target = (await work()) ?? back;
  } catch (err) {
    if (!(err instanceof SetupError)) throw err;
    target = `${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(err.message.slice(0, 300))}`;
  }
  revalidatePath("/settings/documentation", "layout");
  revalidatePath("/encounters", "layout");
  redirect(target);
}

const admin = () => requireUser(["ADMIN"]);
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const on = (fd: FormData, k: string) => fd.get(k) === "on";

async function ownTemplate(practiceId: string, id: string) {
  const t = await prisma.documentTemplate.findFirst({ where: { id, practiceId } });
  if (!t) fail("Template not found.");
  return t;
}

function section(fd: FormData) {
  const s = str(fd, "section");
  if (!(s in DOCUMENT_SECTIONS)) fail("Pick a section.");
  return s;
}

// ---- Templates ----

export async function createTemplate(fd: FormData) {
  return guarded("/settings/documentation?tab=templates", async () => {
    const user = await admin();
    const name = str(fd, "name");
    if (!name) fail("Name the template.");
    const copyFrom = str(fd, "copyFrom");
    const source = copyFrom ? await ownTemplate(user.practiceId, copyFrom) : null;
    if (source && source.kind !== "FORM") fail("Only designed forms can be copied — built-in chart sections can't.");
    const key = `custom_${slugId(name, new Set()).slice(0, 30)}_${randomBytes(3).toString("hex")}`;
    const t = await prisma.documentTemplate.create({
      data: {
        practiceId: user.practiceId,
        key,
        name: name.slice(0, 120),
        description: str(fd, "description") || source?.description || null,
        section: section(fd),
        kind: "FORM",
        perWound: on(fd, "perWound") || Boolean(source?.perWound),
        fields: source?.fields ?? "[]",
        signatureRequired: Boolean(source?.signatureRequired),
        sortOrder: 900,
        noteOrder: 900,
      },
    });
    await logAudit(user.practiceId, user.id, "CREATE_TEMPLATE", "DocumentTemplate", t.id, t.name);
    return `/settings/documentation/templates/${t.id}`;
  });
}

export async function updateTemplate(id: string, fd: FormData) {
  return guarded(`/settings/documentation/templates/${id}`, async () => {
    const user = await admin();
    const t = await ownTemplate(user.practiceId, id);
    const name = str(fd, "name");
    if (!name) fail("Name the template.");
    await prisma.documentTemplate.update({
      where: { id: t.id },
      data: {
        name: name.slice(0, 120),
        description: str(fd, "description") || null,
        section: section(fd),
        perWound: t.kind === "FORM" ? on(fd, "perWound") : t.perWound,
        signatureRequired: t.kind === "FORM" ? on(fd, "signatureRequired") : false,
        critical: on(fd, "critical"),
        inProgressNote: on(fd, "inProgressNote"),
        active: on(fd, "active"),
      },
    });
    await logAudit(user.practiceId, user.id, "UPDATE_TEMPLATE", "DocumentTemplate", t.id, name);
    return `/settings/documentation/templates/${id}?saved=1`;
  });
}

function readField(fd: FormData): Omit<FieldDef, "id"> {
  const label = str(fd, "label");
  if (!label) fail("Give the field a label.");
  const type = str(fd, "type") as FieldType;
  if (!(type in FIELD_TYPES)) fail("Pick a field type.");
  const options = str(fd, "options")
    .split(/\r?\n/)
    .map((o) => o.trim())
    .filter(Boolean)
    .slice(0, 60);
  if (["select", "radio", "checkboxes"].includes(type) && options.length < 2) fail("Choice fields need at least two options (one per line).");
  if (type === "score" && options.some((o) => !/^\d+\s*\|/.test(o))) fail('Score bands look like "9|Very high risk" — the highest score for the band, then the meaning.');
  const width = str(fd, "width") === "half" ? "half" : "full";
  return {
    label: label.slice(0, 300),
    type,
    options: ["select", "radio", "checkboxes", "score"].includes(type) ? options : undefined,
    required: ["heading", "note", "score"].includes(type) ? false : on(fd, "required"),
    help: str(fd, "help").slice(0, 300) || undefined,
    unit: type === "number" ? str(fd, "unit").slice(0, 20) || undefined : undefined,
    width,
  };
}

async function saveFields(t: { id: string; version: number }, fields: FieldDef[]) {
  await prisma.documentTemplate.update({ where: { id: t.id }, data: { fields: JSON.stringify(fields), version: t.version + 1 } });
}

async function formTemplate(practiceId: string, id: string) {
  const t = await ownTemplate(practiceId, id);
  if (t.kind !== "FORM") fail("Built-in chart sections don't have designable fields.");
  return t;
}

export async function addField(id: string, fd: FormData) {
  return guarded(`/settings/documentation/templates/${id}#fields`, async () => {
    const user = await admin();
    const t = await formTemplate(user.practiceId, id);
    const fields = parseFields(t.fields);
    if (fields.length >= 150) fail("A template can have up to 150 fields.");
    const spec = readField(fd);
    const field: FieldDef = { ...spec, id: slugId(spec.label, new Set(fields.map((f) => f.id))) };
    const after = str(fd, "after");
    const at = after ? fields.findIndex((f) => f.id === after) + 1 : fields.length;
    fields.splice(at > 0 ? at : fields.length, 0, field);
    await saveFields(t, fields);
    return `/settings/documentation/templates/${id}?added=${field.id}#f-${field.id}`;
  });
}

export async function updateField(id: string, fieldId: string, fd: FormData) {
  return guarded(`/settings/documentation/templates/${id}#f-${fieldId}`, async () => {
    const user = await admin();
    const t = await formTemplate(user.practiceId, id);
    const fields = parseFields(t.fields);
    const i = fields.findIndex((f) => f.id === fieldId);
    if (i < 0) fail("Field not found.");
    // The field id stays the same so answers already recorded keep lining up.
    fields[i] = { ...readField(fd), id: fieldId };
    await saveFields(t, fields);
    return `/settings/documentation/templates/${id}?saved=1#f-${fieldId}`;
  });
}

export async function moveField(id: string, fieldId: string, direction: "up" | "down") {
  return guarded(`/settings/documentation/templates/${id}#f-${fieldId}`, async () => {
    const user = await admin();
    const t = await formTemplate(user.practiceId, id);
    const fields = parseFields(t.fields);
    const i = fields.findIndex((f) => f.id === fieldId);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= fields.length) return;
    [fields[i], fields[j]] = [fields[j], fields[i]];
    await saveFields(t, fields);
  });
}

export async function removeField(id: string, fieldId: string) {
  return guarded(`/settings/documentation/templates/${id}#fields`, async () => {
    const user = await admin();
    const t = await formTemplate(user.practiceId, id);
    await saveFields(
      t,
      parseFields(t.fields).filter((f) => f.id !== fieldId)
    );
  });
}

export async function duplicateTemplate(id: string) {
  return guarded(`/settings/documentation/templates/${id}`, async () => {
    const user = await admin();
    const t = await formTemplate(user.practiceId, id);
    const copy = await prisma.documentTemplate.create({
      data: {
        practiceId: user.practiceId,
        key: `custom_${slugId(t.name, new Set()).slice(0, 30)}_${randomBytes(3).toString("hex")}`,
        name: `${t.name} (copy)`.slice(0, 120),
        description: t.description,
        section: t.section,
        kind: "FORM",
        perWound: t.perWound,
        fields: t.fields,
        signatureRequired: t.signatureRequired,
        critical: t.critical,
        inProgressNote: t.inProgressNote,
        sortOrder: t.sortOrder + 1,
        noteOrder: t.noteOrder + 1,
      },
    });
    return `/settings/documentation/templates/${copy.id}`;
  });
}

export async function deleteTemplate(id: string) {
  return guarded(`/settings/documentation/templates/${id}`, async () => {
    const user = await admin();
    const t = await ownTemplate(user.practiceId, id);
    if (t.standard) fail("Standard templates can't be deleted — untick Active to hide it.");
    const used = await prisma.encounterDocument.count({ where: { templateId: t.id } });
    if (used) fail(`This template has been used on ${used} visit(s) — untick Active to retire it instead.`);
    await prisma.documentTemplate.delete({ where: { id: t.id } });
    await logAudit(user.practiceId, user.id, "DELETE_TEMPLATE", "DocumentTemplate", t.id, t.name);
    return "/settings/documentation?tab=templates";
  });
}

// Document options: active, section and order for every template at once.
export async function saveDocumentOptions(fd: FormData) {
  return guarded("/settings/documentation?tab=templates", async () => {
    const user = await admin();
    const templates = await prisma.documentTemplate.findMany({ where: { practiceId: user.practiceId } });
    for (const t of templates) {
      if (!fd.has(`present_${t.id}`)) continue;
      const order = Number(str(fd, `sort_${t.id}`));
      const sec = str(fd, `section_${t.id}`);
      await prisma.documentTemplate.update({
        where: { id: t.id },
        data: {
          active: on(fd, `active_${t.id}`),
          sortOrder: Number.isFinite(order) ? Math.round(order) : t.sortOrder,
          section: sec in DOCUMENT_SECTIONS ? sec : t.section,
        },
      });
    }
    return "/settings/documentation?tab=templates&saved=1";
  });
}

// Form signature requirements / critical documents: one checkbox per template.
export async function saveTemplateFlags(flag: "signatureRequired" | "critical", fd: FormData) {
  const tab = flag === "critical" ? "critical" : "signatures";
  return guarded(`/settings/documentation?tab=${tab}`, async () => {
    const user = await admin();
    const templates = await prisma.documentTemplate.findMany({ where: { practiceId: user.practiceId } });
    for (const t of templates) {
      if (flag === "signatureRequired" && t.kind !== "FORM") continue;
      const value = on(fd, `flag_${t.id}`);
      if (t[flag] !== value) await prisma.documentTemplate.update({ where: { id: t.id }, data: { [flag]: value } });
    }
    await logAudit(user.practiceId, user.id, "UPDATE_TEMPLATE_FLAGS", "DocumentTemplate", flag, flag);
    return `/settings/documentation?tab=${tab}&saved=1`;
  });
}

export async function saveProgressNoteSettings(fd: FormData) {
  return guarded("/settings/documentation?tab=progress", async () => {
    const user = await admin();
    const templates = await prisma.documentTemplate.findMany({ where: { practiceId: user.practiceId, kind: "FORM" } });
    for (const t of templates) {
      const order = Number(str(fd, `ord_${t.id}`));
      await prisma.documentTemplate.update({
        where: { id: t.id },
        data: { inProgressNote: on(fd, `inc_${t.id}`), noteOrder: Number.isFinite(order) ? Math.round(order) : t.noteOrder },
      });
    }
    return "/settings/documentation?tab=progress&saved=1";
  });
}

// ---- Workflows ----

async function ownWorkflow(practiceId: string, id: string) {
  const wf = await prisma.chartWorkflow.findFirst({ where: { id, practiceId }, include: { steps: { orderBy: { sortOrder: "asc" } } } });
  if (!wf) fail("Workflow not found.");
  return wf;
}

export async function createWorkflow(fd: FormData) {
  return guarded("/settings/documentation?tab=workflows", async () => {
    const user = await admin();
    const name = str(fd, "name");
    if (!name) fail("Name the workflow.");
    const copyFrom = str(fd, "copyFrom");
    const source = copyFrom ? await ownWorkflow(user.practiceId, copyFrom) : null;
    const wf = await prisma.chartWorkflow.create({
      data: {
        practiceId: user.practiceId,
        name: name.slice(0, 120),
        description: source?.description ?? null,
        steps: source
          ? { create: source.steps.map((s) => ({ templateId: s.templateId, sortOrder: s.sortOrder, requiredToFinalize: s.requiredToFinalize })) }
          : undefined,
      },
    });
    await logAudit(user.practiceId, user.id, "CREATE_WORKFLOW", "ChartWorkflow", wf.id, wf.name);
    return `/settings/documentation/workflows/${wf.id}`;
  });
}

export async function updateWorkflow(id: string, fd: FormData) {
  return guarded(`/settings/documentation/workflows/${id}`, async () => {
    const user = await admin();
    const wf = await ownWorkflow(user.practiceId, id);
    const name = str(fd, "name");
    if (!name) fail("Name the workflow.");
    const codes = new Set((await getVisitTypes(user.practiceId, { includeInactive: true })).map((t) => t.code));
    const visitTypes = fd.getAll("visitTypes").map(String).filter((v) => codes.has(v));
    const isDefault = on(fd, "isDefault");
    const active = on(fd, "active") || isDefault;
    if (wf.isDefault && !isDefault) fail("Make another workflow the default first.");
    if (isDefault) await prisma.chartWorkflow.updateMany({ where: { practiceId: user.practiceId, id: { not: wf.id } }, data: { isDefault: false } });
    // A visit type belongs to one workflow.
    for (const other of await prisma.chartWorkflow.findMany({ where: { practiceId: user.practiceId, id: { not: wf.id } } })) {
      const kept = (other.visitTypes ?? "").split(",").filter((v) => v && !visitTypes.includes(v));
      if (kept.join(",") !== (other.visitTypes ?? "")) await prisma.chartWorkflow.update({ where: { id: other.id }, data: { visitTypes: kept.join(",") } });
    }
    await prisma.chartWorkflow.update({
      where: { id: wf.id },
      data: { name: name.slice(0, 120), description: str(fd, "description") || null, visitTypes: visitTypes.join(","), isDefault, active },
    });
    return `/settings/documentation/workflows/${id}?saved=1`;
  });
}

export async function addWorkflowStep(id: string, fd: FormData) {
  return guarded(`/settings/documentation/workflows/${id}`, async () => {
    const user = await admin();
    const wf = await ownWorkflow(user.practiceId, id);
    const t = await ownTemplate(user.practiceId, str(fd, "templateId"));
    if (wf.steps.some((s) => s.templateId === t.id)) fail(`${t.name} is already in this workflow.`);
    const last = wf.steps[wf.steps.length - 1]?.sortOrder ?? 0;
    await prisma.chartWorkflowStep.create({ data: { workflowId: wf.id, templateId: t.id, sortOrder: last + 10, requiredToFinalize: on(fd, "required") } });
  });
}

export async function saveWorkflowSteps(id: string, fd: FormData) {
  return guarded(`/settings/documentation/workflows/${id}`, async () => {
    const user = await admin();
    const wf = await ownWorkflow(user.practiceId, id);
    for (const s of wf.steps) {
      const order = Number(str(fd, `order_${s.id}`));
      await prisma.chartWorkflowStep.update({
        where: { id: s.id },
        data: { requiredToFinalize: on(fd, `req_${s.id}`), sortOrder: Number.isFinite(order) ? Math.round(order) : s.sortOrder },
      });
    }
    return `/settings/documentation/workflows/${id}?saved=1`;
  });
}

export async function moveWorkflowStep(id: string, stepId: string, direction: "up" | "down") {
  return guarded(`/settings/documentation/workflows/${id}`, async () => {
    const user = await admin();
    const wf = await ownWorkflow(user.practiceId, id);
    const i = wf.steps.findIndex((s) => s.id === stepId);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= wf.steps.length) return;
    const order = wf.steps.map((s) => s.id);
    [order[i], order[j]] = [order[j], order[i]];
    for (const [n, sid] of order.entries()) {
      await prisma.chartWorkflowStep.update({ where: { id: sid }, data: { sortOrder: (n + 1) * 10 } });
    }
  });
}

export async function removeWorkflowStep(id: string, stepId: string) {
  return guarded(`/settings/documentation/workflows/${id}`, async () => {
    const user = await admin();
    const wf = await ownWorkflow(user.practiceId, id);
    if (!wf.steps.some((s) => s.id === stepId)) fail("Step not found.");
    await prisma.chartWorkflowStep.delete({ where: { id: stepId } });
  });
}

export async function deleteWorkflow(id: string) {
  return guarded(`/settings/documentation/workflows/${id}`, async () => {
    const user = await admin();
    const wf = await ownWorkflow(user.practiceId, id);
    if (wf.isDefault) fail("The default workflow can't be deleted — make another one the default first.");
    // Visits that used it fall back to their visit type's workflow or the default.
    await prisma.chartWorkflow.delete({ where: { id: wf.id } });
    await logAudit(user.practiceId, user.id, "DELETE_WORKFLOW", "ChartWorkflow", wf.id, wf.name);
    return "/settings/documentation?tab=workflows";
  });
}

// ---- Documentation views ----

export async function saveView(viewId: string, fd: FormData) {
  const back = viewId === "new" ? "/settings/documentation/views/new" : `/settings/documentation/views/${viewId}`;
  return guarded(back, async () => {
    const user = await admin();
    const name = str(fd, "name");
    if (!name) fail("Name the view.");
    const keys = new Set((await prisma.documentTemplate.findMany({ where: { practiceId: user.practiceId }, select: { key: true } })).map((t) => t.key));
    // Ticked parts print in the order given by their order boxes.
    const orderOf = (p: string) => {
      const n = Number(str(fd, `order_${p}`));
      return Number.isFinite(n) ? n : 999;
    };
    const parts = fd
      .getAll("parts")
      .map(String)
      .filter((p) => p in VIEW_PARTS || (p.startsWith("doc:") && keys.has(p.slice(4))))
      .sort((a, b) => orderOf(a) - orderOf(b));
    if (parts.length === 0) fail("Pick at least one part to include.");
    const data = { name: name.slice(0, 120), description: str(fd, "description") || null, parts: JSON.stringify(parts), active: on(fd, "active") };
    if (viewId === "new") {
      const v = await prisma.documentationView.create({ data: { ...data, practiceId: user.practiceId, sortOrder: 900 } });
      return `/settings/documentation/views/${v.id}?saved=1`;
    }
    const v = await prisma.documentationView.findFirst({ where: { id: viewId, practiceId: user.practiceId } });
    if (!v) fail("View not found.");
    await prisma.documentationView.update({ where: { id: v.id }, data });
    return `/settings/documentation/views/${v.id}?saved=1`;
  });
}

export async function deleteView(viewId: string) {
  return guarded(`/settings/documentation/views/${viewId}`, async () => {
    const user = await admin();
    const v = await prisma.documentationView.findFirst({ where: { id: viewId, practiceId: user.practiceId } });
    if (!v) fail("View not found.");
    await prisma.documentationView.delete({ where: { id: v.id } });
    return "/settings/documentation?tab=views";
  });
}
