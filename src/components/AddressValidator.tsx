"use client";

import { useState } from "react";

type Fields = { line1: string; line2?: string; city: string; state: string; zip: string; county?: string };
type Result = {
  status: "VALID" | "CORRECTED" | "NOT_FOUND" | "ERROR";
  provider?: "USPS" | "CENSUS";
  address: { line1: string; line2: string; city: string; state: string; zip: string; zip4?: string; county?: string } | null;
  changes: string[];
  deliverable?: boolean;
  vacant?: boolean;
  message?: string;
};

// "Validate address" under an address block: reads the block's inputs from the surrounding form, asks the
// server (USPS when configured, else the Census geocoder), shows what would change, and fills the inputs on
// "Use this address". `fields` are the input names of the block.
export function AddressValidator({ fields }: { fields: Fields }) {
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);

  const input = (btn: HTMLElement, name: string | undefined) => (name ? btn.closest("form")?.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`) ?? null : null);

  const run = async (btn: HTMLElement) => {
    setBusy(true);
    setApplied(false);
    try {
      const get = (n?: string) => input(btn, n)?.value ?? "";
      const r = await fetch("/api/address/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ line1: get(fields.line1), line2: get(fields.line2), city: get(fields.city), state: get(fields.state), zip: get(fields.zip) }),
      });
      setRes((await r.json()) as Result);
    } catch {
      setRes({ status: "ERROR", address: null, changes: [], message: "Could not reach the address service." });
    } finally {
      setBusy(false);
    }
  };

  const apply = (btn: HTMLElement) => {
    if (!res?.address) return;
    const set = (n: string | undefined, v: string) => {
      const el = input(btn, n);
      if (!el) return;
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set(fields.line1, res.address.line1);
    if (fields.line2) set(fields.line2, res.address.line2);
    set(fields.city, res.address.city);
    set(fields.state, res.address.state);
    set(fields.zip, res.address.zip4 ? `${res.address.zip}-${res.address.zip4}` : res.address.zip);
    if (fields.county && res.address.county) set(fields.county, res.address.county);
    setApplied(true);
  };

  return (
    <div className="av">
      <div className="av-row">
        <button type="button" className="btn ghost gw-mini" disabled={busy} onClick={(e) => run(e.currentTarget)}>
          {busy ? "Checking…" : "Validate address"}
        </button>
        {res && (
          <span className={`gw-tag gw-tag-${res.status === "VALID" ? "ok" : res.status === "CORRECTED" ? "warn" : "bad"}`}>
            {res.status === "VALID" ? "Address verified" : res.status === "CORRECTED" ? "Standardized form found" : res.status === "NOT_FOUND" ? "Not found" : "Service error"}
            {res.provider ? ` · ${res.provider === "USPS" ? "USPS" : "US Census"}` : ""}
          </span>
        )}
        {res?.deliverable === false && <span className="gw-tag gw-tag-bad">USPS: not deliverable as entered</span>}
        {res?.vacant && <span className="gw-tag gw-tag-warn">USPS: address vacant</span>}
      </div>
      {res?.message && <p className="muted av-msg">{res.message}</p>}
      {res?.address && res.status === "VALID" && fields.county && res.address.county && !applied && (
        <div className="av-row av-msg">
          <span className="muted">County: {res.address.county}</span>
          <button type="button" className="btn ghost gw-mini" onClick={(e) => apply(e.currentTarget)}>
            Fill county
          </button>
        </div>
      )}
      {res?.address && res.status === "CORRECTED" && !applied && (
        <div className="av-fix">
          <div>
            <strong>
              {res.address.line1}
              {res.address.line2 ? `, ${res.address.line2}` : ""}, {res.address.city}, {res.address.state} {res.address.zip}
              {res.address.zip4 ? `-${res.address.zip4}` : ""}
              {fields.county && res.address.county ? ` · ${res.address.county} County` : ""}
            </strong>
            <ul className="muted">
              {res.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          <button type="button" className="btn secondary gw-mini" onClick={(e) => apply(e.currentTarget)}>
            Use this address
          </button>
        </div>
      )}
      {applied && <p className="muted av-msg">Address updated — save the form to keep it.</p>}
    </div>
  );
}
