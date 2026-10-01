"use client";

export function PrintButton({ label = "Print / Save as PDF", className = "btn" }: { label?: string; className?: string }) {
  return (
    <button className={className} type="button" onClick={() => window.print()}>
      {label}
    </button>
  );
}
