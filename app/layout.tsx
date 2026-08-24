import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Aqua",
    template: "%s · Aqua",
  },
  description: "Operations platform for sports academies.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
