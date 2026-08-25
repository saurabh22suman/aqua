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
  themeColor: "#0D3B36",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-deck text-ink font-sans antialiased">{children}</body>
    </html>
  );
}
