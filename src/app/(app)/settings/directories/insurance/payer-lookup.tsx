"use client";

import { useEffect, useRef, useState } from "react";
import { insuranceTypeLabel } from "@/lib/format";
import type { PayerMatch } from "@/lib/payer-catalog";
import { searchPayerList, type PayerLookupResult } from "../payer-lookup-actions";

// Search the clearinghouse's payer list by payer ID or name; choosing a payer fills in the form below.
export function PayerLookup() {
  const box = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [result, setResult] = useState<PayerLookupResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [filled, setFilled] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const t = setTimeout(
      async () => {
        setBusy(true);
        try {
          const r = await searchPayerList(q);
          if (live) setResult(r);
        } finally {
          if (live) setBusy(false);
        }
      },
      q ? 250 : 0
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  function use(m: PayerMatch) {
    const form = box.current?.closest("form");
    if (!form) return;
    const done: string[] = [];
    const set = (name: string, value: string | null | undefined, label: string) => {
      const el = form.elements.namedItem(name);
      if (!value || !(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) return;
      el.value = value;
      done.push(label);
    };
    set("name", m.name, "name");
    // Each transaction goes out under the ID the clearinghouse gives it (one ID for all, or one each).
    set("payerCode", m.professional ? m.payerId : m.institutionalId, "claims ID");
    set("eraPayerId", m.eraId, "ERA ID");
    set("eligibilityPayerId", m.eligibilityId, "eligibility ID");
    set("insuranceType", m.insuranceType, "type");
    set("addressLine1", m.addressLine1, "address");
    set("addressLine2", m.addressLine2, "address line 2");
    set("city", m.city, "city");
    set("state", m.state, "state");
    set("zip", m.zip, "ZIP");
    set("phone", m.phone, "phone");
    // The display name is made again from the new name and type when the form is saved.
    const display = form.elements.namedItem("displayName");
    if (display instanceof HTMLInputElement) display.value = "";
    const missing = [
      !m.addressLine1 ? "mailing address (not in the payer list — take it from the member's card)" : "",
      !m.insuranceType ? "insurance type" : "",
      !m.eraId ? "ERA ID (not in the list for this payer)" : "",
      !m.eligibilityId ? "eligibility ID (not in the list for this payer)" : "",
    ].filter(Boolean);
    setFilled(`Filled from ${m.name} (${m.payerId}): ${done.join(", ")}.${m.addressFrom ? ` Address copied from the insurance already saved in ${m.addressFrom}.` : ""}${missing.length ? ` Still to enter: ${missing.join("; ")}.` : ""}${m.enrollmentNote ? ` ${m.enrollmentNote}.` : ""}`);
    setQ("");
  }

  return (
    <div className="pl-box" ref={box}>
      <label>
        <span>
          Find the payer <span className="muted">— by payer ID or name, {result?.source === "LIVE" ? `live from ${result.clearinghouse}` : `in the ${result?.clearinghouse ?? "clearinghouse"} payer list${result ? ` (${result.loaded.toLocaleString("en-US")} payers)` : ""}`}</span>
        </span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. 60054 or Aetna" autoComplete="off" onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} />
      </label>
      {result && result.loaded === 0 && result.source === "LIST" && (
        <p className="muted">
          No payer list is loaded for {result.clearinghouse} yet. An administrator loads it under Settings → Practice setup → Clearinghouse payer list.
        </p>
      )}
      {q.trim().length >= 2 && result && (result.loaded > 0 || result.source === "LIVE") && (
        <ul className="pl-results">
          {result.matches.length === 0 && !busy && <li className="muted">No payer matches “{q}”.</li>}
          {result.matches.map((m) => (
            <li key={m.id}>
              <button type="button" className="pl-pick" onClick={() => use(m)}>
                <strong>{m.name}</strong> <span className="pl-id">{m.payerId}</span>
                <span className="muted">
                  {[
                    m.professional ? `claims ${m.payerId}` : "",
                    m.institutionalId && m.institutionalId !== m.payerId ? `institutional ${m.institutionalId}` : "",
                    m.eraId ? `ERA ${m.eraId}` : "",
                    m.eligibilityId ? `eligibility ${m.eligibilityId}` : "",
                    m.standardId && m.standardId !== m.payerId ? `standard ID ${m.standardId}` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ") || "no electronic transactions"}
                  {m.insuranceType ? ` · ${insuranceTypeLabel[m.insuranceType]}` : ""}
                  {m.addressLine1 ? ` · ${[m.addressLine1, m.city, m.state].filter(Boolean).join(", ")}` : ""}
                </span>
                {m.relatedNames && <span className="muted pl-related">Also: {m.relatedNames.slice(0, 140)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {filled && <p className="notice-ok">{filled}</p>}
    </div>
  );
}
