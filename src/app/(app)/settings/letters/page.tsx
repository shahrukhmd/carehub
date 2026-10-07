import { rolesFor } from "@/lib/permissions";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MERGE_FIELDS, ensureLetters } from "@/lib/letters";
import { SettingsNav } from "../settings-nav";
import { deleteLetterTemplate, saveLetterTemplate } from "./actions";

export default async function LetterTemplatesPage({ searchParams }: { searchParams: Promise<{ edit?: string; saved?: string; error?: string }> }) {
  const user = await requireUser(rolesFor("settings.admin"));
  const sp = await searchParams;
  await ensureLetters(user.practiceId);
  const templates = await prisma.letterTemplate.findMany({ where: { practiceId: user.practiceId }, orderBy: { name: "asc" } });
  const editing = sp.edit === "new" ? null : templates.find((t) => t.id === sp.edit);

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link>
          </p>
          <h1>Letters &amp; labels</h1>
        </div>
        <Link className="btn secondary" href="/settings/letters?edit=new#edit">
          + New letter template
        </Link>
      </div>
      <SettingsNav current="letters" />
      {sp.saved && <p className="notice-ok">Saved.</p>}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      <section className="panel">
        <h2>Letter templates</h2>
        <p className="muted">Staff create letters from the patient chart (Letters &amp; labels). Merge fields fill in the patient, practice and visit details.</p>
        <table className="cn-table">
          <thead>
            <tr>
              <th>Template</th>
              <th>Subject</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <td>
                  <strong>{t.name}</strong>
                  {t.standard && <span className="cn-tag">standard</span>}
                </td>
                <td className="cn-small">{t.subject}</td>
                <td>{t.active ? "Active" : <span className="muted">Off</span>}</td>
                <td className="cn-actions">
                  <Link className="btn ghost gw-mini" href={`/settings/letters?edit=${t.id}#edit`}>
                    Edit
                  </Link>
                  {!t.standard && (
                    <form action={deleteLetterTemplate.bind(null, t.id)}>
                      <button className="btn ghost gw-mini" type="submit">
                        Delete
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {(sp.edit === "new" || editing) && (
        <section className="panel" id="edit">
          <h2>{editing ? `Edit: ${editing.name}` : "New letter template"}</h2>
          <form action={saveLetterTemplate.bind(null, editing?.id ?? "new")} className="stack">
            <div className="form-grid gw-grid-3">
              <label>
                Name
                <input name="name" required defaultValue={editing?.name ?? ""} />
              </label>
              <label className="gw-span-2">
                Subject (Re:)
                <input name="subject" defaultValue={editing?.subject ?? ""} />
              </label>
            </div>
            <label>
              Letter text
              <textarea name="body" rows={14} required defaultValue={editing?.body ?? "Dear {{patient.firstName}},\n\n\n\nSincerely,\n\n{{user.name}}\n{{practice.name}}"} className="lt-body" />
            </label>
            <p className="muted cn-small">
              Merge fields: {MERGE_FIELDS.map(([k]) => `{{${k}}}`).join("  ")}. The signer&apos;s signature is placed above the last paragraph.
            </p>
            <label className="checkbox-inline">
              <input type="checkbox" name="active" defaultChecked={editing?.active ?? true} /> Active
            </label>
            <div>
              <button className="btn" type="submit">
                Save template
              </button>{" "}
              <Link className="btn ghost" href="/settings/letters">
                Cancel
              </Link>
            </div>
          </form>
        </section>
      )}
      <section className="panel">
        <h2>Labels</h2>
        <p className="muted">
          Chart, address and barcode (Code 39 of the MRN) labels print from the patient chart on Avery 5160 / 8160 sheets (30 per page, 2⅝″ × 1″). Choose how
          many and which position to start at, so partly used sheets can be reused.
        </p>
      </section>
    </div>
  );
}
