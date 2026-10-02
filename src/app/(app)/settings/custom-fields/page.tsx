import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { customFieldTypeLabel, customOptions } from "@/lib/custom-fields";
import { SettingsNav } from "../settings-nav";
import { addCustomField, toggleCustomField, updateCustomField } from "./actions";

type Search = { error?: string; ok?: string; edit?: string };

function FieldInputs({ field }: { field?: { label: string; type: string; options: string | null; helpText: string | null; required: boolean; order: number } }) {
  return (
    <>
      <label>
        Label
        <input name="label" defaultValue={field?.label ?? ""} required maxLength={80} placeholder="e.g. Preferred pharmacy chain" />
      </label>
      <label>
        Kind of field
        {field ? (
          <>
            <input type="hidden" name="type" value={field.type} />
            <input value={customFieldTypeLabel[field.type] ?? field.type} disabled />
          </>
        ) : (
          <select name="type" defaultValue="TEXT">
            {Object.entries(customFieldTypeLabel).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        )}
      </label>
      <label>
        Position on the form
        <input name="order" type="number" min="0" max="999" defaultValue={field?.order ?? 0} />
      </label>
      <label className="pv-wide">
        Choices (dropdown lists only, one per line)
        <textarea name="options" rows={3} defaultValue={field?.options ?? ""} placeholder={"Choice one\nChoice two"} />
      </label>
      <label className="pv-wide">
        Help text shown under the field
        <input name="helpText" defaultValue={field?.helpText ?? ""} maxLength={160} />
      </label>
      <label className="cm-check">
        <input type="checkbox" name="required" defaultChecked={field?.required ?? false} />
        Required when registering a patient
      </label>
    </>
  );
}

// Extra fields on the patient registration form, defined by the practice.
export default async function CustomFieldsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const [fields, patients] = await Promise.all([
    prisma.customField.findMany({ where: { practiceId: user.practiceId }, orderBy: [{ active: "desc" }, { order: "asc" }, { createdAt: "asc" }] }),
    prisma.patient.findMany({ where: { practiceId: user.practiceId, customFields: { not: null } }, select: { customFields: true } }),
  ]);
  // How many patients have an answer, so a field in use isn't turned off by accident.
  const used = new Map<string, number>();
  for (const p of patients) {
    try {
      for (const [k, v] of Object.entries(JSON.parse(p.customFields ?? "{}") as Record<string, string>)) if (v) used.set(k, (used.get(k) ?? 0) + 1);
    } catch {
      // unreadable value: counts as no answers
    }
  }

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link>
          </p>
          <h1>Custom patient fields</h1>
        </div>
      </div>
      <SettingsNav current="custom-fields" role={user.role} />
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}

      <section className="panel">
        <div className="gw-section-head">
          <h2>Add a field</h2>
          <span className="muted">Shows under “Additional information” on Add / Edit patient, on the patient summary and in the patient registry</span>
        </div>
        <form action={addCustomField} className="form-grid gw-grid-3">
          <FieldInputs />
          <div className="pv-actions">
            <button className="btn" type="submit">
              Add field
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="gw-section-head">
          <h2>Fields</h2>
          <span className="muted">{fields.filter((f) => f.active).length} on the form</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Position</th>
              <th>Label</th>
              <th>Kind</th>
              <th>Choices</th>
              <th>Required</th>
              <th>Patients with an answer</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.id} className={f.active ? undefined : "cm-blocked"}>
                <td>{f.order}</td>
                <td>
                  <strong>{f.label}</strong>
                  {f.helpText ? <div className="muted">{f.helpText}</div> : null}
                </td>
                <td>{customFieldTypeLabel[f.type] ?? f.type}</td>
                <td>{f.type === "SELECT" ? customOptions(f.options).join(", ") : "—"}</td>
                <td>{f.required ? "Yes" : "No"}</td>
                <td>{used.get(f.key) ?? 0}</td>
                <td>
                  <span className={`gw-tag gw-tag-${f.active ? "ok" : "muted"}`}>{f.active ? "On the form" : "Turned off"}</span>
                </td>
                <td className="num cm-row-actions">
                  <Link className="btn secondary gw-mini" href={`/settings/custom-fields?edit=${f.id}`}>
                    Edit
                  </Link>
                  <form action={toggleCustomField.bind(null, f.id)}>
                    <button className="btn ghost gw-mini" type="submit">
                      {f.active ? "Turn off" : "Turn on"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {fields.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No custom fields yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {fields
          .filter((f) => f.id === sp.edit)
          .map((f) => (
            <form key={f.id} action={updateCustomField.bind(null, f.id)} className="form-grid gw-grid-3 pv-request">
              <h3 className="pv-wide">Edit “{f.label}”</h3>
              <FieldInputs field={f} />
              <div className="pv-actions">
                <button className="btn" type="submit">
                  Save changes
                </button>
                <Link className="btn ghost" href="/settings/custom-fields">
                  Cancel
                </Link>
              </div>
            </form>
          ))}
      </section>
    </div>
  );
}
