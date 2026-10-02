"use client";

import { useMemo, useState } from "react";

type Option = { id: string; label: string; hint?: string };

// A long pick list (sites, providers, insurances): filter box, select all / clear, and the picked ones first.
// The ticked ids are submitted under `name`. Nothing ticked means "all" when `emptyMeansAll` is set.
export function CheckList({ name, options, selected, emptyMeansAll = false, noun }: { name: string; options: Option[]; selected: string[]; emptyMeansAll?: boolean; noun: string }) {
  const [picked, setPicked] = useState(() => new Set(selected));
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return options.filter((o) => !needle || o.label.toLowerCase().includes(needle) || (o.hint ?? "").toLowerCase().includes(needle));
  }, [options, q]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setShown = (on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const o of shown) if (on) next.add(o.id);
      else next.delete(o.id);
      return next;
    });

  return (
    <div className="ck-list">
      {[...picked].map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
      <div className="ck-bar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Filter ${noun}s`} aria-label={`Filter ${noun}s`} />
        <button type="button" className="btn ghost gw-mini" onClick={() => setShown(true)}>
          Select {q ? "shown" : "all"}
        </button>
        <button type="button" className="btn ghost gw-mini" onClick={() => setShown(false)}>
          Clear {q ? "shown" : "all"}
        </button>
        <strong>{picked.size === 0 && emptyMeansAll ? `All ${noun}s` : `${picked.size} of ${options.length} selected`}</strong>
      </div>
      <div className="ck-scroll">
        {shown.map((o) => (
          <label key={o.id} className={picked.has(o.id) ? "ck-on" : undefined}>
            <input type="checkbox" checked={picked.has(o.id)} onChange={() => toggle(o.id)} />
            <span>{o.label}</span>
            {o.hint ? <span className="muted">{o.hint}</span> : null}
          </label>
        ))}
        {shown.length === 0 && <p className="muted">{options.length === 0 ? `No ${noun}s set up yet.` : `No ${noun} matches “${q}”.`}</p>}
      </div>
    </div>
  );
}
