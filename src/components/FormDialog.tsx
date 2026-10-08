"use client";

import { useRef, type ReactNode } from "react";

// A button that opens a form in a centered dialog (the guide's "forms open in a centered dialog"). The form inside
// is the page's own server-rendered form; the dialog closes as soon as it is submitted, and Escape, the × button,
// a click on the dimmed backdrop or a button marked data-dialog-close close it without saving.
export function FormDialog({
  label,
  title,
  subtitle,
  variant = "primary",
  children,
}: {
  label: ReactNode;
  title: string;
  subtitle?: string;
  variant?: "primary" | "secondary";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className={`btn${variant === "secondary" ? " secondary" : ""}`} onClick={() => ref.current?.showModal()}>
        {label}
      </button>
      <dialog
        ref={ref}
        className="form-dialog"
        aria-label={title}
        onClick={(e) => {
          // A click on the backdrop lands on the dialog element itself; a Cancel button in the form is marked data-dialog-close.
          if (e.target === ref.current || (e.target as Element).closest("[data-dialog-close]")) ref.current?.close();
        }}
        onSubmit={() => ref.current?.close()}
      >
        <div className="form-dialog-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          <button type="button" className="popover-close" aria-label="Close" onClick={() => ref.current?.close()}>
            ×
          </button>
        </div>
        {children}
      </dialog>
    </>
  );
}
