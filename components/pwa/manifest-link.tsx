"use client";

import { isInstallableSurface } from "@/lib/offline/install-prompt";
import { PWA_MANIFEST_PATH } from "@/lib/offline/pwa-manifest";

// The tenant surface's installability link.
//
// Why this is rendered here rather than by Next's `app/manifest.ts`
// file convention: the convention injects <link rel="manifest"> into
// every document that inherits the root layout — the operator console
// included — and no layout can override it. In Next 15.5.24 the
// convention is re-applied after every metadata merge, so even
// `metadata: { manifest: null }` in the root layout, or in a child
// layout, leaves the tag in the document (verified on 15.5.24: a
// child's `manifest: null`, the root's `manifest: null`, and a child's
// `manifest: "…"` all leave the file convention's link in place).
//
// So the manifest is served by a route handler (app/manifest.webmanifest)
// and the link is rendered where it belongs: on the tenant surface.
// The console's own typed override (app/(platform)/layout.tsx) stays as
// the framework-level guard, so a manifest declared in the root layout
// later is withdrawn there too.
//
// The operator console is not an installable app, and a signed parent
// link is a credential — neither may carry install metadata.

export type ManifestLinkProps = {
  /** The current path. */
  pathname: string;
};

export function ManifestLink({ pathname }: ManifestLinkProps) {
  if (!isInstallableSurface(pathname)) return null;
  return <link rel="manifest" href={PWA_MANIFEST_PATH} />;
}
