import type { MetadataRoute } from "next";

// The tenant installable app's web manifest.
//
// Where this lives: the PWA/offline subsystem owns lib/offline/** (see
// docs/design-system/delivery.md), and the manifest is that
// subsystem's public face. app/manifest.webmanifest/route.ts serves it
// at /manifest.webmanifest; the <link rel="manifest"> that points at it
// is rendered by the tenant surface (components/pwa/manifest-link.tsx),
// because Next's app/manifest.ts file convention would inject it into
// the operator console's HTML as well and no layout can override it.
//
// What the manifest must NOT contain (docs/design-system/pwa.md):
//   * a token, a user id, a session id or any signed link — the parent
//     magic-link surface is a credential, and a credential in an install
//     shortcut ends up in the OS launcher and in screenshots;
//   * a role-specific destination — every role has its own home, and
//     the launcher must not offer a surface the caller cannot open;
//   * anything about the operator console — the platform host does not
//     serve this path at all (see lib/surface-paths.ts), so there is no
//     installable manifest on ops.
//
// The start_url is the bare entry point "/" — the host's own door
// (app/route.ts) resolves it to the signed-in caller's own role home,
// or to the sign-in screen when there is no session.

/** Where the manifest is served from. Same-origin, apex only. */
export const PWA_MANIFEST_PATH = "/manifest.webmanifest";

/**
 * The manifest's theme colour. This is the same literal as the root
 * layout's viewport.themeColor (--color-marine) and the standalone task
 * bar colour iOS reads from the manifest. If the foundation lane changes
 * that token, this literal and the root layout must move together — the
 * integration request to the foundation owner says exactly that.
 */
export const PWA_THEME_COLOR = "#0D3B36";

/** The splash/background colour: --color-deck, the app's canvas. */
export const PWA_BACKGROUND_COLOR = "#EDF0EC";

/** Icon files, served from public/icons (see tests/pwa/tools/generate-icons.mjs). */
export const PWA_ICONS = {
  any192: "/icons/aqua-192.png",
  any512: "/icons/aqua-512.png",
  maskable512: "/icons/aqua-maskable-512.png",
  appleTouch: "/icons/aqua-apple-touch-icon.png",
} as const;

export const pwaManifest: MetadataRoute.Manifest = {
  id: "/",
  name: "Aqua — Academy Operations",
  short_name: "Aqua",
  description: "Attendance, fees and daily operations for your academy.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  theme_color: PWA_THEME_COLOR,
  background_color: PWA_BACKGROUND_COLOR,
  categories: ["business", "productivity"],
  icons: [
    { src: PWA_ICONS.any192, sizes: "192x192", type: "image/png", purpose: "any" },
    { src: PWA_ICONS.any512, sizes: "512x512", type: "image/png", purpose: "any" },
    { src: PWA_ICONS.maskable512, sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};
