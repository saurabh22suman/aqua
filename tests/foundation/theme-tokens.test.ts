import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// UI foundation — theme token contract.
//
// Two LIGHT presets only (Mint Garden = default, Lavender Club). The
// contract this file pins:
//   - every base colour of the default palette is explicitly overridden
//     in the second preset, so no Mint value can leak into Lavender
//     mode through a forgotten token,
//   - both presets are light: a light canvas with dark text, AA text
//     contrast (4.5:1) for body, secondary and muted text on both the
//     canvas and the raised surface,
//   - the focus indicator meets WCAG 1.4.11 (3:1) against every control
//     surface of the preset it belongs to,
//   - semantic status colours (good / late / warn) are NOT redefined per
//     preset: money and attendance meaning must not move with the theme,
//   - motion primitives exist and reduced motion stays honoured.
//
// RED status at the time of writing (develop b22b3cd + inherited
// overlay): app/globals.css declares one palette and no preset blocks,
// so the preset assertions fail.

const GLOBALS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

function blockAfter(source: string, selector: string): string {
  // The selector must be followed by its opening brace, so a mention of
  // the selector inside a comment is never mistaken for the rule.
  const pattern = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`,
  );
  const match = pattern.exec(source);
  if (!match) throw new Error(`selector ${selector} not found in globals.css`);
  const open = source.indexOf("{", match.index);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`selector ${selector} block is not closed`);
}

function tokens(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(match[1]!, match[2]!.trim());
  }
  return out;
}

function hexOf(block: string, name: string): string {
  const value = tokens(block).get(name);
  if (!value) throw new Error(`token ${name} is not declared in the block`);
  const match = value.match(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!match) throw new Error(`token ${name} must be a literal hex, got ${value}`);
  return value.toUpperCase();
}

function luminance(hex: string): number {
  const full = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const BASE_THEME_BLOCK = blockAfter(GLOBALS, "@theme");
const ROOT_BLOCK = blockAfter(GLOBALS, ":root");
// The default preset is the base palette (@theme) plus the runtime
// tokens (:root), so the preset is read from both.
const THEME_BLOCK = `${BASE_THEME_BLOCK}\n${ROOT_BLOCK}`;
const LAVENDER_BLOCK = blockAfter(GLOBALS, '[data-theme="lavender"]');
const BASE_COLORS = ["--color-deck", "--color-paper", "--color-ink", "--color-ink-2", "--color-ink-3"];

// Money and attendance semantics. Shared by both presets on purpose.
const STATUS_TOKENS = [
  "--color-good",
  "--color-good-soft",
  "--color-late",
  "--color-late-soft",
  "--color-warn",
  "--color-warn-soft",
];

describe("preset structure", () => {
  it("declares the default palette in the theme block and the second preset alongside it", () => {
    expect(THEME_BLOCK).toContain("--color-deck");
    expect(LAVENDER_BLOCK).toContain("--color-deck");
  });

  it("overrides every base colour in the second preset", () => {
    const base = tokens(BASE_THEME_BLOCK);
    // Status colours are excluded on purpose: they are shared by both
    // presets so money and attendance meaning cannot move with the
    // theme (asserted separately below).
    const baseColors = [...base.keys()].filter(
      (name) => name.startsWith("--color-") && !STATUS_TOKENS.includes(name),
    );
    expect(baseColors.length).toBeGreaterThan(0);
    for (const name of baseColors) {
      expect(
        tokens(LAVENDER_BLOCK).has(name),
        `${name} is not overridden in the second preset`,
      ).toBe(true);
    }
  });

  it("keeps semantic status colours identical across presets", () => {
    for (const name of [
      "--color-good",
      "--color-good-soft",
      "--color-late",
      "--color-late-soft",
      "--color-warn",
      "--color-warn-soft",
    ]) {
      expect(
        tokens(LAVENDER_BLOCK).has(name),
        `${name} must not be redefined per preset — status meaning is theme independent`,
      ).toBe(false);
    }
  });
});

describe.each([
  ["mint", THEME_BLOCK],
  ["lavender", LAVENDER_BLOCK],
])("preset %s — light theme and contrast", (_name, block) => {
  it("is a light theme (light canvas, dark text)", () => {
    expect(luminance(hexOf(block, "--color-deck"))).toBeGreaterThan(0.6);
    expect(luminance(hexOf(block, "--color-paper"))).toBeGreaterThan(0.6);
    expect(luminance(hexOf(block, "--color-ink"))).toBeLessThan(0.2);
  });

  it("meets AA text contrast on the canvas and the raised surface", () => {
    const canvas = hexOf(block, "--color-deck");
    const surface = hexOf(block, "--color-paper");
    for (const text of ["--color-ink", "--color-ink-2", "--color-ink-3"]) {
      for (const bg of [canvas, surface]) {
        expect(
          contrast(hexOf(block, text), bg),
          `${text} on ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps the primary action readable (white text on the action surface)", () => {
    expect(contrast("#FFFFFF", hexOf(block, "--accent-strong"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the focus indicator at 3:1 against every control surface", () => {
    const ring = hexOf(block, "--focus-ring");
    for (const bg of ["--color-deck", "--color-paper"]) {
      expect(contrast(ring, hexOf(block, bg)), `--focus-ring on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("focus indicator", () => {
  it("keeps the default focus ring a literal hex the focus-contrast script can parse", () => {
    const line = GLOBALS.split(/\r?\n/).find((l) => /--focus-ring:/.test(l));
    expect(line).toBeTruthy();
    expect(line).toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("keeps the global focus-visible fallback rule", () => {
    expect(GLOBALS).toContain(":focus-visible");
    expect(GLOBALS).toContain("var(--focus-ring)");
  });
});

describe("motion primitives", () => {
  it("declares the shared duration and easing tokens", () => {
    const root = tokens(THEME_BLOCK);
    expect(root.has("--motion-duration-fast")).toBe(true);
    expect(root.has("--motion-duration-base")).toBe(true);
    expect(root.has("--motion-duration-slow")).toBe(true);
    expect(root.has("--motion-ease-standard")).toBe(true);
  });

  it("neutralises motion for reduced-motion users", () => {
    expect(GLOBALS).toContain("prefers-reduced-motion: reduce");
    const reduced = blockAfter(GLOBALS, "@media (prefers-reduced-motion: reduce)");
    expect(reduced).toContain("transition-duration");
  });
});

describe("preset coverage of the base palette", () => {
  it("declares every base colour the default theme relies on", () => {
    for (const name of BASE_COLORS) {
      expect(tokens(THEME_BLOCK).has(name), `${name} missing from the default preset`).toBe(true);
    }
  });
});
