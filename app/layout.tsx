import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/instrument-sans";
import "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Aqua",
    template: "%s · Aqua",
  },
  description: "Operations platform for sports academies.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Mirrors --color-marine in app/globals.css. Next's <meta name="theme-color">
  // metadata can't reference a CSS custom property — it needs a literal
  // value — so this one value is a deliberate, unavoidable duplicate of the
  // token. If --color-marine changes, update this to match.
  themeColor: "#0D3B36",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-deck text-ink font-sans antialiased">{children}</body>
    </html>
  );
}
