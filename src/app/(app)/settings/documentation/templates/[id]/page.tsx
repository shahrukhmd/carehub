import { rolesFor } from "@/lib/permissions";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BUILTIN_SECTIONS, DOCUMENT_SECTIONS, FIELD_TYPES, parseFields, type FieldDef } from "@/lib/chart-forms";
import { DocumentFields } from "@/components/DocumentForm";
import { MAP_TARGETS } from "@/lib/connect/patient-forms";
import { SettingsNav } from "../../../settings-nav";
import { addField, deleteTemplate, duplicateTemplate, moveField, removeField, updateField, updateTemplate } from "../../actions";

function FieldInputs({ field, patient }: { field?: FieldDef; patient?: boolean }) {
  return (
    <div className="form-grid gw-grid-3">
      <label>
        Label
        <input name="label" defaultValue={field?.label ?? ""} required />
      </label>
      <label>
        Type
        <select name="type" defaultValue={field?.type ?? "text"}>
          {Object.entries(FIELD_TYPES).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        Width
        <select name="width" defaultValue={field?.width ?? "full"}>
          <option value="full">Full width</option>
          <option value="half">Half width</option>
        </select>
      </label>
      <label className="dz-options">
        Options (one per line)
        <textarea
          name="options"
          rows={4}
          defaultValue={(field?.options ?? []).join("\n")}
          placeholder={"For choices: Label or Label|score\nFor a score total: 9|Very high risk"}
        />
      </label>
      <label>
        Help text
        <input name="help" defaultValue={field?.help ?? ""} placeholder="Shown under the field" />
      </label>
      <label>
        Unit (numbers)
        <input name="unit" defaultValue={field?.unit ?? ""} placeholder="cm, mmHg, minutes…" />
      </label>
      <label className="checkbox-inline">
        <input type="checkbox" name="required" defaultChecked={Boolean(field?.required)} /> Required to complete the form
      </label>
      {patient && (
        <label>
          Fills patient field
          <select name="map" defaultValue={field?.map ?? ""}>
            <option value="">— Not mapped —</option>
            {MAP_TARGETS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

export default async function TemplateDesignerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; added?: string }>;
}) {
  const user = await requireUser(rolesFor("settings.admin"));
  const { id } = await params;
  const sp = await searchParams;
  const t = await prisma.documentTemplate.findFirst({
    where: { id, practiceId: user.practiceId },
    include: { steps: { include: { workflow: true } }, _count: { select: { documents: true } } },
  });
  if (!t) notFound();
  const fields = parseFields(t.fields);
  const isForm = t.kind === "FORM";

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            {t.audience === "PATIENT" ? (
              <Link href="/connect?tab=forms">Patient Connect · Patient forms</Link>
            ) : (
              <Link href="/settings/documentation?tab=templates">Documentation settings</Link>
            )}{" "}
            · {isForm ? "Form designer" : "Built-in chart section"}
          </p>
          <h1>{t.name}</h1>
        </div>
        <div className="vw-view-links">
          {isForm && (
            <form action={duplicateTemplate.bind(null, t.id)}>
              <button className="btn secondary" type="submit">
                Duplicate
              </button>
            </form>
          )}
          {!t.standard && (
            <form action={deleteTemplate.bind(null, t.id)}>
              <button className="btn ghost" type="submit">
                Delete template
              </button>
            </form>
          )}
        </div>
      </div>
      <SettingsNav current="documentation" />
      {sp.saved && <p className="notice-ok">Saved.</p>}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}

      <section className="panel">
        <h2>Template settings</h2>
        {!isForm && <p className="muted">{BUILTIN_SECTIONS[t.builtin ?? t.key]?.description} — its fields are part of the chart and can&apos;t be redesigned.</p>}
        <form action={updateTemplate.bind(null, t.id)} className="stack">
          <div className="form-grid gw-grid-3">
            <label>
              Name
              <input name="name" defaultValue={t.name} required />
            </label>
            <label>
              Section
              <select name="section" defaultValue={t.section}>
                {Object.entries(DOCUMENT_SECTIONS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Description
              <input name="description" defaultValue={t.description ?? ""} />
            </label>
          </div>
          <div className="st-checks">
            <label className="checkbox-inline">
              <input type="checkbox" name="active" defaultChecked={t.active} /> Active (available for charting)
            </label>
            {isForm && (
              <label className="checkbox-inline">
                <input type="checkbox" name="perWound" defaultChecked={t.perWound} /> Complete once per open wound
              </label>
            )}
            {isForm && (
              <label className="checkbox-inline">
                <input type="checkbox" name="signatureRequired" defaultChecked={t.signatureRequired} /> Provider signature required
              </label>
            )}
            <label className="checkbox-inline">
              <input type="checkbox" name="critical" defaultChecked={t.critical} /> Critical document
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" name="inProgressNote" defaultChecked={t.inProgressNote} /> Include in the progress note
            </label>
          </div>
          <div className="form-actions">
            <button className="btn" type="submit">
              Save settings
            </button>
          </div>
        </form>
        <p className="muted">
          Used in:{" "}
          {t.steps.length
            ? t.steps.map((s, i) => (
                <span key={s.id}>
                  {i ? ", " : ""}
                  <Link href={`/settings/documentation/workflows/${s.workflowId}`}>{s.workflow.name}</Link>
                  {s.requiredToFinalize ? " (required)" : ""}
                </span>
              ))
            : "no workflow — it's charted from Additional documents"}
          {" · "}
          {t._count.documents} visit document(s) · version {t.version}
        </p>
      </section>

      {isForm && (
        <div className="dz-layout">
          <section className="panel stack" id="fields">
            <h2>Fields</h2>
            {fields.length === 0 && <p className="muted">No fields yet — add the first one below.</p>}
            <ol className="dz-fields">
              {fields.map((f, i) => (
                <li key={f.id} id={`f-${f.id}`}>
                  <details open={sp.added === f.id}>
                    <summary>
                      <span className="dz-type">{FIELD_TYPES[f.type]}</span>
                      <strong>{f.label}</strong>
                      {f.required && <span className="df-req"> *</span>}
                      {f.options?.length ? <span className="muted"> · {f.options.length} options</span> : null}
                    </summary>
                    <form action={updateField.bind(null, t.id, f.id)} className="stack dz-edit">
                      <FieldInputs field={f} patient={t.audience === "PATIENT"} />
                      <div className="vw-step-actions">
                        <button className="btn" type="submit">
                          Save field
                        </button>
                      </div>
                    </form>
                  </details>
                  <div className="dz-tools">
                    <form action={moveField.bind(null, t.id, f.id, "up")}>
                      <button className="btn ghost gw-mini" type="submit" disabled={i === 0} aria-label={`Move ${f.label} up`}>
                        ↑
                      </button>
                    </form>
                    <form action={moveField.bind(null, t.id, f.id, "down")}>
                      <button className="btn ghost gw-mini" type="submit" disabled={i === fields.length - 1} aria-label={`Move ${f.label} down`}>
                        ↓
                      </button>
                    </form>
                    <form action={removeField.bind(null, t.id, f.id)}>
                      <button className="btn ghost gw-mini" type="submit" aria-label={`Remove ${f.label}`}>
                        Remove
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ol>
            <div className="dz-add">
              <h3>Add a field</h3>
              <form action={addField.bind(null, t.id)} className="stack">
                <FieldInputs patient={t.audience === "PATIENT"} />
                <div className="form-grid gw-grid-3">
                  <label>
                    Position
                    <select name="after" defaultValue="">
                      <option value="">At the end</option>
                      {fields.map((f) => (
                        <option key={f.id} value={f.id}>
                          After “{f.label.slice(0, 40)}”
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="vw-step-actions">
                  <button className="btn" type="submit">
                    Add field
                  </button>
                </div>
              </form>
              <p className="muted dz-help">
                Choice options can carry a score (<code>Bedfast|1</code>); add a <em>Score total</em> field with bands like <code>9|Very high risk</code>{" "}
                to total them (Braden, Morse, MNA). Changing a field keeps answers already recorded; removing one hides its answers.
              </p>
            </div>
          </section>

          <section className="panel stack">
            <h2>Preview</h2>
            <p className="muted">How the form looks on the chart.</p>
            <fieldset className="gw-fieldset" disabled>
              <DocumentFields fields={fields} values={{}} idPrefix="preview" />
            </fieldset>
          </section>
        </div>
      )}
    </div>
  );
}
