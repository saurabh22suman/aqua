// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ManifestLink } from "@/components/pwa/manifest-link";
import { PWA_MANIFEST_PATH } from "@/lib/offline/pwa-manifest";

// The manifest link is the tenant surface's installability contract.
//
// Next's `app/manifest.ts` file convention injects <link rel="manifest">
// into EVERY document that inherits the root layout — the operator
// console included — and a layout's `metadata.manifest` cannot
// override it (verified against Next 15.5.24: the convention is
// re-applied after every metadata merge). So the manifest is served
// from a route handler and the link is rendered where it belongs:
// the tenant surface.
//
// React 19 hoists a rendered <link> into the document head, so the
// assertions look at document.head — that placement is part of the
// contract (Chrome reads the manifest link from the document).
//
// Agent-owned file (tests/pwa/**). It never touches tests/tier1/**.

afterEach(() => cleanup());

function manifestLink(): Element | null {
  return document.head.querySelector('link[rel="manifest"]');
}

describe("the manifest link", () => {
  it("links the manifest on the tenant surface", () => {
    render(<ManifestLink pathname="/login" />);
    const link = manifestLink();
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe(PWA_MANIFEST_PATH);
  });

  it("links the manifest for a signed-in tenant surface too", () => {
    render(<ManifestLink pathname="/owner" />);
    expect(manifestLink()).not.toBeNull();
  });

  it("never links the manifest on the operator console", () => {
    render(<ManifestLink pathname="/ops" />);
    expect(manifestLink()).toBeNull();
  });

  it("never links the manifest on a signed parent link", () => {
    // A parent link is a credential; it must stay free of install
    // metadata.
    render(<ManifestLink pathname="/p/9f2c-secret-token" />);
    expect(manifestLink()).toBeNull();
  });
});
