"use client";

import { useState } from "react";

type Phrase = { id: string; text: string; normal: boolean };

function setText(el: HTMLTextAreaElement, text: string, mode: "replace" | "append") {
  const cur = el.value.trim();
  el.value = mode === "replace" || !cur ? text : `${cur}${/[.;]$/.test(cur) ? "" : "."} ${text}`;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
}

// Chips under an exam / ROS field: "Normal" fills the normal statement (replacing an empty field, otherwise
// appended); findings append. Shown only while the form is editable.
export function FindingPicker({ targetId, phrases }: { targetId: string; phrases: Phrase[] }) {
  const [more, setMore] = useState(false);
  const normal = phrases.find((p) => p.normal);
  const findings = phrases.filter((p) => !p.normal);
  const shown = more ? findings : findings.slice(0, 4);
  const put = (text: string, mode: "replace" | "append") => {
    const el = document.getElementById(targetId) as HTMLTextAreaElement | null;
    if (el && !el.disabled) setText(el, text, mode);
  };
  return (
    <span className="fp-row">
      {normal && (
        <button type="button" className="fp-chip fp-normal" onClick={() => put(normal.text, "append")} title={normal.text}>
          Normal
        </button>
      )}
      {shown.map((p) => (
        <button key={p.id} type="button" className="fp-chip" onClick={() => put(p.text, "append")} title={p.text}>
          {p.text.length > 42 ? `${p.text.slice(0, 40)}…` : p.text}
        </button>
      ))}
      {findings.length > 4 && (
        <button type="button" className="fp-chip fp-more" onClick={() => setMore(!more)}>
          {more ? "fewer" : `+${findings.length - 4} more`}
        </button>
      )}
    </span>
  );
}

// "All systems normal": fills every empty exam field that has a normal statement. "All systems negative":
// on the ROS form ticks every "denies" box and clears the "complains of" boxes.
export function QuickFill({ scope, kind }: { scope: string; kind: "EXAM" | "ROS" }) {
  const run = () => {
    const root = document.getElementById(scope);
    if (!root) return;
    if (kind === "EXAM") {
      root.querySelectorAll<HTMLTextAreaElement>("textarea[data-normal]").forEach((el) => {
        if (!el.disabled && !el.value.trim()) setText(el, el.dataset.normal ?? "", "replace");
      });
    } else {
      root.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((el) => {
        const label = el.closest("label")?.textContent ?? "";
        const group = el.closest(".df-field")?.querySelector(".df-label")?.textContent ?? "";
        if (/denies/i.test(group)) el.checked = true;
        else if (/complains/i.test(group)) el.checked = false;
        void label;
      });
    }
  };
  return (
    <button type="button" className="btn ghost gw-mini" onClick={run}>
      {kind === "EXAM" ? "All systems normal" : "All systems negative"}
    </button>
  );
}
