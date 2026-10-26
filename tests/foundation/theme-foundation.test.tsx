// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

// UI foundation — theme contract.
//
// The human decision (docs/design-system/README.md) is TWO LIGHT presets
// only: Mint Garden (default) and Lavender Club. The preset is a personal
// display preference, not tenant branding, so it must never influence
// authorization or a tenant's data.
//
// This file pins the behaviour that can be observed from the server:
//   - the root layout resolves the preset from a validated enum,
//   - an unknown/stale stored value falls back to the default instead of
//     throwing or rendering an unstyled surface,
//   - no first-paint flash: the resolved preset is rendered onto <html>
//     by the server, so the first paint already carries the palette,
//   - the theme layer never imports the database or the auth context.
//
// RED status at the time of writing (develop b22b3cd + inherited overlay):
// the root layout renders no `data-theme` attribute at all, so every
// assertion below fails.

const { cookieStore } = vi.hoisted(() => ({
  cookieStore: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined,
  }),
}));

// The root layout reads the deployment stage for the preview banner. The
// theme contract does not depend on it, so the environment is stubbed to
// keep the test hermetic (no DATABASE_URL, no boot guard).
vi.mock("@/lib/env", () => ({
  env: { AQUA_DEPLOYMENT_STAGE: "development", WHATSAPP_PROVIDER: "mock" },
}));

import RootLayout from "@/app/layout";

async function renderRootLayout(): Promise<ReactElement<Record<string, unknown>>> {
  const element = await RootLayout({ children: null });
  return element as ReactElement<Record<string, unknown>>;
}

function setThemeCookie(value: string): void {
  cookieStore.set("aqua_theme", value);
}

describe("theme preset — server resolution", () => {
  it("renders the default preset on <html> when no preference is stored", async () => {
    cookieStore.clear();
    const element = await renderRootLayout();
    expect(element.type).toBe("html");
    expect(element.props["data-theme"]).toBe("mint");
  });

  it("renders the stored preset on <html> so the first paint is already themed", async () => {
    cookieStore.clear();
    setThemeCookie("lavender");
    const element = await renderRootLayout();
    expect(element.props["data-theme"]).toBe("lavender");
  });

  it("falls back to the default preset for an unknown stored value", async () => {
    cookieStore.clear();
    setThemeCookie("neon-pink");
    const element = await renderRootLayout();
    expect(element.props["data-theme"]).toBe("mint");
  });

  it("falls back to the default preset for a hostile stored value", async () => {
    cookieStore.clear();
    setThemeCookie('"><script>alert(1)</script>');
    const element = await renderRootLayout();
    expect(element.props["data-theme"]).toBe("mint");
  });
});

describe("theme preset — isolation from authorization and tenant data", () => {
  const ROOT = process.cwd();

  function listTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  it("the theme layer imports no database client and no auth context", () => {
    const files = [
      ...listTsFiles(join(ROOT, "lib", "theme")),
      ...listTsFiles(join(ROOT, "components", "theme")),
    ];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, `${file} must not import the database client`).not.toMatch(
        /from\s+["'](@\/db\/|\.\.\/\.\.\/db\/|pg["'])/,
      );
      expect(text, `${file} must not import the auth context`).not.toMatch(
        /from\s+["']@\/lib\/auth\//,
      );
    }
  });
});
