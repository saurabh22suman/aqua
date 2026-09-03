import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// DEMO_MODE is a gate, not a feature flag. The point of the rule is
// that DEMO_MODE must not influence business logic — gating seeding
// and a banner is the entire surface area. If DEMO_MODE starts to
// appear in lib/services/** or db/**, it has become a feature flag
// and the shape is wrong (the user-facing rule: "do not add
// `if (DEMO_MODE)` in services or db").
//
// This test is the mechanical guarantee, same pattern as
// tests/tier1/preset-key-reads.test.ts.

const ROOT = process.cwd();
const SCAN_DIRS = ["lib", "app", "components", "db", "scripts"];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listTsFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const FIELD_REGEX = /(?<![A-Za-z0-9_])DEMO_MODE(?![A-Za-z0-9_])/g;

// Every file allowed to read DEMO_MODE. Keep this list short — every
// entry is a deliberate exception. The point of the scan is that an
// accidental read in lib/services/** or db/** fails the build.
const ALLOWED_READERS = new Set<string[]>([
  // The parser. DEMO_MODE is declared in the Zod schema, validated by
  // the production boot guard, and exported as env.DEMO_MODE. Every
  // DEMO_MODE reference in the codebase ultimately points here.
  ["lib", "env.ts"],
  // The demo banner. The component renders nothing when DEMO_MODE is
  // off and the sticky banner when on — the only runtime read besides
  // the parser itself.
  ["components", "demo-banner.tsx"],
  // The seed scripts. Each one guards on env.DEMO_MODE and exits 1
  // when off, so an accidental run against a non-demo environment
  // can't write synthetic data.
  ["scripts", "seed-demo.ts"],
  ["scripts", "seed-platform-user.ts"],
  // The demo-reset wrapper. Same gate as the seed scripts; runs the
  // reset chain only after the guard fires, so `pnpm demo:reset` with
  // DEMO_MODE off does nothing before spawning db:reset.
  ["scripts", "demo-reset.ts"],
  // db/reset.ts drops and recreates the entire public schema — a
  // bigger blast radius than the wrapper above it was ever gating.
  // It's directly runnable on its own (`pnpm db:reset`, CI's own
  // db:reset step), so it carries its own DEMO_MODE-or-`--i-understand`
  // gate rather than trusting the wrapper. db/reset-guard.ts holds the
  // pure guard logic reset.ts reads env.DEMO_MODE into.
  ["db", "reset.ts"],
  ["db", "reset-guard.ts"],
  // Tests read freely; the rule is about production-runtime code.
  ["tests"],
]);

function isAllowed(filePath: string): boolean {
  const relative = filePath.startsWith(ROOT + "/")
    ? filePath.slice(ROOT.length + 1)
    : filePath;
  const parts = relative.split("/");
  for (const allowed of ALLOWED_READERS) {
    if (parts.length >= allowed.length) {
      const match = allowed.every((p, i) => parts[i] === p);
      if (match) return true;
    }
  }
  return false;
}

type Occurrence = { path: string; line: number; text: string };

function findDemoModeReads(): Occurrence[] {
  const out: Occurrence[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of listTsFiles(join(ROOT, dir))) {
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        FIELD_REGEX.lastIndex = 0;
        if (FIELD_REGEX.test(line)) {
          out.push({ path: file, line: i + 1, text: line.trim() });
        }
      }
    }
  }
  return out;
}

describe("DEMO_MODE is read only by the gate (parser + banner + seed scripts)", () => {
  const reads = findDemoModeReads();

  it("scans the source tree and finds no reads outside the whitelist", () => {
    const violations = reads.filter((r) => !isAllowed(r.path));
    if (violations.length > 0) {
      const formatted = violations
        .map((v) => `  ${v.path}:${v.line}\n    ${v.text}`)
        .join("\n");
      throw new Error(
        `DEMO_MODE read outside the gate whitelist (parser + banner + seed scripts):\n${formatted}\n\n` +
          `DEMO_MODE must only appear in lib/env.ts, the demo banner component, and the demo reset scripts. ` +
          `If you find yourself adding \`if (DEMO_MODE)\` in lib/services or db, stop — that is the wrong shape.`,
      );
    }
    expect(violations).toHaveLength(0);
  });

  it("reads the env parser (sanity — the gate must exist somewhere)", () => {
    const parserRead = reads.find((r) => r.path.endsWith("lib/env.ts"));
    expect(parserRead).toBeTruthy();
  });

  it("reads the banner component (sanity — the visible signal must exist)", () => {
    const bannerRead = reads.find((r) => r.path.endsWith("demo-banner.tsx"));
    expect(bannerRead).toBeTruthy();
  });
});