import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { rolesFor } from "@/lib/permissions";
import { PHRASE_KINDS, SYSTEMS, ensureFindingLibrary } from "@/lib/findings";
import { SettingsNav } from "../settings-nav";
import { deletePhrase, restoreDefaults, savePhrase } from "./actions";

// The ROS and physical-exam phrase library: one normal statement per body system plus common findings.
export default async function FindingsPage({ searchParams }: { searchParams: Promise<{ kind?: string; edit?: string; ok?: string; error?: string }> }) {
  const user = await requireUser(rolesFor("settings.admin"));
  const sp = await searchParams;
  const kind = sp.kind === "ROS" ? "ROS" : "EXAM";
  await ensureFindingLibrary(user.practiceId);
  const phrases = await prisma.findingPhrase.findMany({ where: { practiceId: user.practiceId, kind }, orderBy: [{ system: "asc" }, { normal: "desc" }, { sortOrder: "asc" }] });
  const editing = sp.edit ? phrases.find((p) => p.id === sp.edit) ?? null : null;
  const bySystem = SYSTEMS.map((s) => [s, phrases.filter((p) => p.system === s)] as const).filter(([, l]) => l.length);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">
            <Link href="/settings">Settings</Link>
          </p>
          <h1>ROS &amp; exam phrases</h1>
        </div>
        <form action={restoreDefaults}>
          <input type="hidden" name="kind" value={kind} />
          <button className="btn ghost" type="submit">
            Restore the standard set
          </button>
        </form>
      </div>
      <SettingsNav current="findings" role={user.role} />
      {sp.ok && <p className="notice-ok">{sp.ok}</p>}
      {sp.error && (
        <p className="gw-error" role="alert">
          {sp.error}
        </p>
      )}
      <nav className="view-tabs" style={{ width: "fit-content" }}>
        {Object.entries(PHRASE_KINDS).map(([k, l]) => (
          <Link key={k} href={`/settings/findings?kind=${k}`} className={`view-tab${kind === k ? " active" : ""}`}>
            {l}
          </Link>
        ))}
      </nav>
      <div className="two-col">
        <section className="panel stack">
          <p className="muted">
            On the {kind === "EXAM" ? "Physical Exam (by system)" : "Review of Systems"} form each body system offers its <strong>normal</strong> statement and these
            findings as one-click chips. {kind === "EXAM" ? "“All systems normal” fills every empty system at once." : "“All systems negative” ticks every “denies” box."}
          </p>
          {bySystem.map(([system, list]) => (
            <div key={system}>
              <h3 className="df-heading">{system}</h3>
              <table className="cn-table">
                <tbody>
                  {list.map((p) => (
                    <tr key={p.id}>
                      <td style={{ width: "5rem" }}>{p.normal ? <span className="gw-tag gw-tag-ok">Normal</span> : <span className="muted cn-small">finding</span>}</td>
                      <td className="cn-small">{p.text}</td>
                      <td className="cn-inline" style={{ width: "9rem" }}>
                        <Link className="btn ghost gw-mini" href={`/settings/findings?kind=${kind}&edit=${p.id}`}>
                          Edit
                        </Link>
                        <form action={deletePhrase.bind(null, p.id)}>
                          <input type="hidden" name="kind" value={kind} />
                          <button className="btn ghost gw-mini" type="submit">
                            Remove
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {phrases.length === 0 && <p className="muted">No phrases yet.</p>}
        </section>
        <form className="panel stack" action={savePhrase.bind(null, editing?.id ?? null)}>
          <h2>{editing ? "Edit phrase" : "Add a phrase"}</h2>
          <input type="hidden" name="kind" value={kind} />
          <div className="form-grid gw-grid-3">
            <label>
              Body system
              <select name="system" defaultValue={editing?.system ?? "Constitutional"}>
                {SYSTEMS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Order
              <input name="sortOrder" type="number" defaultValue={editing?.sortOrder ?? 50} />
            </label>
            <label className="cn-inline" style={{ alignSelf: "end" }}>
              <input type="checkbox" name="normal" value="1" defaultChecked={editing?.normal ?? false} /> This is the normal statement
            </label>
          </div>
          <label>
            Phrase
            <textarea name="text" rows={4} required maxLength={600} defaultValue={editing?.text ?? ""} placeholder={kind === "EXAM" ? "Regular rate and rhythm, no murmurs." : "Denies chest pain or palpitations."} />
          </label>
          <div className="cn-inline">
            <button className="btn" type="submit">
              {editing ? "Save" : "Add phrase"}
            </button>
            {editing && (
              <Link className="btn ghost" href={`/settings/findings?kind=${kind}`}>
                Cancel
              </Link>
            )}
          </div>
        </form>
      </div>
    </>
  );
}
