"use client";

import { useEffect, useRef, type ReactNode } from "react";

// A top-bar panel (facility switcher, profile): opens from its trigger, closes on Escape, a click outside, or any
// element inside marked data-close.
export function Popover({ className, trigger, label, children }: { className?: string; trigger: ReactNode; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = () => ref.current?.removeAttribute("open");
    const onPointer = (e: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && ref.current?.open) {
        close();
        ref.current.querySelector("summary")?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element).closest("[data-close]")) close();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    const el = ref.current;
    el?.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      el?.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <details ref={ref} className={`popover${className ? ` ${className}` : ""}`}>
      <summary aria-label={label}>{trigger}</summary>
      <div className="popover-panel">{children}</div>
    </details>
  );
}
