import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Native Node.js modules that must NOT be bundled by webpack/turbopack.
  // They need to be externalized so they resolve from node_modules at
  // runtime. Without this, Next.js standalone mode tries to bundle them,
  // fails silently, and the route handler returns 405 Method Not Allowed
  // because the route module never loads.
  serverExternalPackages: [
    "better-sqlite3",
    "pg",
    "pg-native",
    "xlsx",
    "openai",
    "z-ai-web-dev-sdk",
  ],
  // Allow large file uploads (CSV/XLSX up to 25MB). The default body size
  // limit in Next.js is 1MB which would reject most real-world files.
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
