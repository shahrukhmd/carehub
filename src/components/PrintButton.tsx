"use client";

export function PrintButton() {
  return (
    <button className="btn" type="button" onClick={() => window.print()}>
      Print / Save as PDF
    </button>
  );
}
