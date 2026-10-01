"use client";

import { useRef, useState, useTransition } from "react";

type Result = { text: string; provider: string } | { error: string };

// "Draft with AI" for a text box in the same form. The draft is shown first; it only goes into the box when the
// user chooses to use it, and it is saved only when they save the form.
export function AiAssist({ action, label, target, mode = "replace" }: { action: () => Promise<Result>; label: string; target: string; mode?: "replace" | "append" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result | null>(null);

  const use = (text: string) => {
    const box = ref.current?.closest("form")?.querySelector<HTMLTextAreaElement>(`textarea[name="${target}"]`);
    if (!box) return;
    box.value = mode === "append" && box.value.trim() ? `${box.value.trimEnd()}\n\n${text}` : text;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.focus();
    setResult(null);
  };

  return (
    <div className="ai-assist" ref={ref}>
      <button type="button" className="ai-assist-btn" disabled={pending} onClick={() => start(async () => setResult(await action()))}>
        ✦ {pending ? "Working…" : label}
      </button>
      {result && "error" in result && <p className="ai-assist-error">{result.error}</p>}
      {result && "text" in result && (
        <div className="ai-assist-result">
          <pre>{result.text}</pre>
          <div className="gw-actions">
            <button type="button" className="btn secondary" onClick={() => use(result.text)}>
              {mode === "append" ? "Add to the box" : "Use this draft"}
            </button>
            <button type="button" className="btn ghost" onClick={() => setResult(null)}>
              Discard
            </button>
          </div>
          <span className="ai-assist-note">Drafted by AI ({result.provider}). Review and edit before saving — nothing is saved until you save the form.</span>
        </div>
      )}
    </div>
  );
}
