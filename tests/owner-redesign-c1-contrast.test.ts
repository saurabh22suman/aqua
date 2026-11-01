import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Owner redesign · System lane — the shared control boundary's contrast.
//
// The independent review (27 October 2026) found that the control
// border this lane introduced meets only ~1.47:1 (Mint) / ~1.54:1
// (Lavender) against the paper surface, below the 3:1 that DESIGN.md §1
// requires for "applicable non-text controls":
//
//   "Normal text (including meaningful labels and placeholders) needs
//    4.5:1 contrast, large text 3:1; applicable non-text controls/focus
//    indicators need 3:1."
//
// An ordinary text field is PAPER ON PAPER, so its border is the only
// persistent visible outline: it has to carry the 3:1 itself.
//
// This test RESOLVES the token the way the browser does — it reads the
// `color-mix()` expression out of globals.css, resolves the two colours
// it mixes in the preset under test, and computes the contrast of the
// result against every surface the control is drawn on.
//
// RED status at the time of writing: the token mixed only 24% of the
// accent into paper, which is 1.47:1 / 1.54:1.

const GLOBALS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

type Rgb = [number, number, number];

function blockAfter(source: string, selector: string): string {
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

function hexOfMap(map: Map<string, string>, name: string): Rgb {
  const value = map.get(name);
  if (!value) throw new Error(`token ${name} is not declared`);
  const match = value.match(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!match) throw new Error(`token ${name} must be a literal hex, got ${value}`);
  const full =
    value.length === 4
      ? value
          .slice(1)
          .split("")
          .map((c) => c + c)
          .join("")
      : value.slice(1);
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function mix(a: Rgb, b: Rgb, percent: number): Rgb {
  return [
    Math.round(a[0] * percent + b[0] * (1 - percent)),
    Math.round(a[1] * percent + b[1] * (1 - percent)),
    Math.round(a[2] * percent + b[2] * (1 - percent)),
  ];
}

/**
 * Resolve a `color-mix(in srgb, var(--x) P%, var(--y))` token in a
 * preset's token MAP — the way the browser resolves it (a preset that
 * restates a token wins, and the mix follows it).
 */
function resolveColorMix(
  map: Map<string, string>,
  name: string,
): { colour: Rgb; expression: string } {
  const value = map.get(name);
  if (!value) throw new Error(`token ${name} is not declared`);
  const match = value.match(
    /^color-mix\(\s*in srgb,\s*var\((--[a-z0-9-]+)\)\s*([\d.]+)%\s*,\s*var\((--[a-z0-9-]+)\)\s*\)$/,
  );
  if (!match) {
    throw new Error(
      `token ${name} must be a two-colour color-mix() so it can be resolved: ${value}`,
    );
  }
  const first = hexOfMap(map, match[1]!);
  const second = hexOfMap(map, match[3]!);
  return {
    colour: mix(first, second, Number(match[2]) / 100),
    expression: value,
  };
}

const BASE = blockAfter(GLOBALS, "@theme");
const ROOT = blockAfter(GLOBALS, ":root");
const LAVENDER_BLOCK = blockAfter(GLOBALS, '[data-theme="lavender"]');

/**
 * The token map of a preset, resolved the way the browser resolves it:
 * the base palette, then the shared runtime layer, then the preset's own
 * overrides LAST (a preset that restates a token wins).
 */
function presetTokens(preset: "mint" | "lavender"): Map<string, string> {
  const map = new Map<string, string>();
  for (const [name, value] of tokens(BASE)) map.set(name, value);
  for (const [name, value] of tokens(ROOT)) map.set(name, value);
  if (preset === "lavender") {
    for (const [name, value] of tokens(LAVENDER_BLOCK)) map.set(name, value);
  }
  return map;
}

const MINT = presetTokens("mint");
const LAVENDER = presetTokens("lavender");

/** A preset's token lookup, with the preset's own overrides applied. */
function inPreset(
  preset: "mint" | "lavender",
  name: string,
): { colour: Rgb; expression: string } {
  const map = preset === "mint" ? MINT : LAVENDER;
  const expression = map.get(name);
  if (!expression) throw new Error(`token ${name} is not declared`);
  return { ...resolveColorMix(map, name), expression };
}

describe("the shared control boundary", () => {
  for (const preset of ["mint", "lavender"] as const) {
    it(`meets 3:1 against every surface it is drawn on in ${preset}`, () => {
      const border = inPreset(preset, "--control-border").colour;
      const map = preset === "mint" ? MINT : LAVENDER;
      const paper = hexOfMap(map, "--color-paper");
      const deck = hexOfMap(map, "--color-deck");
      const picker = inPreset(preset, "--control-surface-picker").colour;

      // The resting boundary, against the surface a text field sits on
      // (paper) and against the canvas (deck).
      expect(
        contrast(border, paper),
        `the resting border against paper in ${preset}`,
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrast(border, deck),
        `the resting border against the canvas in ${preset}`,
      ).toBeGreaterThanOrEqual(3);
      // A picker draws its border on the tinted picker surface.
      expect(
        contrast(border, picker),
        `the resting border against the picker surface in ${preset}`,
      ).toBeGreaterThanOrEqual(3);
    });
  }

  it("keeps the hover boundary stronger than the resting one", () => {
    for (const preset of ["mint", "lavender"] as const) {
      const resting = inPreset(preset, "--control-border").colour;
      const hover = inPreset(preset, "--control-border-hover").colour;
      const paper = hexOfMap(
        preset === "mint" ? MINT : LAVENDER,
        "--color-paper",
      );
      expect(
        contrast(hover, paper),
        `the hover boundary against paper in ${preset}`,
      ).toBeGreaterThan(contrast(resting, paper));
    }
  });

  it("is derived only from the approved palette tokens", () => {
    for (const preset of ["mint", "lavender"] as const) {
      const expression = inPreset(preset, "--control-border").expression;
      expect(expression).toMatch(/^color-mix\(/);
      // No new colour: the mix names two tokens that already exist.
      const named = [...expression.matchAll(/var\((--[a-z0-9-]+)\)/g)].map(
        (match) => match[1]!,
      );
      expect(named.length).toBe(2);
      for (const name of named) {
        expect(
          MINT.has(name) || LAVENDER.has(name),
          `${name} must be an existing token`,
        ).toBe(true);
      }
    }
  });
});
