import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
// Static weights only, latin subset only — DESIGN.md §1.3. Bricolage
// Grotesque is display-only (600 never renders at 400/500); Instrument
// Sans is body/emphasis (400, 500). latin-ext/vietnamese dropped: nothing
// in this product needs them today.
import "@fontsource/bricolage-grotesque/latin-600.css";
import "@fontsource/instrument-sans/latin-400.css";
import "@fontsource/instrument-sans/latin-500.css";
import { ServiceWorkerRegistrar } from "@/components/sw-registrar";
import { DemoBanner } from "@/components/demo-banner";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { THEME_COOKIE, resolveThemeCookie } from "@/lib/theme/storage";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Aqua",
    template: "%s · Aqua",
  },
  description: "Operations platform for sports academies.",
  // The tenant-PWA lane asked the foundation owner for the iOS
  // home-screen metadata (its handoff, "Integration requests" #2):
  // without appleWebApp an iOS web app opens without its own title and
  // status bar. The app is not renamed in this batch, so the title is
  // the same "Aqua" the manifest uses.
  appleWebApp: {
    capable: true,
    title: "Aqua",
    statusBarStyle: "default",
  },
  icons: {
    // The icon file ships in the tenant-PWA lane's diff
    // (public/icons/aqua-apple-touch-icon.png). Only the apple entry is
    // declared here: app/icon.svg remains the file-based icon.
    apple: "/icons/aqua-apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The tenant-PWA lane's request: without viewportFit "cover",
  // env(safe-area-inset-*) resolves to zero and the install/update
  // notices cannot clear a notch or the home indicator.
  viewportFit: "cover",
  // Mirrors --color-marine in app/globals.css. Next's <meta name="theme-color">
  // metadata can't reference a CSS custom property — it needs a literal
  // value — so this one value is a deliberate, unavoidable duplicate of the
  // token. If --color-marine changes, update this to match.
  themeColor: "#0D3B36",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // UI foundation — the theme preset is resolved on the server so the
  // first paint already carries the right palette (no flash of the
  // default before the client switches). The stored value is validated
  // against the two approved presets; anything else falls back to the
  // default. The preset is a display preference: it carries no identity
  // and no permission, and it never reaches an action or a query.
  const theme = resolveThemeCookie((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html lang="en" data-theme={theme}>
      <body className="bg-deck text-ink font-sans antialiased">
        <ThemeProvider theme={theme}>
          <DemoBanner />
          {children}
        </ThemeProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
