import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// UI foundation — the pastel surface contract for the owner home.
//
// Batch 4 (26 October 2026) gave the owner screen a pastel sidebar and
// a pastel metric hierarchy. Those surfaces are new tokens, so they
// need the same guarantees the rest of the palette already has:
//
//   - the base palette (@theme) declares them, so Tailwind generates
//     the utilities from one place;
//   - the second preset RESTATES every one of them, so no Mint value
//     can leak into Lavender mode (the same rule the rest of the
//     palette follows);
//   - muted text (ink-3) stays at WCAG AA (4.5:1) on every pastel
//     surface, because the tile hint is the smallest text on the tile;
//   - the focus ring stays at WCAG 1.4.11 (3:1) on every surface a
//     control can be drawn on — the sidebar and the tiles hold
//     focusable links.
//
// RED status at the time of writing: none of the surface tokens
// existed, so the declarations and the contrast assertions failed.

const GLOBALS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

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
const MINT_BLOCK = `${BASE_THEME_BLOCK}\n${ROOT_BLOCK}`;
const LAVENDER_BLOCK = blockAfter(GLOBALS, '[data-theme="lavender"]');
const BASE_PALETTE = tokens(BASE_THEME_BLOCK);

// The pastel surfaces the owner home paints on.
const SURFACE_TOKENS = [
  "--color-sidebar",
  "--color-tile-money",
  "--color-tile-info",
  "--color-tile-butter",
];

/**
 * Resolve a surface in a preset. The status surfaces (late-soft) are
 * shared by both presets on purpose — money meaning must not move with
 * the theme — so they come from the base palette when a preset does not
 * restate them.
 */
function surfaceOf(block: string, name: string): string {
  const value = tokens(block).get(name) ?? BASE_PALETTE.get(name);
  if (!value) throw new Error(`token ${name} is not declared`);
  const match = value.match(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!match) throw new Error(`token ${name} must be a literal hex, got ${value}`);
  return value.toUpperCase();
}

describe.each([
  ["mint", MINT_BLOCK],
  ["lavender", LAVENDER_BLOCK],
])("preset %s — the pastel owner surfaces", (_name, block) => {
  it("declares every owner surface as a literal hex", () => {
    for (const name of SURFACE_TOKENS) {
      expect(() => hexOf(block, name), `${name} missing`).not.toThrow();
    }
  });

  it("keeps muted text (ink-3) at AA on every pastel surface", () => {
    const muted = surfaceOf(block, "--color-ink-3");
    for (const name of SURFACE_TOKENS) {
      const surface = surfaceOf(block, name);
      expect(
        contrast(muted, surface),
        `ink-3 on ${name} (${surface})`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the focus ring at 3:1 on every surface a control sits on", () => {
    const ring = surfaceOf(block, "--focus-ring");
    for (const name of [...SURFACE_TOKENS, "--color-late-soft", "--color-deck", "--color-paper"]) {
      const surface = surfaceOf(block, name);
      expect(contrast(ring, surface), `focus ring on ${name}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("preset coverage", () => {
  it("restates every owner surface in the second preset", () => {
    const lavender = tokens(LAVENDER_BLOCK);
    for (const name of SURFACE_TOKENS) {
      expect(
        lavender.has(name),
        `${name} is not overridden in the second preset`,
      ).toBe(true);
    }
  });
});
