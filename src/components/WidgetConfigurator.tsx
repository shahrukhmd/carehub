"use client";

import { useState } from "react";

type Widget = { key: string; title: string; span: number; about: string };

// Patient dashboard configuration: pick widgets from the list, order them, remove them. The order is posted as JSON.
export function WidgetConfigurator({ all, initial, canCopy, cancelHref }: { all: Widget[]; initial: string[]; canCopy: boolean; cancelHref: string }) {
  const [active, setActive] = useState(initial);
  const byKey = new Map(all.map((w) => [w.key, w]));
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= active.length) return;
    const next = [...active];
    [next[i], next[j]] = [next[j], next[i]];
    setActive(next);
  };

  return (
    <div className="pd-shell">
      <aside className="pd-side">
        <h4 className="wc-title">Available widgets</h4>
        <p className="muted">Click a widget to place it on the dashboard.</p>
        <ul className="wc-list">
          {all.map((w) => {
            const on = active.includes(w.key);
            return (
              <li key={w.key}>
                <button type="button" disabled={on} onClick={() => setActive([...active, w.key])} title={w.about}>
                  {w.title} <span className="muted">{on ? "(Active)" : w.span > 1 ? `(${w.span} columns)` : ""}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      <div className="pd-main">
        <div className="pd-head">
          <h1>Patient dashboard configuration</h1>
        </div>
        <p className="muted">This layout is yours: it is used for every patient you open.</p>
        <input type="hidden" name="widgets" value={JSON.stringify(active)} />
        {active.length === 0 ? (
          <section className="panel">
            <p className="muted">No widgets on the dashboard — add some from the list on the left.</p>
          </section>
        ) : (
          <div className="pd-grid">
            {active.map((k, i) => {
              const w = byKey.get(k);
              if (!w) return null;
              return (
                <section key={k} className="pd-widget wc-widget" style={{ gridColumn: `span ${w.span}` }}>
                  <header>
                    <h2>{w.title}</h2>
                    <span className="wc-tools">
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${w.title} earlier`}>
                        ←
                      </button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === active.length - 1} aria-label={`Move ${w.title} later`}>
                        →
                      </button>
                      <button type="button" onClick={() => setActive(active.filter((x) => x !== k))}>
                        Remove
                      </button>
                    </span>
                  </header>
                  <p className="muted">{w.about}</p>
                </section>
              );
            })}
          </div>
        )}
        <div className="wc-actions">
          <button className="btn ghost" type="submit" name="intent" value="reset">
            Reset to default
          </button>
          {canCopy && (
            <button className="btn secondary" type="submit" name="intent" value="copy" title="Save this layout for yourself and every staff member in this practice">
              Copy dashboard configuration to all staff
            </button>
          )}
          <a className="btn secondary" href={cancelHref}>
            Cancel
          </a>
          <button className="btn" type="submit" name="intent" value="save">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
