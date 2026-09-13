import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Cold-load fix: every Server Component page in the app does an
// `await Promise.all([...])` over its data, then renders. While
// that runs the user sees a blank document — no header, no
// skeleton, no "loading" indicator. The dev audit measured 2–7s
// per route (`/login` 6.5s, `/p/[token]` 2.1s) before this fix.
//
// The fix is route-level `loading.tsx`: Next.js streams them
// immediately while the page's data fetches start. The visual is
// secondary to the streaming win; the structure here is what the
// test guards.
//
// What this test pins:
//   1. Each covered route has a `loading.tsx` file present.
//   2. The file exports a default function (Next.js's contract).
//   3. The file imports from `@/components/skeleton` and uses
//      `<Skeleton w=` at least four times — a structurally-thick
//      skeleton rather than a one-line placeholder that defeats
//      the point. Mutation-tested: strip the `Skeleton w=` usages
//      from any one of these files and this test flips red.
//
// Cold-load e2e (dev log shows `Compiling /<route>` followed by
// `GET <route>` returning the skeleton, not blank) is verified by
// running `pnpm dev` once per route — that is noted in
// docs/owner-fixes.md, not scripted here, because restarting the
// dev server mid-suite would mask any of the real regressions
// this test is built to catch.

const ROUTES = [
  "app/(owner)/owner/loading.tsx",
  "app/(owner)/owner/members/loading.tsx",
  "app/(owner)/owner/reports/loading.tsx",
  "app/(coach)/coach/loading.tsx",
  "app/(coach)/coach/register/[sessionId]/loading.tsx",
] as const;

// Matches a `<Skeleton w=` opening tag. Used as the "real skeleton
// primitive, not a thin wrapper" check — a file that does
// `<MyCustomPlaceholder />` everywhere would compile fine and
// pass a default-export check, but would not survive this one.
const SKELETON_W_REGEX = /<Skeleton\s+w=/g;

// Match the import line. Tolerant of single or double quotes and
// of leading `import type` / runtime imports — both shapes are
// legal in this codebase, see components/skeleton.tsx (which
// exports `Skeleton` as a runtime value).
const SKELETON_IMPORT_REGEX =
  /import\s+(?:type\s+)?\{[^}]*\bSkeleton\b[^}]*\}\s+from\s+["']@\/components\/skeleton["']/;

const ROOT = process.cwd();

function readRouteSource(route: string): string {
  return readFileSync(join(ROOT, route), "utf8");
}

function defaultExportCount(source: string): number {
  // Tolerates both `export default function Loading()` and
  // `export default function ()` and `export default Loading;` —
  // any of these satisfies Next.js's loading.tsx contract.
  const matches = source.match(/export\s+default\s+(?:function\s+\w+|function\s*\(|const\s+\w+\s*=|class\s+\w+|\w+)/g);
  return matches ? matches.length : 0;
}

describe("route-level loading.tsx files (cold-load skeleton coverage)", () => {
  it("every covered route has a loading.tsx file on disk", () => {
    const missing = ROUTES.filter((r) => !existsSync(join(ROOT, r)));
    expect(missing, `Missing loading.tsx files: ${missing.join(", ")}`).toEqual([]);
  });

  it.each(ROUTES)("%s exists", (route) => {
    expect(existsSync(join(ROOT, route)), `${route} should exist`).toBe(true);
  });

  it.each(ROUTES)("%s exports a default function (Next.js loading.tsx contract)", (route) => {
    const source = readRouteSource(route);
    expect(
      defaultExportCount(source),
      `${route} must \`export default\` — Next.js only treats this file as a loading boundary if the default export is present`,
    ).toBeGreaterThanOrEqual(1);
  });

  it.each(ROUTES)(
    "%s imports Skeleton from @/components/skeleton (uses the design-system primitive, not a bespoke placeholder)",
    (route) => {
      const source = readRouteSource(route);
      expect(
        SKELETON_IMPORT_REGEX.test(source),
        `${route} must import Skeleton from @/components/skeleton`,
      ).toBe(true);
    },
  );

  it.each(ROUTES)(
    "%s contains at least four <Skeleton w= usages (structurally-thick skeleton, not a one-line stub)",
    (route) => {
      const source = readRouteSource(route);
      const matches = source.match(SKELETON_W_REGEX) ?? [];
      // Reset lastIndex because the regex is global.
      SKELETON_W_REGEX.lastIndex = 0;
      expect(
        matches.length,
        `${route} should have at least four <Skeleton w= usages — the audit found cold-load skeletons that were one block; the test pins a real shape.`,
      ).toBeGreaterThanOrEqual(4);
    },
  );

  it("summary: every loading.tsx uses the design-system skeleton primitive and is structurally thick", () => {
    // Aggregate guard: if a future route is added to ROUTES but
    // fails any of the per-route checks above, this single test
    // surfaces every failure in one error message rather than
    // making the reader scroll.
    const report = ROUTES.map((route) => {
      if (!existsSync(join(ROOT, route))) {
        return { route, ok: false, reason: "file missing" };
      }
      const source = readRouteSource(route);
      if (defaultExportCount(source) < 1) {
        return { route, ok: false, reason: "no default export" };
      }
      if (!SKELETON_IMPORT_REGEX.test(source)) {
        return { route, ok: false, reason: "does not import Skeleton from @/components/skeleton" };
      }
      const usage = (source.match(SKELETON_W_REGEX) ?? []).length;
      SKELETON_W_REGEX.lastIndex = 0;
      if (usage < 4) {
        return { route, ok: false, reason: `only ${usage} <Skeleton w= usages (< 4)` };
      }
      return { route, ok: true, reason: `${usage} usages` };
    });
    const failures = report.filter((r) => !r.ok);
    if (failures.length > 0) {
      const formatted = failures
        .map((f) => `  ${f.route}: ${f.reason}`)
        .join("\n");
      throw new Error(
        `loading.tsx coverage gaps:\n${formatted}\n\n` +
          `Each route in ROUTES must have a structurally-thick loading.tsx that uses the design-system Skeleton primitive.`,
      );
    }
    expect(failures).toHaveLength(0);
  });
});
