import {
  computeScore,
  displayValue,
  optionLabel,
  optionScore,
  scoreBand,
  type DocValues,
  type FieldDef,
} from "@/lib/chart-forms";

// Inputs for a designed form. Field inputs are named f_<fieldId>; the surrounding <form> posts them.
export function DocumentFields({ fields, values, idPrefix = "doc" }: { fields: FieldDef[]; values: DocValues; idPrefix?: string }) {
  const score = computeScore(fields, values);
  return (
    <div className="df-grid">
      {fields.map((f) => {
        const name = `f_${f.id}`;
        const id = `${idPrefix}-${f.id}`;
        const v = values[f.id];
        const one = Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
        const many = new Set(Array.isArray(v) ? v : v ? [v] : []);
        const cls = `df-field${f.width === "half" ? " df-half" : ""}`;
        const label = (
          <span className="df-label">
            {f.label}
            {f.required && <span className="df-req" aria-label="required"> *</span>}
            {f.unit && <span className="muted"> ({f.unit})</span>}
          </span>
        );
        const help = f.help ? <span className="df-help">{f.help}</span> : null;

        switch (f.type) {
          case "heading":
            return (
              <h3 key={f.id} className="df-heading">
                {f.label}
              </h3>
            );
          case "note":
            return (
              <p key={f.id} className="df-note">
                {f.label}
              </p>
            );
          case "score": {
            const band = scoreBand(f, score);
            return (
              <div key={f.id} className="df-score">
                <span>{f.label}</span>
                <strong>{score ?? 0}</strong>
                {band && <span className="gw-tag gw-tag-info">{band}</span>}
                <span className="df-help">Calculated when the form is saved.</span>
              </div>
            );
          }
          case "textarea":
            return (
              <label key={f.id} className={cls} htmlFor={id}>
                {label}
                <textarea id={id} name={name} defaultValue={one} rows={4} />
                {help}
              </label>
            );
          case "number":
            return (
              <label key={f.id} className={cls} htmlFor={id}>
                {label}
                <input id={id} name={name} type="number" step="any" defaultValue={one} />
                {help}
              </label>
            );
          case "date":
            return (
              <label key={f.id} className={cls} htmlFor={id}>
                {label}
                <input id={id} name={name} type="date" defaultValue={one} />
                {help}
              </label>
            );
          case "select":
            return (
              <label key={f.id} className={cls} htmlFor={id}>
                {label}
                <select id={id} name={name} defaultValue={one}>
                  <option value="">—</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={optionLabel(o)}>
                      {optionLabel(o)}
                    </option>
                  ))}
                </select>
                {help}
              </label>
            );
          case "yesno":
          case "radio": {
            const opts = f.type === "yesno" ? ["Yes", "No"] : (f.options ?? []);
            return (
              <fieldset key={f.id} className={`${cls} df-choices`}>
                <legend>{label}</legend>
                <div className="df-options">
                  {opts.map((o) => (
                    <label key={o} className="df-option">
                      <input type="radio" name={name} value={optionLabel(o)} defaultChecked={one === optionLabel(o)} />
                      <span>
                        {optionLabel(o)}
                        {optionScore(o) !== null && <span className="muted"> ({optionScore(o)})</span>}
                      </span>
                    </label>
                  ))}
                </div>
                {help}
              </fieldset>
            );
          }
          case "checkboxes":
            return (
              <fieldset key={f.id} className={`${cls} df-choices`}>
                <legend>{label}</legend>
                <div className="df-options">
                  {(f.options ?? []).map((o) => (
                    <label key={o} className="df-option">
                      <input type="checkbox" name={name} value={optionLabel(o)} defaultChecked={many.has(optionLabel(o))} />
                      <span>
                        {optionLabel(o)}
                        {optionScore(o) !== null && <span className="muted"> ({optionScore(o)})</span>}
                      </span>
                    </label>
                  ))}
                </div>
                {help}
              </fieldset>
            );
          case "consent":
            return (
              <div key={f.id} className={`${cls} df-consent`}>
                {label}
                {f.help && <p className="df-consent-text">{f.help}</p>}
                <label className="df-option">
                  <input type="checkbox" name={name} value="on" defaultChecked={Boolean(one)} />
                  <span>I have read and agree</span>
                </label>
              </div>
            );
          case "signature":
          case "file":
            return (
              <div key={f.id} className={cls}>
                {label}
                <p className="df-help">{f.type === "signature" ? "Signed by the patient on the patient portal." : "Uploaded by the patient on the patient portal."}</p>
              </div>
            );
          case "checkbox":
            return (
              <label key={f.id} className={`${cls} df-option`}>
                <input type="checkbox" name={name} value="Yes" defaultChecked={one === "Yes"} />
                <span>
                  {f.label}
                  {f.required && <span className="df-req"> *</span>}
                </span>
              </label>
            );
          default:
            return (
              <label key={f.id} className={cls} htmlFor={id}>
                {label}
                <input id={id} name={name} defaultValue={one} />
                {help}
              </label>
            );
        }
      })}
    </div>
  );
}

// Read-only rendering for print views and summaries: only answered fields.
export function DocumentSummary({ fields, values, score }: { fields: FieldDef[]; values: DocValues; score?: number | null }) {
  const rows = fields
    .map((f) => {
      if (f.type === "heading") return { f, heading: true, text: "" };
      if (f.type === "score") {
        const band = scoreBand(f, score ?? null);
        return { f, heading: false, text: score === null || score === undefined ? "" : `${score}${band ? ` — ${band}` : ""}` };
      }
      return { f, heading: false, text: displayValue(f, values[f.id]) };
    })
    .filter((r) => r.heading || r.text);
  // Drop headings with nothing under them.
  const shown = rows.filter((r, i) => !r.heading || (rows[i + 1] && !rows[i + 1].heading));
  if (!shown.some((r) => !r.heading)) return <p className="muted">Nothing documented.</p>;
  return (
    <dl className="df-summary">
      {shown.map((r) =>
        r.heading ? (
          <dt key={r.f.id} className="df-summary-heading">
            {r.f.label}
          </dt>
        ) : (
          <div key={r.f.id}>
            <dt>{r.f.label}</dt>
            <dd>{r.text}</dd>
          </div>
        )
      )}
    </dl>
  );
}
