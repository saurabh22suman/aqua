import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// B5 — the reserved-token rule (DESIGN.md §1.1: warn/late are
// money/attendance-state only, water is data only) has a sibling
// failure mode that isn't about semantics at all: DESIGN.md §1.2
// names the six approved tenant accent values — "mango (default) ·
// marine · indigo · plum · forest · slate" — as a runtime picker, not
// a set of Tailwind class names. Only `--accent` (bg-[var(--accent)])
// is meant to be used in components; DESIGN.md:83 says as much
// ("--accent may never appear inside a status or state style").
//
// Ten call sites across eight files hardcoded `bg-mango` directly
// instead. `mango` isn't even a defined Tailwind color in this repo's
// @theme block (app/globals.css) — every one of those buttons
// rendered with `background-color: rgba(0, 0, 0, 0)` (confirmed via a
// real browser, not assumed): a tenant on any accent, including the
// mango default, got a fully transparent, invisible primary button.
// Reusing indigo/plum/forest/slate as class names would be no better
// even if a future @theme block happened to define them — the accent
// is a runtime value, not a fixed one; hardcoding any of the five
// non-marine option names bypasses the CSS variable entirely, the
// exact bug that shipped here.
//
// marine is excluded: unlike the other five, it's ALSO a fixed,
// legitimate structural token in its own right (DESIGN.md:50, "hero
// blocks, dark surfaces") — bg-marine/text-marine are valid regardless
// of tenant branding (e.g. components/demo-banner.tsx).
//
// Same pattern as tests/tier1/demo-mode-reads.test.ts and
// tests/tier1/preset-key-reads.test.ts: source-level regex scan, not a
// render test, mechanical guarantee that this class of bug fails the
// build if it reproduces a third time.

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "components"];

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

// Tailwind utility prefixes that take a color token: bg-mango,
// text-mango, border-mango, ring-mango, from-mango, to-mango, via-mango.
const BANNED_NAMES = ["mango", "indigo", "plum", "forest", "slate"];
const CLASS_PREFIXES = ["bg", "text", "border", "ring", "from", "to", "via"];
const BANNED_CLASS_REGEX = new RegExp(
  `(?<![\\w-])(?:${CLASS_PREFIXES.join("|")})-(?:${BANNED_NAMES.join("|")})(?![\\w-])`,
  "g",
);

type Occurrence = { path: string; line: number; text: string };

function findHardcodedBrandColors(): Occurrence[] {
  const out: Occurrence[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of listTsFiles(join(ROOT, dir))) {
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        BANNED_CLASS_REGEX.lastIndex = 0;
        if (BANNED_CLASS_REGEX.test(line)) {
          out.push({ path: file, line: i + 1, text: line.trim() });
        }
      }
    }
  }
  return out;
}

describe("no hardcoded brand-accent color classes (bg-mango and friends)", () => {
  it("finds zero uses of a non-marine accent name as a Tailwind color class", () => {
    const occurrences = findHardcodedBrandColors();
    if (occurrences.length > 0) {
      const formatted = occurrences
        .map((o) => `  ${o.path}:${o.line}\n    ${o.text}`)
        .join("\n");
      throw new Error(
        `Hardcoded brand-accent color class(es) found:\n${formatted}\n\n` +
          `The accent is a runtime value (DESIGN.md §1.2) — use bg-[var(--accent)], ` +
          `never a literal accent name as a Tailwind class. (marine is exempt: it's ` +
          `also a fixed structural token, DESIGN.md:50.)`,
      );
    }
    expect(occurrences).toHaveLength(0);
  });

  it("does not false-positive on the legitimate marine structural token", () => {
    // Sanity check on the regex itself: bg-marine must not match.
    BANNED_CLASS_REGEX.lastIndex = 0;
    expect(BANNED_CLASS_REGEX.test("bg-marine text-paper")).toBe(false);
  });

  it("does flag bg-mango as a positive control", () => {
    BANNED_CLASS_REGEX.lastIndex = 0;
    expect(BANNED_CLASS_REGEX.test('className="rounded-ctl bg-mango px-4 py-2"')).toBe(true);
  });
});
