"use client";

import { useEffect, useRef, useState } from "react";

type Hit = { id: string; name: string; mrn: string; dob: string; payer: string | null; status: string };

// A patient field that searches as you type (last name, "Last, First", MRN, or a date of birth) instead of a
// dropdown of every patient. The chosen patient's id goes in the hidden input the form reads.
export function PatientPicker({ name = "patientId", initial, required = true, placeholder = "Type last name, \"Last, First\", MRN or DOB" }: { name?: string; initial: { id: string; name: string; mrn: string } | null; required?: boolean; placeholder?: string }) {
  const [chosen, setChosen] = useState(initial);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setBusy(true);
      try {
        const by = /^\d{1,2}[/-]\d{1,2}[/-]\d{4}$|^\d{4}-\d{2}-\d{2}$/.test(term) ? "dob" : /^[A-Za-z]{0,3}\d{3,}$/.test(term) ? "mrn" : "lastName";
        const r = await fetch(`/api/patients/search?q=${encodeURIComponent(term)}&by=${by}`);
        const data = (await r.json()) as { results?: Hit[] };
        setHits(data.results ?? []);
        setOpen(true);
      } catch {
        setHits([]);
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  // The form can't go without a chosen patient: typing a name is not choosing one.
  useEffect(() => {
    const form = box.current?.closest("form");
    if (!form) return;
    const guard = (e: Event) => {
      if (chosen) return;
      e.preventDefault();
      const input = box.current?.querySelector<HTMLInputElement>('input[type="search"]');
      input?.setCustomValidity("Pick the patient from the search results");
      input?.reportValidity();
      setTimeout(() => input?.setCustomValidity(""), 1500);
    };
    form.addEventListener("submit", guard);
    return () => form.removeEventListener("submit", guard);
  }, [chosen]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className="pk" ref={box}>
      <input type="hidden" name={name} value={chosen?.id ?? ""} required={required} />
      {chosen ? (
        <div className="pk-chosen">
          <strong>{chosen.name}</strong> <span className="muted">· {chosen.mrn}</span>
          <button type="button" className="btn ghost gw-mini" onClick={() => { setChosen(null); setQ(""); }}>
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => hits.length && setOpen(true)}
            placeholder={placeholder}
            aria-label="Find patient"
            autoComplete="off"
            required={required}
          />
          {open && (q.trim().length >= 2) && (
            <ul className="pk-list" role="listbox">
              {busy && hits.length === 0 && <li className="muted">Searching…</li>}
              {!busy && hits.length === 0 && <li className="muted">No patient matches. Try the last name, &ldquo;Last, First&rdquo;, the MRN or the date of birth.</li>}
              {hits.map((h) => (
                <li key={h.id} role="option" aria-selected="false">
                  <button type="button" onClick={() => { setChosen({ id: h.id, name: h.name, mrn: h.mrn }); setOpen(false); }}>
                    <strong>{h.name}</strong> <span className="muted">· {h.mrn} · DOB {h.dob}{h.payer ? ` · ${h.payer}` : ""}{h.status !== "ACTIVE" ? ` · ${h.status.toLowerCase()}` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
