"use client";

import { useEffect } from "react";

// Outlines the form fields that were filled in from the uploaded documents so they are easy to check.
export function MarkPrefilled({ names }: { names: string[] }) {
  useEffect(() => {
    const marked: Element[] = [];
    for (const name of names) {
      for (const el of document.querySelectorAll(`form.reg-form [name="${CSS.escape(name)}"]`)) {
        // Checkbox groups (race) are outlined as a whole.
        const target = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? (el.closest("fieldset") ?? el) : el;
        target.classList.add("reg-auto");
        marked.push(target);
      }
    }
    return () => marked.forEach((el) => el.classList.remove("reg-auto"));
  }, [names]);
  return null;
}
