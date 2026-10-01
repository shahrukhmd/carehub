"use client";

import { useState } from "react";

// Electronic signature by typed name: the signer types their full legal name and sees it as their signature.
// The name goes to the server as plain text; the server stamps who signed and when.
export function TypedSignature({ name, initial, signedAt }: { name: string; initial?: string | null; signedAt?: string | null }) {
  const [value, setValue] = useState(initial ?? "");
  const typed = value.trim();
  return (
    <div className="sig-typed">
      <input
        type="text"
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Type your full legal name"
        autoComplete="name"
        maxLength={120}
        aria-label="Type your full legal name to sign"
      />
      <div className={`sig-typed-preview${typed ? "" : " empty"}`} aria-hidden="true">
        {typed || "Your signature will appear here"}
      </div>
      <span className="sig-typed-note">
        {typed && initial === value && signedAt
          ? `Signed ${signedAt}. Change the name to sign again.`
          : "By typing my name I agree that it is my electronic signature, with the same effect as signing on paper."}
      </span>
    </div>
  );
}
