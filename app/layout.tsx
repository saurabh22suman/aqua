import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
// Static weights only, latin subset only — DESIGN.md §1.3. Bricolage
// Grotesque is display-only (600 never renders at 400/500); Instrument
// Sans is body/emphasis (400, 500). latin-ext/vietnamese dropped: nothing
// in this product needs them today.
import "@fontsource/bricolage-grotesque/latin-600.css";
import "@fontsource/instrument-sans/latin-400.css";
import "@fontsource/instrument-sans/latin-500.css";
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
