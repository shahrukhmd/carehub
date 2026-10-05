"use client";

import Link from "next/link";
import { useState } from "react";

type Card = { key: string; href: string; label: string; description: string };
type Group = { key: string; label: string; about: string; cards: Card[] };

// The settings home: every setting under its heading, with a box to find one by any word in its name or description.
export function SettingsHome({ groups }: { groups: Group[] }) {
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = groups
    .map((g) => ({ ...g, cards: g.cards.filter((c) => words.every((w) => `${c.label} ${c.description} ${g.label}`.toLowerCase().includes(w))) }))
    .filter((g) => g.cards.length > 0);

  return (
    <>
      <div className="st-find">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a setting — try “fee”, “password”, “consent”, “office hours”" aria-label="Find a setting" autoFocus />
        {q && (
          <span className="muted">
            {shown.reduce((n, g) => n + g.cards.length, 0)} match{shown.reduce((n, g) => n + g.cards.length, 0) === 1 ? "" : "es"}
          </span>
        )}
      </div>
      {shown.length === 0 && <p className="muted">No setting matches “{q}”.</p>}
      {shown.map((g) => (
        <section key={g.key} className="st-group">
          <div className="st-group-head">
            <h2>{g.label}</h2>
            <span className="muted">{g.about}</span>
          </div>
          <div className="st-cards">
            {g.cards.map((c) => (
              <Link key={c.key} href={c.href} className="panel st-card">
                <strong>{c.label}</strong>
                <span className="muted">{c.description}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
