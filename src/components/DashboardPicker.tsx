"use client";

import { useState } from "react";

// "My view": tick the tiles to show. Saved per user by the form this sits in (hidden JSON field).
export function DashboardPicker({ tiles, initial, action }: { tiles: { key: string; title: string; group: string; about: string }[]; initial: string[]; action: (fd: FormData) => void | Promise<void> }) {
  const [chosen, setChosen] = useState<string[]>(initial);
  const groups = [...new Set(tiles.map((t) => t.group))];
  const toggle = (k: string) => setChosen((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));
  return (
    <form action={action} className="panel dp-form">
      <input type="hidden" name="tiles" value={JSON.stringify(chosen)} />
      <div className="dp-groups">
        {groups.map((g) => (
          <fieldset key={g} className="gw-fieldset">
            <legend>{g}</legend>
            {tiles
              .filter((t) => t.group === g)
              .map((t) => (
                <label key={t.key} className="checkbox-inline dp-row" title={t.about}>
                  <input type="checkbox" checked={chosen.includes(t.key)} onChange={() => toggle(t.key)} /> {t.title}
                </label>
              ))}
          </fieldset>
        ))}
      </div>
      <div className="gw-actions">
        <button className="btn" type="submit">
          Save my view
        </button>
        <button className="btn ghost" type="submit" name="intent" value="reset">
          Reset
        </button>
        <span className="muted">{chosen.length} tile{chosen.length === 1 ? "" : "s"} chosen</span>
      </div>
    </form>
  );
}
