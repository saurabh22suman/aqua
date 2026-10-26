import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APEX_ALLOWLIST, OPS_ALLOWLIST, isAllowed } from "@/lib/surface-paths";
import {
  PWA_BACKGROUND_COLOR,
  PWA_MANIFEST_PATH,
  PWA_THEME_COLOR,
  pwaManifest,
} from "@/lib/offline/pwa-manifest";

// The PWA contract (docs/design-system/pwa.md):
//   * a valid same-origin manifest with a stable id/name/short_name;
//   * a root entry that resolves to the caller's own authorized role
//     destination, never a token or a user id;
//   * standalone display/scope with background + theme colour;
//   * 192/512 icons including a maskable asset, sized truthfully;
//   * reachable on the tenant apex, and NOT on the operator console.
//
// This file is agent-owned (tests/pwa/**). It never touches
// tests/tier1/**.

/** The width/height declared in a PNG's IHDR chunk. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!bytes.subarray(0, 8).equals(signature)) throw new Error("not a PNG");
  if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") throw new Error("no IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("the tenant web app manifest", () => {
  it("declares a stable id, name, short name and a standalone display scope", () => {
    expect(pwaManifest.id).toBe("/");
    expect(pwaManifest.name).toBeTruthy();
    expect(pwaManifest.short_name).toBeTruthy();
    expect((pwaManifest.short_name as string).length).toBeLessThanOrEqual(12);
    expect(pwaManifest.display).toBe("standalone");
    expect(pwaManifest.scope).toBe("/");
    expect(pwaManifest.start_url).toBe("/");
  });

  it("starts at the bare entry point, which resolves to the caller's own role destination", () => {
    // "/" is the host's own door (app/route.ts): the signed-in user's home
    // or the sign-in screen. It carries no identity of its own.
    expect(pwaManifest.start_url).toBe("/");
    expect(pwaManifest.start_url).not.toContain("token");
    expect(pwaManifest.start_url).not.toContain("/p/");
  });

  it("carries no token, session, user id or signed link anywhere in its URLs", () => {
    const urls = [
      String(pwaManifest.start_url),
      String(pwaManifest.scope),
      String(pwaManifest.id),
      ...(pwaManifest.shortcuts ?? []).flatMap(shortcut => [String(shortcut.url)]),
    ];
    for (const url of urls) {
      expect(url.startsWith("/")).toBe(true);
      expect(url).not.toMatch(/\/p\//);
      expect(url).not.toMatch(/[0-9a-f]{32,}/i);
      expect(url).not.toMatch(/token|signature|session|scope=/i);
    }
  });

  it("declares background and theme colour that match the shell tokens", () => {
    expect(pwaManifest.theme_color).toBe(PWA_THEME_COLOR);
    expect(pwaManifest.background_color).toBe(PWA_BACKGROUND_COLOR);
    // The root layout's viewport.themeColor is the same literal; if the
    // foundation lane changes it, this test fails and both must move
    // together (the request to the foundation owner says exactly that).
    expect(String(pwaManifest.theme_color).toLowerCase()).toBe("#0d3b36");
  });

  it("declares 192 and 512 icons including a maskable asset", () => {
    const icons = pwaManifest.icons ?? [];
    const bySize = (size: string) => icons.filter(icon => icon.sizes === size);
    expect(bySize("192x192").length).toBeGreaterThanOrEqual(1);
    expect(bySize("512x512").length).toBeGreaterThanOrEqual(1);
    expect(icons.some(icon => String(icon.purpose).split(" ").includes("maskable"))).toBe(true);
    for (const icon of icons) {
      expect(icon.type).toBe("image/png");
      expect(String(icon.src).startsWith("/")).toBe(true);
    }
  });

  it("ships icon files whose real pixel size matches the declared size", () => {
    for (const icon of pwaManifest.icons ?? []) {
      const bytes = readFileSync(`public${String(icon.src)}`);
      const size = pngSize(bytes);
      const [width, height] = String(icon.sizes).split("x").map(Number);
      expect(size.width).toBe(width);
      expect(size.height).toBe(height);
    }
  });

  it("is not reachable on the ops surface", () => {
    // The platform host serves only what OPS_ALLOWLIST admits. Install
    // metadata must never be part of the operator console.
    expect(isAllowed(PWA_MANIFEST_PATH, OPS_ALLOWLIST)).toBe(false);
    for (const icon of pwaManifest.icons ?? []) {
      expect(isAllowed(String(icon.src), OPS_ALLOWLIST)).toBe(false);
    }
  });

  it("is reachable on the tenant apex — the surface admits the manifest and its icons", () => {
    // Without this the browser gets a 404 for the manifest and the app
    // can never be installed. The paths are public, same-origin assets;
    // the identity-scoped data never travels through them.
    expect(isAllowed(PWA_MANIFEST_PATH, APEX_ALLOWLIST)).toBe(true);
    for (const icon of pwaManifest.icons ?? []) {
      expect(isAllowed(String(icon.src), APEX_ALLOWLIST)).toBe(true);
    }
  });

  it("admits the icon directory as a whole, not one file at a time", () => {
    // The allowlist entry is a directory prefix, so a future icon
    // (a new maskable asset, an apple-touch icon) is admitted without
    // another routing change — and only on the tenant surface.
    expect(isAllowed("/icons/aqua-512.png", APEX_ALLOWLIST)).toBe(true);
    expect(isAllowed("/icons/anything-else.png", APEX_ALLOWLIST)).toBe(true);
    expect(isAllowed("/icons/aqua-512.png", OPS_ALLOWLIST)).toBe(false);
  });

  it("is a same-origin path served by the tenant surface", () => {
    expect(PWA_MANIFEST_PATH.startsWith("/")).toBe(true);
    expect(PWA_MANIFEST_PATH).not.toMatch(/^https?:/);
  });

  // Supplementary (written after the implementation, not a TDD proof):
  // the route handler serves exactly the manifest the module declares,
  // with the media type a browser expects.
  it("is served by the manifest route with the manifest media type", async () => {
    const route = await import("@/app/manifest.webmanifest/route");
    const response = route.GET();
    expect(response.headers.get("Content-Type")).toBe("application/manifest+json");
    expect(await response.json()).toEqual(pwaManifest);
  });
});
