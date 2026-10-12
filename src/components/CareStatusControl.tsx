"use client";

import { useState } from "react";

// The PCC team's status control in the gateway patient card: every column of the Patient care board in one dropdown,
// saved with the button next to it. Choosing "Unable to see" asks for the reason.
export function CareStatusControl({
  action,
  options,
  current,
  unableKey,
}: {
  action: (fd: FormData) => Promise<void>;
  options: { key: string; label: string }[];
  current: string;
  unableKey: string;
}) {
  const [status, setStatus] = useState(current);
  return (
    <form action={action} className="side-status-form">
      <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Patient care status">
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      {status === unableKey && current !== unableKey && (
        <input className="side-status-reason" name="note" required placeholder="Reason" aria-label="Why the patient can't be seen" />
      )}
      <button className="btn" type="submit" disabled={status === current}>
        Save
      </button>
    </form>
  );
}
