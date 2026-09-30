import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Document reading (PDF text, page rendering, OCR) runs in Node with native/worker code; keep it out of the bundle.
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas", "tesseract.js", "@tesseract.js-data/eng"],
  // Lets a second dev server (e.g. a test instance on another port) use its own build folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Directories, staff and the audit log moved under Settings; keep old links and bookmarks working.
  async redirects() {
    return [
      { source: "/directories", destination: "/settings/directories", permanent: false },
      { source: "/directories/:path*", destination: "/settings/directories/:path*", permanent: false },
      { source: "/staff", destination: "/settings/users", permanent: false },
      { source: "/audit", destination: "/settings/audit", permanent: false },
    ];
  },
  experimental: {
    // Credentialing documents and approval letters are uploaded through server actions (10 MB cap in lib/storage).
    serverActions: { bodySizeLimit: "11mb" },
  },
};

export default nextConfig;
