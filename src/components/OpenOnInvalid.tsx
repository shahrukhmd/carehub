"use client";

import { useEffect } from "react";

// A required field inside a collapsed section can't be focused, so the browser blocks the save without saying why.
// This opens the section the moment a field in it fails validation.
export function OpenOnInvalid() {
  useEffect(() => {
    const open = (e: Event) => {
      let el = (e.target as HTMLElement | null)?.closest("details");
      while (el) {
        el.open = true;
        el = el.parentElement?.closest("details") ?? null;
      }
    };
    document.addEventListener("invalid", open, true);
    return () => document.removeEventListener("invalid", open, true);
  }, []);
  return null;
}
