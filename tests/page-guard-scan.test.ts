import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// D2 — page-guard scan.
//
// Audit finding: app/(owner)/layout.tsx (and the coach / reception
// equivalents) was the only authorization gate between a cross-
// surface role and the page's data. Next.js skips the layout when
// a client-supplied `Next-Router-State-Tree` claims the segment
// is already mounted, so the layout's `canAccessSurface` never
// runs on the RSC payload and the page returns protected data.
//
// The fix: every page.tsx under a tenant route group must call a
// surface guard (requireOwner / requireCoach / requireReception
// from lib/auth/surface-guard) as its first statement. Layouts
// keep their canAccessSurface check for UX (the bottom-nav
// visibility, the redirect before any data fetch) but pages
// authorize themselves.
//
// This script walks every page.tsx under app/(owner), app/(coach),
// app/(reception) and asserts the guard call is present. Fixtures
// live outside the scanned tree (tests/scanner-fixtures/) so a
// regression in the scanner never accidentally scans itself.

const ROOT = process.cwd();
const SCAN_DIRS = ["app/(owner)", "app/(coach)", "app/(reception)"];

const SURFACE_GUARD: Record<string, string> = {
  "app/(owner)": "requireOwner",
  "app/(coach)": "requireCoach",
  "app/(reception)": "requireReception",
};

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...listFiles(full));
    // Skip layout.tsx (UX-only check, not a page) and
    // loading.tsx (skeleton-only, not a page that authorizes
    // anything — it runs while the page itself is loading).
    else if (entry === "page.tsx") out.push(full);
  }
  return out;
}

type Issue = { path: string; reason: string };
const issues: Issue[] = [];

for (const scanDir of SCAN_DIRS) {
  for (const file of listFiles(scanDir)) {
    const text = readFileSync(file, "utf8");
    const guard = SURFACE_GUARD[scanDir]!;
    if (!new RegExp(`\\bawait\\s+${guard}\\s*\\(\\)`).test(text)) {
      issues.push({ path: file, reason: `missing surface guard: await ${guard}()` });
    }
  }
}

describe("page-guard scan (D2): every page.tsx under a role route group calls the surface guard", () => {
  it("every page under app/(owner), app/(coach), app/(reception) calls requireOwner / requireCoach / requireReception", () => {
    if (issues.length > 0) {
      const formatted = issues
        .map((i) => `  - ${i.path}: ${i.reason}`)
        .join("\n");
      throw new Error(
        `Found ${issues.length} page(s) without a surface guard:\n${formatted}\n\n` +
          `Every page.tsx under a tenant route group must call the\n` +
          `surface guard (requireOwner / requireCoach / requireReception)\n` +
          `as its first statement. Layouts no longer authorize the user;\n` +
          `they only steer the bottom-nav visibility. See lib/auth/surface-guard.ts.`,
      );
    }
    expect(issues).toHaveLength(0);
  });

  it("known-bad fixture: a page WITHOUT the guard is flagged", () => {
    // tests/scanner-fixtures/fixtures/known-bad-page.tsx is
    // shaped like a real page but doesn't call requireOwner. The
    // scanner (when pointed at it) would flag it. This test
    // asserts the same code-shape contains the same problem the
    // production scanner is looking for, by running the scanner's
    // regex against the fixture in-process.
    const fixturePath = join(
      ROOT,
      "tests/scanner-fixtures/fixtures/known-bad-page.tsx",
    );
    const text = readFileSync(fixturePath, "utf8");
    // The fixture is a fake owner page that forgot the guard.
    expect(new RegExp(`\\bawait\\s+requireOwner\\s*\\(\\)`).test(text)).toBe(false);
  });

  it("known-good fixture: a page WITH the guard passes", () => {
    const fixturePath = join(
      ROOT,
      "tests/scanner-fixtures/fixtures/known-good-page.tsx",
    );
    const text = readFileSync(fixturePath, "utf8");
    expect(new RegExp(`\\bawait\\s+requireOwner\\s*\\(\\)`).test(text)).toBe(true);
  });
});