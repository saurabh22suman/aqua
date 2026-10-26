import { pwaManifest } from "@/lib/offline/pwa-manifest";

// The tenant installable app's web app manifest.
//
// Served from a route handler rather than the `app/manifest.ts` file
// convention, for one reason: the file convention injects
// <link rel="manifest"> into every document that inherits the root
// layout — including the operator console — and no layout can
// override it (Next re-applies the convention after every metadata
// merge). The console is not an installable app, so the link is
// rendered by the tenant surface instead (components/pwa/manifest-link.tsx)
// and this route only has to serve the document.
//
// The URL is unchanged (/manifest.webmanifest) and the apex allowlist
// already admits it — the operator console does not (lib/surface-paths.ts).
//
// The content itself lives in lib/offline/pwa-manifest.ts so it can be
// asserted without a server (tests/pwa/manifest.test.ts).

export const dynamic = "force-static";

export function GET() {
  return new Response(JSON.stringify(pwaManifest), {
    headers: {
      "Content-Type": "application/manifest+json",
      // The manifest carries no identity; it may be cached but must be
      // revalidated so a released manifest change is picked up.
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
