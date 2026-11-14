import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // D3: self-contained server for the web container — Docker copies
  // .next/standalone plus public/ and .next/static (Next does not bundle
  // those into standalone automatically).
  output: "standalone",
  // Receipt fonts and PDFKit metrics are server resources, never web fonts.
  serverExternalPackages: ["pdfkit"],
  outputFileTracingIncludes: {
    "/*": ["./assets/receipt-fonts/**"],
  },
};

export default nextConfig;
