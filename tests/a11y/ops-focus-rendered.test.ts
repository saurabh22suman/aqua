// tests/a11y/ops-focus-rendered.test.ts
//
// Render-based complement to tests/mobile/ops-focus-visible.test.ts,
// which asserts source classes contain `focus-visible:outline-...`.
// Source-string tests can't catch the failure mode this repo keeps
// producing: the class is present in source, the rendering fails.
// Tailwind v4's `outline-none` sets `--tw-outline-style: none`, and
// `outline-2`'s `outline-style: var(--tw-outline-style)` resolves to
// none in that case. The source test passes; the ring does not draw.
// Computed style is the only contract that catches it.
//
// This file boots a real Chromium against a real `next dev`
// (Testcontainer Postgres, bootstrapRoles, migrations, seed),
// focuses each control on /ops/login (the only /ops surface that
// renders without an authenticated platform user — every other
// /ops page calls platformAuthStatusAction and redirects to login),
// and reads `getComputedStyle().outlineStyle`. It fails loudly on
// `outlineStyle === "none"` and on width < 2 or transparent
// colour. The 14 affected files share the same class string; if
// the focus pattern renders here it renders everywhere.
//
// Tests for keyboard navigation live elsewhere
// (tests/mobile/ops-focus-visible.test.ts stays as the lint-style
// guard for source-class presence).

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { createServer, type Server } from "node:http";
import next from "next";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { bootstrapRoles } from "@/db/bootstrap-roles";
import { runMigrations } from "@/db/migrate";
import { execFileSync } from "node:child_process";

const PORT = 3410;                            // 3400-3499, never 3000
// next dev's compile-on-demand is slow on first hit. Per-test
// 15s is tight for a cold-compile first page load; bump to 60s
// for safety. The beforeAll has 120s for next.prepare() +
// bootstrapRoles + runMigrations + seed.
const PLAYWRIGHT_TIMEOUT_MS = 60_000;

let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
let appUri: string;
let adminUri: string;
let nextApp: ReturnType<typeof next>;
let handle: ReturnType<typeof nextApp.getRequestHandler>;
let server: Server;
let browser: Browser;

type Probe = {
  matchesFocusVisible: boolean;
  outlineStyle: string;
  outlineWidth: string;
  outlineColor: string;
} | null;

async function probe(page: import("playwright").Page, selector: string): Promise<Probe> {
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return null;
    el.focus();
    const cs = getComputedStyle(el);
    return {
      matchesFocusVisible: el.matches(":focus-visible"),
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      outlineColor: cs.outlineColor,
    };
  }, selector);
}

const CONTROLS: ReadonlyArray<{
  path: string;
  selector: string;
  label: string;
}> = [
  // /ops/login is the only /ops surface that renders without an
  // authenticated platform user — every other /ops page calls
  // platformAuthStatusAction and redirects here. The two Field
  // components below exercise the same `inputClass` pattern that
  // the other 13 files share. The 14 affected files all carry
  // the same class string, so if the focus pattern renders here
  // it renders everywhere; tests/mobile/ops-focus-visible.test.ts
  // guards source-class presence file-by-file separately.
  { path: "/ops/login", selector: 'input[name="email"]', label: "login email" },
  { path: "/ops/login", selector: 'input[name="password"]', label: "login password" },
];

beforeAll(async () => {
  // Testcontainers Postgres — never the shared dev DB.
  container = await new PostgreSqlContainer("postgres:16").start();
  const host = container.getHost();
  const dbPort = container.getPort();
  const database = container.getDatabase();
  adminUri = container.getConnectionUri();
  const appPassword = "isolated-test-pw";
  appUri = `postgresql://app_login:${encodeURIComponent(appPassword)}@${host}:${dbPort}/${database}`;

  await bootstrapRoles(adminUri, appPassword);
  await runMigrations(adminUri);

  // The /ops screens the test exercises need at least one tenant
  // for /ops/tenants to render its table; seedDemo also provisions
  // the login user, presets, permissions, policy_versions.
  process.env.DATABASE_URL = appUri;
  process.env.MIGRATION_DATABASE_URL = adminUri;
  process.env.APP_LOGIN_PASSWORD = appPassword;
  process.env.DEMO_MODE = "false";
  process.env.WHATSAPP_PROVIDER = "disabled";
  process.env.BETTER_AUTH_URL = `http://127.0.0.1:${PORT}`;
  process.env.NEXT_PUBLIC_BETTER_AUTH_URL = process.env.BETTER_AUTH_URL;
  execFileSync("npx", ["tsx", "scripts/seed.ts"], {
    env: { ...process.env, DEMO_MODE: "false" },
    stdio: "pipe",
  });

  nextApp = next({ dev: true, dir: process.cwd() });
  handle = nextApp.getRequestHandler();
  await nextApp.prepare();
  server = createServer((req, res) => handle(req, res));
  // Bind EADDRINUSE detection explicitly: the previous (r) =>
  // server.listen(...) callback resolves on success AND on failure,
  // because the listen callback's `err` arg is the only signal that
  // the port was already taken, and the original code discarded it.
  // On a busy runner with another vitest pool holding the port,
  // that turned a 1s failure into a 120s beforeAll timeout as the
  // test waited for Playwright to time out its first page load.
  // The check is host-pinned to 127.0.0.1 so it can't accidentally
  // collide with anything bound to a different interface.
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
  await nextApp?.close();
  await container?.stop();
});

describe("/ops focus indicator renders (computed style, not source)", () => {
  for (const { path, selector, label } of CONTROLS) {
    it(`${label} at ${path} renders a visible outline on :focus-visible`, async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      // Chromium treats *.localhost as loopback per RFC 6761, so the
      // ops host header naturally resolves to 127.0.0.1 without a
      // /etc/hosts entry. The middleware routes on `Host: ops.*`.
      await page.goto(`http://ops.localhost:${PORT}${path}`);
      const result = await probe(page, selector);

      expect(result, `${label}: element not found at ${path}`).not.toBeNull();
      expect(result!.matchesFocusVisible, `${label}: did not match :focus-visible`).toBe(true);

      // The actual contract: outline-style must NOT be "none", width
      // must be ≥ 2px, colour must not be transparent. This is the
      // assertion that catches the Tailwind-v4 outline-none bug the
      // source-grep test misses.
      expect(
        result!.outlineStyle,
        `${label}: outline-style was "${result!.outlineStyle}" — ` +
          `the source test caught the class, the renderer did not draw it. ` +
          `Did --focus-ring/--tw-outline-style fall back to "none"?`,
      ).not.toBe("none");
      expect(
        parseFloat(result!.outlineWidth),
        `${label}: outline-width was "${result!.outlineWidth}"`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        result!.outlineColor,
        `${label}: outline-color was "${result!.outlineColor}"`,
      ).not.toMatch(/rgba?\(\s*[^,]+,\s*[^,]+,\s*[^,]+\s*,\s*0\s*\)/);

      await ctx.close();
    }, PLAYWRIGHT_TIMEOUT_MS);
  }
});
