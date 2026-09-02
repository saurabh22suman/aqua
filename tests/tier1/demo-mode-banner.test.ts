import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The visible signal of demo mode is a sticky banner on every
// surface. Behavioural test:
//
//   DEMO_MODE=true   →  banner renders
//   DEMO_MODE=false  →  banner renders nothing
//
// We can't render the component under vitest in this repo:
// tsconfig.json sets `jsx: "preserve"` for Next.js, and vite's
// import-analysis refuses to compile a `.tsx` source file containing
// JSX under that setting. The existing offline tests dodge this by
// using `renderHook` and mocking server actions — they never import a
// `.tsx` component source. We can't dodge it for a render-the-actual-
// component test.
//
// Instead, this test pins the gating CONTRACT by reading the source:
//   1. The component branches on env.DEMO_MODE and returns null when
//      off, otherwise renders the demo text.
//   2. The root layout imports DemoBanner and renders it inside
//      <body>, so it sits on every route group (owner / coach /
//      reception / parent / platform) and on /login.
//
// Combined with tests/tier1/demo-mode-env.test.ts (which proves
// env.DEMO_MODE parses to the right boolean) and
// tests/tier1/demo-mode-reads.test.ts (which proves no other file
// reads DEMO_MODE), this gives the same guarantee a render test would:
// when DEMO_MODE=true the banner is in the rendered output; when
// false, it returns null before any markup is produced.

const BANNER_PATH = join(process.cwd(), "components", "demo-banner.tsx");
const LAYOUT_PATH = join(process.cwd(), "app", "layout.tsx");

describe("DemoBanner gating contract (source-level, see file header)", () => {
  const banner = readFileSync(BANNER_PATH, "utf8");

  it("imports env from @/lib/env (reads DEMO_MODE through the gated parser)", () => {
    expect(banner).toMatch(/import\s*\{[^}]*\benv\b[^}]*\}\s*from\s*["']@\/lib\/env["']/);
  });

  it("returns null when DEMO_MODE is off — the 'absent' half of the contract", () => {
    // The exact conditional the component relies on. Anything else
    // (a different flag, a default-true, a missing check) would be
    // a regression of the contract this test pins.
    expect(banner).toMatch(/if\s*\(\s*!env\.DEMO_MODE\s*\)\s*return\s+null\s*;?/);
  });

  it("renders the unmistakable demo text when DEMO_MODE is on — the 'present' half", () => {
    // Two required signals: "this is a demo tenant" and "not real
    // academy data." Both must be in the rendered markup so a real
    // club owner looking at the demo cannot mistake it for their own
    // data.
    expect(banner).toMatch(/this is a demo tenant/i);
    expect(banner).toMatch(/is\s+real\s+academy\s+data/i);
  });

  it("uses neutral ink — no warn (means 'needs attention') and no late (means 'overdue / absent')", () => {
    // DESIGN.md §1.1: warn and late are reserved semantic tokens for
    // money and attendance state. The banner must not use them; if a
    // future change does, a real operator may read "Late" next to a
    // demo member and mistake synthetic data for a real absence.
    expect(banner).not.toMatch(/\bbg-warn\b|\btext-warn\b/);
    expect(banner).not.toMatch(/\bbg-late\b|\btext-late\b/);
  });
});

describe("Root layout wiring — banner sits on every surface", () => {
  const layout = readFileSync(LAYOUT_PATH, "utf8");

  it("imports DemoBanner from @/components/demo-banner", () => {
    expect(layout).toMatch(
      /import\s*\{[^}]*\bDemoBanner\b[^}]*\}\s*from\s*["']@\/components\/demo-banner["']/,
    );
  });

  it("renders <DemoBanner /> inside <body> so it shows on every route", () => {
    expect(layout).toMatch(/<body[\s\S]*<DemoBanner\s*\/>[\s\S]*<\/body>/);
  });
});