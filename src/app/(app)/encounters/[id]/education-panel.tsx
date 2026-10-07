import { prisma } from "@/lib/prisma";
import { addEducationNote, lookupEducationForVisit, removeEducation } from "./education-actions";

// Patient education on the visit: material looked up by diagnosis (MedlinePlus Connect, free), plus the
// provider's own instructions. Prints on the visit summary and counts toward the education quality measure.
export async function EducationPanel({ encounterId, editable, error }: { encounterId: string; editable: boolean; error?: string }) {
  const items = await prisma.educationResource.findMany({ where: { encounterId }, orderBy: { createdAt: "asc" } });
  return (
    <section className="panel" id="education">
      <div className="cn-head">
        <h2>Patient education</h2>
        {editable && (
          <form action={lookupEducationForVisit.bind(null, encounterId)}>
            <button className="btn secondary gw-mini" type="submit">
              Look up for the diagnoses
            </button>
          </form>
        )}
      </div>
      {error && (
        <p className="gw-error" role="alert">
          {error}
        </p>
      )}
      {items.length === 0 && <p className="muted cn-small">Nothing attached yet. Look up material by diagnosis, or write instructions below.</p>}
      <ul className="stack">
        {items.map((r) => (
          <li key={r.id} className="cn-inline">
            <div style={{ flex: 1 }}>
              {r.url ? (
                <a href={r.url} target="_blank" rel="noreferrer">
                  {r.title}
                </a>
              ) : (
                <strong>{r.title}</strong>
              )}
              <span className="muted cn-small">
                {" "}
                · {r.source}
                {r.forCode ? ` · ${r.forCode}` : ""}
                {r.language === "es" ? " · Spanish" : ""}
              </span>
              {r.summary && <div className="cn-small">{r.summary}</div>}
            </div>
            {editable && (
              <form action={removeEducation.bind(null, encounterId, r.id)}>
                <button className="btn ghost gw-mini" type="submit">
                  Remove
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <form action={addEducationNote.bind(null, encounterId)} className="stack" style={{ marginTop: "0.6rem" }}>
          <div className="form-grid gw-grid-3">
            <label>
              Title
              <input name="title" maxLength={200} placeholder="Wound care at home" />
            </label>
            <label>
              Link (optional)
              <input name="url" maxLength={500} placeholder="https://" />
            </label>
          </div>
          <label>
            Instructions
            <textarea name="text" rows={2} maxLength={2000} placeholder="Plain-language instructions for the patient" />
          </label>
          <button className="btn ghost gw-mini" type="submit">
            Add instructions
          </button>
        </form>
      )}
    </section>
  );
}
