"use client";

import { useEffect, useRef, useState } from "react";
import type { CodeHit, CodeSet } from "@/lib/master-codes";
import { lookupCodes } from "@/app/(app)/settings/code-library/actions";

// Search the code library by code or words; choosing a code fills the form's code and description fields.
export function CodeLookup({ sets, placeholder, codeField = "code", descriptionField = "description" }: { sets: CodeSet[]; placeholder: string; codeField?: string; descriptionField?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CodeHit[] | null>(null);
  const key = sets.join(",");

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits(null);
      return;
    }
    let live = true;
    const t = setTimeout(async () => {
      const r = await lookupCodes(q, key.split(",") as CodeSet[]);
      if (live) setHits(r);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, key]);

  function use(h: CodeHit) {
    const form = box.current?.closest("form");
    const set = (name: string, value: string) => {
      const el = form?.elements.namedItem(name);
      if (el instanceof HTMLInputElement) el.value = value;
    };
    set(codeField, h.code);
    set(descriptionField, h.description.slice(0, 300));
    setQ("");
    const fee = form?.elements.namedItem("fee");
    if (fee instanceof HTMLInputElement) fee.focus();
  }

  return (
    <div className="cl-box" ref={box}>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Find a code in the code library" autoComplete="off" onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} />
      {hits && (
        <ul className="pl-results">
          {hits.length === 0 && <li className="muted">No code matches “{q}”. Load the code sets under Settings → Code library, or type the code below.</li>}
          {hits.map((h) => (
            <li key={`${h.codeSet}-${h.code}`}>
              <button type="button" className="pl-pick" onClick={() => use(h)}>
                <span>
                  <strong>{h.code}</strong> <span className="pl-id">{h.codeSet === "ICD10" ? "ICD-10" : h.codeSet}</span>
                </span>
                <span className="muted">{h.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
