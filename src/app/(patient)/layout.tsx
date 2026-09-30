import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

// Patient-facing pages (forms, reminders, surveys): no staff menu, not indexed by search engines.
export const metadata: Metadata = {
  title: "Patient forms",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export const dynamic = "force-dynamic";

export default function PatientLayout({ children }: { children: ReactNode }) {
  return <div className="pp-root">{children}</div>;
}
