import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: process.env.BEVOR_NEXT_DIST_DIR || ".next",
  turbopack: { root: fileURLToPath(new URL("..", import.meta.url)) },
};
export default nextConfig;
