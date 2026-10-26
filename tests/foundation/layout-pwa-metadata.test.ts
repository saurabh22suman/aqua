// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// UI foundation — root metadata for the installable tenant PWA.
//
// The tenant-PWA lane asked the foundation owner (this lane) for two
// root-metadata additions, because app/layout.tsx is shared and the PWA
// lane may not edit it (tenant-pwa handoff, "Integration requests" #2):
//
//   - viewport: { viewportFit: "cover" } — without it
//     env(safe-area-inset-*) resolves to zero and the PWA notices
//     cannot clear a notch or the home indicator;
//   - metadata.appleWebApp { capable, title, statusBarStyle } and an
//     apple-touch-icon link to /icons/aqua-apple-touch-icon.png (the
//     icon file ships in the PWA lane's diff) for the iOS home-screen
//     icon.
//
// The app is NOT renamed in this batch, so the appleWebApp title stays
// "Aqua" — the same string the PWA manifest uses.
//
// RED status at the time of writing: the root layout declared neither
// viewportFit nor appleWebApp nor an apple-touch-icon.

vi.mock("@/lib/env", () => ({
  env: { AQUA_DEPLOYMENT_STAGE: "development", WHATSAPP_PROVIDER: "mock" },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

import { metadata, viewport } from "@/app/layout";

describe("root PWA metadata", () => {
  it("opts into the safe area so the shell can clear a notch", () => {
    expect(viewport.viewportFit).toBe("cover");
  });

  it("keeps the theme colour aligned with the manifest colour", () => {
    expect(viewport.themeColor).toBe("#0D3B36");
  });

  it("declares the iOS web-app metadata", () => {
    expect(metadata.appleWebApp).toEqual({
      capable: true,
      title: "Aqua",
      statusBarStyle: "default",
    });
  });

  it("links the apple-touch-icon the PWA lane ships", () => {
    // Next's Icons type is a union (a single icon, a list, or a record
    // keyed by rel); the declaration here is the record form.
    const icons = metadata.icons as { apple?: string } | undefined;
    expect(icons?.apple).toBe("/icons/aqua-apple-touch-icon.png");
  });
});
