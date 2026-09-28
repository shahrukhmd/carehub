import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DOCUMENT_SECTIONS } from "@/lib/chart-forms";
import { visitTypeLabel } from "@/lib/format";
import { SettingsNav } from "../../../settings-nav";
import { addWorkflowStep, deleteWorkflow, moveWorkflowStep, removeWorkflowStep, saveWorkflowSteps, updateWorkflow } from "../../actions";

export default async function WorkflowEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const user = await requireUser(["ADMIN"]);
  const { id } = await params;
  const sp = await searchParams;
  const wf = await prisma.chartWorkflow.findFirst({
    where: { id, practiceId: user.practiceId },
    include: { steps: { include: { template: true }, orderBy: { sortOrder: "asc" } }, _count: { select: { encounters: true } } },
  });
  if (!wf) notFound();
  const templates = await prisma.documentTemplate.findMany({ where: { practiceId: user.practiceId, active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const inFlow = new Set(wf.steps.map((s) => s.templateId));
  const available = templates.filter((t) => !inFlow.has(t.id));
  const types = new Set((wf.visitTypes ?? "").split(",").filter(Boolean));

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/settings/documentation?tab=workflows">Documentation settings</Link> · Chart workflow
          </p>
          <h1>
            {wf.name} {wf.isDefault && <span className="gw-tag gw-tag-info">Default Workflow</span>}
          </h1>
        </div>
        {!wf.isDefault && (
          <form action={deleteWorkflow.bind(null, wf.id)}>
            <button className="btn ghost" type="submit">
              Delete workflow
            </button>
          </form>
        )}
      </div>
      <SettingsNav current="documentation" />
      {sp.saved && <p className="notice-ok">Saved.</p>}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}

      <section className="panel">
        <h2>Workflow settings</h2>
        <form action={updateWorkflow.bind(null, wf.id)} className="stack">
          <div className="form-grid gw-grid-3">
            <label>
              Name
              <input name="name" defaultValue={wf.name} required />
            </label>
            <label>
              Description
              <input name="description" defaultValue={wf.description ?? ""} />
            </label>
          </div>
          <fieldset className="gw-fieldset">
            <legend>Visit types that chart with this workflow</legend>
            <div className="st-checks">
              {Object.entries(visitTypeLabel).map(([v, l]) => (
                <label key={v} className="checkbox-inline">
                  <input type="checkbox" name="visitTypes" value={v} defaultChecked={types.has(v)} /> {l}
                </label>
              ))}
            </div>
            <p className="muted">A visit type can only belong to one workflow; ticking it here moves it. Other visits use the default workflow.</p>
          </fieldset>
          <div className="st-checks">
            <label className="checkbox-inline">
              <input type="checkbox" name="isDefault" defaultChecked={wf.isDefault} /> Default workflow
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="active" defaultChecked={wf.active} /> Active
            </label>
          </div>
          <div className="form-actions">
            <button className="btn" type="submit">
              Save workflow
            </button>
          </div>
        </form>
        <p className="muted">{wf._count.encounters} visit(s) are set to this workflow directly.</p>
      </section>

      <section className="panel stack">
        <h2>Documents in this workflow</h2>
        <p className="muted">
          The chart shows these in order, grouped by section. Tick <strong>Required</strong> for documents that must be complete before
          &ldquo;Finalize Visit&rdquo; (Finalize visit admin).
        </p>
        {wf.steps.length === 0 ? (
          <p className="muted">No documents yet — add them below.</p>
        ) : (
          <form action={saveWorkflowSteps.bind(null, wf.id)} className="stack">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Document</th>
                  <th>Section</th>
                  <th>Required to finalize</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {wf.steps.map((s, i) => (
                  <tr key={s.id} className={s.template.active ? undefined : "muted"}>
                    <td>
                      <input name={`order_${s.id}`} type="number" defaultValue={s.sortOrder} className="st-num" aria-label={`${s.template.name} order`} />
                    </td>
                    <td>
                      <Link href={`/settings/documentation/templates/${s.templateId}`}>{s.template.name}</Link>
                      <div className="muted">
                        {s.template.kind === "BUILTIN" ? "Built-in section" : "Form"}
                        {s.template.perWound ? " · per wound" : ""}
                        {s.template.signatureRequired ? " · signature required" : ""}
                        {s.template.critical ? " · critical" : ""}
                        {!s.template.active ? " · inactive (hidden)" : ""}
                      </div>
                    </td>
                    <td>{DOCUMENT_SECTIONS[s.template.section as keyof typeof DOCUMENT_SECTIONS] ?? s.template.section}</td>
                    <td>
                      <input type="checkbox" name={`req_${s.id}`} defaultChecked={s.requiredToFinalize} aria-label={`${s.template.name} required`} />
                    </td>
                    <td className="dz-tools">
                      <button className="btn ghost gw-mini" type="submit" formAction={moveWorkflowStep.bind(null, wf.id, s.id, "up")} disabled={i === 0} aria-label="Move up">
                        ↑
                      </button>
                      <button
                        className="btn ghost gw-mini"
                        type="submit"
                        formAction={moveWorkflowStep.bind(null, wf.id, s.id, "down")}
                        disabled={i === wf.steps.length - 1}
                        aria-label="Move down"
                      >
                        ↓
                      </button>
                      <button className="btn ghost gw-mini" type="submit" formAction={removeWorkflowStep.bind(null, wf.id, s.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="form-actions">
              <button className="btn" type="submit">
                Save order &amp; requirements
              </button>
            </div>
          </form>
        )}
        {available.length > 0 && (
          <form action={addWorkflowStep.bind(null, wf.id)} className="form-grid gw-grid-3">
            <label>
              Add a document
              <select name="templateId" required defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {Object.entries(DOCUMENT_SECTIONS).map(([sec, label]) => {
                  const list = available.filter((t) => t.section === sec);
                  return list.length ? (
                    <optgroup key={sec} label={label}>
                      {list.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </select>
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="required" /> Required to finalize
            </label>
            <button className="btn secondary" type="submit">
              Add to workflow
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
