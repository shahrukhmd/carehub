import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Lets a second dev server (e.g. a test instance on another port) use its own build folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    // Credentialing documents and approval letters are uploaded through server actions (10 MB cap in lib/storage).
    serverActions: { bodySizeLimit: "11mb" },
  },
};

export default nextConfig;
