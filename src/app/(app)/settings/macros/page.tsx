import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { can, rolesFor } from "@/lib/permissions";
import { MACRO_SECTIONS } from "@/lib/macros";
import { SettingsNav } from "../settings-nav";
import { deleteMacro, importPracticeMacros, saveMacro } from "./actions";

// Dot-phrase macros: the practice set (administrators) and each user's own. In any note field, type
// ".shortcut" and a space to expand it; placeholders {patient} {age} {sex} {today} {vitals} fill in.
export default async function MacrosPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; edit?: string }> }) {
  const user = await requireUser(rolesFor("chart.edit"));
  const sp = await searchParams;
  const admin = can(user, "settings.admin");
  const macros = await prisma.textMacro.findMany({ where: { practiceId: user.practiceId, OR: [{ userId: null }, { userId: user.id }] }, orderBy: [{ userId: "asc" }, { shortcut: "asc" }] });
  const editing = sp.edit ? macros.find((m) => m.id === sp.edit) ?? null : null;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link>
          </p>
          <h1>Text macros</h1>
        </div>
        <form action={importPracticeMacros}>
          <button className="btn ghost" type="submit">
            Copy practice macros to mine
          </button>
        </form>
      </div>
      <SettingsNav current="macros" role={user.role} />
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      <div className="two-col">
        <section className="panel">
          <p className="muted">
            In any note field type <code>.shortcut</code> and a space. Placeholders: <code>{"{patient}"}</code> <code>{"{age}"}</code> <code>{"{sex}"}</code> <code>{"{today}"}</code> <code>{"{vitals}"}</code>.
          </p>
          <table>
            <thead>
              <tr>
                <th>Shortcut</th>
                <th>Section</th>
                <th>Text</th>
                <th>Scope</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {macros.map((m) => (
                <tr key={m.id}>
                  <td>
                    <code>.{m.shortcut}</code>
                  </td>
                  <td className="cn-small">{MACRO_SECTIONS[m.section] ?? m.section}</td>
                  <td className="cn-small">{m.text.slice(0, 140)}{m.text.length > 140 ? "…" : ""}</td>
                  <td className="cn-small">{m.userId ? "Mine" : "Practice"}</td>
                  <td className="cn-inline">
                    {(m.userId === user.id || (!m.userId && admin)) && (
                      <>
                        <Link className="btn ghost gw-mini" href={`/settings/macros?edit=${m.id}`}>
                          Edit
                        </Link>
                        <form action={deleteMacro.bind(null, m.id)}>
                          <button className="btn ghost gw-mini" type="submit">
                            Remove
                          </button>
                        </form>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {macros.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No macros yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
        <form className="panel stack" action={saveMacro.bind(null, editing?.id ?? null)}>
          <h2>{editing ? `Edit .${editing.shortcut}` : "Add a macro"}</h2>
          <div className="form-grid gw-grid-3">
            <label>
              Shortcut
              <input name="shortcut" required maxLength={40} defaultValue={editing?.shortcut ?? ""} placeholder="e.g. nml-exam" />
            </label>
            <label>
              Section
              <select name="section" defaultValue={editing?.section ?? "UNIVERSAL"}>
                {Object.entries(MACRO_SECTIONS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Scope
              <select name="scope" defaultValue={editing ? (editing.userId ? "PERSONAL" : "PRACTICE") : admin ? "PRACTICE" : "PERSONAL"}>
                <option value="PERSONAL">Mine only</option>
                {admin && <option value="PRACTICE">Whole practice</option>}
              </select>
            </label>
          </div>
          <label>
            Text
            <textarea name="text" rows={6} required maxLength={4000} defaultValue={editing?.text ?? ""} placeholder="{patient} is a {age}-year-old {sex} seen today ({today}). Vitals: {vitals}." />
          </label>
          <div className="cn-inline">
            <button className="btn" type="submit">
              {editing ? "Save" : "Add macro"}
            </button>
            {editing && (
              <Link className="btn ghost" href="/settings/macros">
                Cancel
              </Link>
            )}
          </div>
        </form>
      </div>
    </>
  );
}
