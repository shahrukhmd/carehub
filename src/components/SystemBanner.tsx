"use client";

import { useEffect, useState } from "react";

type Msg = { id: string; title: string; message: string; level: string; version: string };

// Live system messages; each can be dismissed for this browser until it's edited.
export function SystemBanner({ messages }: { messages: Msg[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      setHidden(new Set(JSON.parse(localStorage.getItem("ch_dismissed_msgs") || "[]")));
    } catch {
      // storage unavailable: show everything
    }
    setReady(true);
  }, []);
  const key = (m: Msg) => `${m.id}:${m.version}`;
  const shown = messages.filter((m) => !hidden.has(key(m)));
  if (!ready || shown.length === 0) return null;
  const dismiss = (m: Msg) => {
    const next = new Set(hidden).add(key(m));
    setHidden(next);
    try {
      localStorage.setItem("ch_dismissed_msgs", JSON.stringify([...next].slice(-100)));
    } catch {
      // ignore
    }
  };
  return (
    <div className="sys-banners" role="region" aria-label="System messages">
      {shown.map((m) => (
        <div key={m.id} className={`sys-banner sys-${m.level.toLowerCase()}`} role={m.level === "URGENT" ? "alert" : "status"}>
          <div>
            <strong>{m.title}</strong> <span>{m.message}</span>
          </div>
          <button type="button" className="btn ghost gw-mini" onClick={() => dismiss(m)} aria-label={`Dismiss ${m.title}`}>
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
