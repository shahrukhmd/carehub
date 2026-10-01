"use client";

import { useState } from "react";

// Light / dark switch for the staff workspace. The choice lives in a cookie so the server renders the right theme.
export function ThemeToggle({ initial }: { initial: "light" | "dark" }) {
  const [theme, setTheme] = useState(initial);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => {
        setTheme(next);
        document.cookie = `ch_theme=${next}; path=/; max-age=31536000; samesite=lax`;
        document.querySelector(".app-shell")?.setAttribute("data-theme", next);
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {theme === "dark" ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        ) : (
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 7 7 0 1 0 20 14.5z" />
        )}
      </svg>
    </button>
  );
}
