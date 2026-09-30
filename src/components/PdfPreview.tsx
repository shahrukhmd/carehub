"use client";

import { useEffect, useState } from "react";

// Some browsers' built-in PDF viewers rewrite an <iframe> before React hydrates; mounting it
// after load keeps the rest of the page from re-rendering.
export function PdfPreview({ src, title }: { src: string; title: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready ? <iframe src={src} title={title} /> : <div className="pd-preview-wait">Loading preview…</div>;
}
