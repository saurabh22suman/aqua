import { describe, expect, it } from "vitest";

// Positive control for tests/tier1/demo-mode-reads.test.ts.
//
// The production test (tests/tier1/demo-mode-reads.test.ts) walks
// lib/, app/, components/, db/, scripts/ and asserts every
// DEMO_MODE reference is whitelisted (parser + banner + seed
// scripts + reset scripts). It has no positive control — no
// assertion that the scanner WOULD flag a real DEMO_MODE read.
// That gap means a future contributor who, say, switches the regex
// from `(?<![A-Za-z0-9_])DEMO_MODE(?![A-Za-z0-9_])` to something
// looser (or accidentally inverts the membership test) wouldn't
// know until an unrelated fixture tripped the real test.
//
// This file pins the regex's positive behaviour with the same
// inline-string pattern as tests/tier1/hardcoded-brand-color.test.ts:103
// ("does flag bg-mango as a positive control"):
//   take a known-bad input → run the regex → assert it matches.
//
// Mirrors the production regex verbatim so a contributor reading
// both tests side-by-side can verify the rules agree. If the
// production regex changes, this file must change to match — and
// that delta is itself the regression signal.

// Verbatim copy of FIELD_REGEX from tests/tier1/demo-mode-reads.test.ts.
const FIELD_REGEX = /(?<![A-Za-z0-9_])DEMO_MODE(?![A-Za-z0-9_])/g;

describe("demo-mode-reads positive control (mirrors hardcoded-brand-color:103)", () => {
  it("flags a bare DEMO_MODE identifier reference", () => {
    FIELD_REGEX.lastIndex = 0;
    expect(FIELD_REGEX.test("if (DEMO_MODE) return;")).toBe(true);
  });

  it("flags env.DEMO_MODE (the realistic read shape in the seed scripts)", () => {
    FIELD_REGEX.lastIndex = 0;
    expect(FIELD_REGEX.test("if (!env.DEMO_MODE) process.exit(1);")).toBe(true);
  });

  it("flags DEMO_MODE inside an `if (DEMO_MODE)` branch (lib/services pattern the rule forbids)", () => {
    FIELD_REGEX.lastIndex = 0;
    expect(
      FIELD_REGEX.test("export async function seed() { if (DEMO_MODE) await seedAll(); }"),
    ).toBe(true);
  });

  it("does not false-positive on a substring like DEMO_MODES (boundary)", () => {
    // Sanity check on the regex itself: a hypothetical future
    // constant DEMO_MODES (plural) must not match. The regex uses
    // lookbehind + lookahead for word boundaries, mirroring the
    // pattern of the production check.
    FIELD_REGEX.lastIndex = 0;
    expect(FIELD_REGEX.test("const DEMO_MODES = true;")).toBe(false);
  });
});