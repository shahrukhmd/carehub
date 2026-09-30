"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Result = {
  id: string;
  name: string;
  mrn: string;
  dob: string;
  phone: string | null;
  status: string;
  payer: string | null;
  next: string | null;
};

const SEARCH_BY: [string, string][] = [
  ["lastName", "Last name"],
  ["firstName", "First name"],
  ["dob", "Date of birth"],
  ["mrn", "MRN"],
  ["phone", "Phone"],
  ["memberId", "Member / policy ID"],
  ["account", "Account number"],
];

const dobLabel = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
};

// Slide-out patient search from the left menu (like the scheduler's search panel).
export function PatientSearchPanel({ canAdd }: { canAdd: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [by, setBy] = useState("lastName");
  const [inactive, setInactive] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (q.trim().length < 2) {
      setHint("Type at least 2 characters.");
      setResults(null);
      return;
    }
    setBusy(true);
    try {
      const params = new URLSearchParams({
        q,
        by,
        ...(inactive ? { inactive: "1" } : {}),
      });
      const res = await fetch(`/api/patients/search?${params}`);
      const data = await res.json();
      setResults(data.results ?? []);
      setHint(data.hint ?? null);
    } catch {
      setHint("Search failed — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="nav-search"
        onClick={() => setOpen(true)}
        aria-label="Search patients"
        title="Search patients"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-icon">
          <circle
            cx="11"
            cy="11"
            r="6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M16 16l4.5 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        <span className="nav-label">Search patients</span>
      </button>
      {open &&
        // Rendered on <body> so the menu's link styles don't apply inside the panel.
        createPortal(
          <div className="ps-overlay" onClick={() => setOpen(false)}>
            <aside
              className="ps-panel"
              role="dialog"
              aria-label="Patient search"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="ps-head">
                <strong>SEARCH</strong>
                {canAdd && (
                  <Link href="/patients/new" onClick={() => setOpen(false)}>
                    + ADD NEW
                  </Link>
                )}
                <button
                  type="button"
                  className="btn ghost gw-mini"
                  onClick={() => setOpen(false)}
                  aria-label="Close search"
                >
                  ✕
                </button>
              </div>
              <form onSubmit={search} className="stack">
                <input
                  ref={input}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={by === "dob" ? "MM/DD/YYYY" : "Search…"}
                  aria-label="Search text"
                />
                <div className="ps-row">
                  <label>
                    Search for
                    <select
                      value="patient"
                      onChange={() => undefined}
                      aria-label="Search for"
                    >
                      <option value="patient">Patient</option>
                    </select>
                  </label>
                  <label>
                    Search by
                    <select value={by} onChange={(e) => setBy(e.target.value)}>
                      {SEARCH_BY.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="ps-row">
                  <label className="checkbox-inline">
                    <input
                      type="checkbox"
                      checked={inactive}
                      onChange={(e) => setInactive(e.target.checked)}
                    />{" "}
                    Show inactive patients
                  </label>
                  <button className="btn" type="submit" disabled={busy}>
                    {busy ? "Searching…" : "Search"}
                  </button>
                </div>
              </form>
              {hint && <p className="muted">{hint}</p>}
              {results && (
                <ul className="ps-results">
                  {results.map((r) => (
                    <li key={r.id}>
                      <Link
                        href={`/patients/${r.id}`}
                        onClick={() => setOpen(false)}
                      >
                        <strong>{r.name}</strong>
                        {r.status !== "ACTIVE" && (
                          <span className="gw-tag gw-tag-muted">
                            {r.status.toLowerCase()}
                          </span>
                        )}
                      </Link>
                      <span className="muted">
                        {r.mrn} · DOB {dobLabel(r.dob)}
                        {r.phone ? ` · ${r.phone}` : ""}
                      </span>
                      <span className="muted">
                        {r.payer ?? "No insurance"} ·{" "}
                        {r.next
                          ? `Next visit ${new Date(r.next).toLocaleDateString()}`
                          : "No upcoming visit"}
                      </span>
                      <span className="ps-actions">
                        <Link
                          href={`/patients/${r.id}`}
                          onClick={() => setOpen(false)}
                        >
                          Chart
                        </Link>
                        <Link
                          href={`/schedule?patientId=${r.id}#book`}
                          onClick={() => setOpen(false)}
                        >
                          Schedule
                        </Link>
                      </span>
                    </li>
                  ))}
                  {results.length === 0 && (
                    <li className="muted">No patients found.</li>
                  )}
                </ul>
              )}
            </aside>
          </div>,
          document.body,
        )}
    </>
  );
}
