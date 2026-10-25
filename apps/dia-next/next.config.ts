import type { NextConfig } from "next";

/** The browser only calls /v1 on this app; Next forwards it to the Bun backend (no CORS, one origin). */
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  transpilePackages: ["@dia/types"],
  async rewrites() {
    return [{ source: "/v1/:path*", destination: `${BACKEND_URL}/v1/:path*` }];
  },
};

export default nextConfig;
