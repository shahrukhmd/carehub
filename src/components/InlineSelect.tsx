"use client";

import { useRef, useState } from "react";

// A dropdown that saves as soon as it changes (grid cells such as the UltraMist tracker's status column). The
// surrounding form posts to the given server action; the current value is shown as a coloured pill when read-only.
export function InlineSelect({
  action,
  name,
  value,
  options,
  tone,
  readOnly,
  placeholder = "—",
  hidden = {},
  ariaLabel,
}: {
  action: (fd: FormData) => Promise<void>;
  name: string;
  value: string;
  options: { key: string; label: string; tone?: string }[];
  // Background colour for the current value (a hex colour); omitted = plain.
  tone?: string | null;
  readOnly?: boolean;
  placeholder?: string;
  hidden?: Record<string, string>;
  ariaLabel: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [current, setCurrent] = useState(value);
  const label = options.find((o) => o.key === current)?.label ?? (current || placeholder);
  if (readOnly) {
    return (
      <span className="um-pill" style={tone ? { background: tone } : undefined}>
        {label}
      </span>
    );
  }
  return (
    <form ref={form} action={action} className="inline-select">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <select
        name={name}
        value={current}
        aria-label={ariaLabel}
        className="um-pill"
        style={tone ? { background: tone } : undefined}
        onChange={(e) => {
          setCurrent(e.target.value);
          form.current?.requestSubmit();
        }}
      >
        {!options.some((o) => o.key === current) && <option value={current}>{current ? label : placeholder}</option>}
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </form>
  );
}
