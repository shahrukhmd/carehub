"use client";

import { useEffect, useRef, useState } from "react";

// Charting tools on every note field of the page: dot-phrase macros (type ".shortcut" then a space to expand,
// with {patient}, {age}, {sex}, {today} and {vitals} placeholders filled in) and dictation with the browser's
// speech recognition, appended to the last focused text area. A medical speech vendor can replace the
// recogniser behind the same button.

export type MacroItem = { shortcut: string; text: string; section: string };
type Ctx = { patient: string; age: string; sex: string; today: string; vitals: string };

type Recognition = { start: () => void; stop: () => void; continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };

export function ChartTools({ macros, context }: { macros: MacroItem[]; context: Ctx }) {
  const target = useRef<HTMLTextAreaElement | null>(null);
  const rec = useRef<Recognition | null>(null);
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const [picker, setPicker] = useState<{ x: number; y: number; items: MacroItem[]; prefix: string } | null>(null);

  const fill = (text: string) =>
    text.replace(/\{(patient|age|sex|today|vitals)\}/gi, (_, k: string) => context[k.toLowerCase() as keyof Ctx] ?? "");

  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      if (e.target instanceof HTMLTextAreaElement) target.current = e.target;
    };
    const onInput = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLTextAreaElement)) return;
      target.current = el;
      const pos = el.selectionStart ?? el.value.length;
      const before = el.value.slice(0, pos);
      // ".short " -> expansion; ".sho" -> picker of matching shortcuts.
      const m = before.match(/(^|\s)\.([a-z0-9_-]{1,40})(\s)$/i);
      if (m) {
        const hit = macros.find((x) => x.shortcut.toLowerCase() === m[2].toLowerCase());
        if (hit) {
          const start = before.length - m[2].length - 2;
          const expanded = fill(hit.text);
          el.value = el.value.slice(0, start) + expanded + el.value.slice(pos);
          el.selectionStart = el.selectionEnd = start + expanded.length;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          setPicker(null);
          return;
        }
      }
      const partial = before.match(/(^|\s)\.([a-z0-9_-]{1,40})$/i);
      if (partial && macros.length) {
        const items = macros.filter((x) => x.shortcut.toLowerCase().startsWith(partial[2].toLowerCase())).slice(0, 8);
        if (items.length) {
          const r = el.getBoundingClientRect();
          setPicker({ x: r.left + window.scrollX, y: r.bottom + window.scrollY, items, prefix: partial[2] });
          return;
        }
      }
      setPicker(null);
    };
    document.addEventListener("focusin", onFocus);
    document.addEventListener("input", onInput);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("input", onInput);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [macros, context]);

  const insertMacro = (m: MacroItem) => {
    const el = target.current;
    if (!el || !picker) return;
    const pos = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, pos);
    const start = before.length - picker.prefix.length - 1;
    const expanded = fill(m.text);
    el.value = el.value.slice(0, start) + expanded + el.value.slice(pos);
    el.focus();
    el.selectionStart = el.selectionEnd = start + expanded.length;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    setPicker(null);
  };

  const toggleDictation = () => {
    if (listening) {
      rec.current?.stop();
      setListening(false);
      return;
    }
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setSupported(false);
      return;
    }
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = false;
    r.lang = "en-US";
    r.onresult = (e) => {
      const el = target.current ?? document.querySelector("textarea");
      if (!el) return;
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript;
      if (!text) return;
      const sep = el.value && !/\s$/.test(el.value) ? " " : "";
      el.value += sep + text.trim();
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  };

  return (
    <>
      <div className="ct-bar no-print" role="toolbar" aria-label="Charting tools">
        <button type="button" className={`btn ghost gw-mini${listening ? " ct-live" : ""}`} onClick={toggleDictation} title="Dictate into the note field you last clicked (browser speech recognition)">
          {listening ? "● Listening… click to stop" : "🎤 Dictate"}
        </button>
        {!supported && <span className="muted cn-small">Speech recognition is not available in this browser.</span>}
        {macros.length > 0 && (
          <span className="muted cn-small">
            Dot phrases: type <code>.shortcut</code> then a space ({macros.length} available)
          </span>
        )}
      </div>
      {picker && (
        <ul className="ct-picker" style={{ left: picker.x, top: picker.y }} role="listbox">
          {picker.items.map((m) => (
            <li key={m.shortcut}>
              <button type="button" onClick={() => insertMacro(m)}>
                <strong>.{m.shortcut}</strong> <span className="muted">{m.text.slice(0, 60)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
