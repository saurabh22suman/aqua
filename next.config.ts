import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // D3: self-contained server for the web container — Docker copies
  // .next/standalone plus public/ and .next/static (Next does not bundle
  // those into standalone automatically).
  output: "standalone",
};

export default nextConfig;
