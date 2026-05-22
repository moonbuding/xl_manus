import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "*": [".manusxl-data/**/*"]
  },
  output: "standalone",
  reactStrictMode: true
};

export default nextConfig;
