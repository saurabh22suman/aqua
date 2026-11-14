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
  if (!isInstallableSurface(pathname) || /^\/clubs\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/install\/?$/.test(pathname)) return null;
  return <link rel="manifest" href={PWA_MANIFEST_PATH} />;
}

/** Render only after the explicit install page authorizes this tenant/source. */
export function TenantManifestLink({ tenantId, source }: { tenantId: string; source: "staff" | "member" | "guardian" }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(tenantId) || !["staff", "member", "guardian"].includes(source)) return null;
  return <link rel="manifest" href={`/clubs/${tenantId}/manifest.webmanifest?source=${source}`} crossOrigin="use-credentials" />;
}
