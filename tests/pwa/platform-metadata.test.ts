import { describe, expect, it, vi } from "vitest";

// The operator console is not an installable app.
//
// The tenant app publishes a web app manifest (app/manifest.ts), and
// Next injects <link rel="manifest"> into every document that inherits
// the root layout — including the operator console's pages. The
// manifest DOCUMENT is never served on the platform host (it is not in
// OPS_ALLOWLIST), so the console is not installable either way, but
// its HTML should not advertise an installable application at all.
//
// The mechanism is a typed metadata override in the platform layout:
// Next renders the tag only when the resolved manifest value is truthy
// (next/dist/lib/metadata/generate/basic.js), and a child layout's
// metadata is merged over the root's (next/dist/lib/metadata/
// resolve-metadata.js), so `manifest: null` in the platform layout
// removes the tag from the console's pages and from nothing else.
//
// Agent-owned file (tests/pwa/**). It never touches tests/tier1/**.

// The layout reads the platform session to decide what to render. The
// metadata export is independent of it, but importing the module must
// not pull the platform session (and its database) into the test.
vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => ({ kind: "not_found" }),
  logoutPlatformAction: async () => ({ kind: "ok" }),
}));

describe("the operator console's metadata", () => {
  it("declares that the console is not an installable app", async () => {
    const layout = await import("@/app/(platform)/layout");
    expect(layout.metadata?.manifest).toBeNull();
  });

  it("changes nothing else about the console's metadata", async () => {
    // The console keeps the inherited title, description, theme colour
    // and viewport: only the manifest link is withdrawn.
    const layout = await import("@/app/(platform)/layout");
    expect(Object.keys(layout.metadata ?? {}).sort()).toEqual(["manifest"]);
  });
});
