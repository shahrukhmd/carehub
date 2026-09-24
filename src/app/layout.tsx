import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CareHub — Integrated EHR & PM",
  description: "All-in-one electronic health record and practice management for ambulatory clinics.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
