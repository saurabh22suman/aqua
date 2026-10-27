import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Owner Lavender B — the plug-and-play preset contract.
//
// The human approved ONE layout ("Lavender Club — Option B") and two
// presets that must render that SAME layout: Lavender Club (Option B)
// and Mint Garden. "Plug-and-play" means the owner home markup never
// branches on the preset — the difference is carried entirely by the
// token layer.
//
// The contract this file pins:
//
//   1. Lavender Club is the approved Option B palette: a pale lilac
//      canvas and sidebar, a plum action, an aubergine ink;
//   2. EVERY semantic token the owner home paints with is declared in
//      BOTH presets, so switching the preset can never leave a
//      surface, a border, a chart colour or an illustration colour
//      undefined in one of them;
//   3. the approved palette still meets WCAG AA for body text and
//      WCAG 1.4.11 for the focus ring on every surface a control can
//      be drawn on;
//   4. the illustration tokens exist in both presets, so the sport
//      artwork follows the theme instead of carrying its own colours.
//
// RED status at the time of writing: app/globals.css declares the
// pre-approval Lavender palette (a deeper violet, a colder lilac) and
// no attention, illustration or chart-surface tokens at all, so the
// Option B assertions and the "declared in both presets" assertions
// fail.

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

/** Every `@media (<condition>) { … }` block whose condition matches. */
function mediaBlocks(source: string, condition: string): string[] {
  const out: string[] = [];
  const pattern = new RegExp(
    `@media\\s*\\([^)]*${condition.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^)]*\\)\\s*\\{`,
    "g",
  );
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const open = source.indexOf("{", match.index);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          out.push(source.slice(open + 1, i));
          break;
        }
      }
    }
  }
  return out;
}

/**
 * The semantic layer that FOLLOWS the base palette. These are declared
 * once, in `:root`, as var() references — so a preset swap repaints
 * them without restating them. Restating them per preset is how the
 * layer drifts, so the contract is: declared once, never redefined.
 */
const SHARED_SEMANTIC_TOKENS = [
  "--surface-canvas",
  "--surface-raised",
  "--surface-elevated",
  "--surface-sunken",
  "--surface-sidebar",
  "--text-primary",
  "--text-secondary",
  "--text-muted",
  "--text-inverse",
  "--border-subtle",
  "--border-strong",
  "--action-surface",
  "--action-foreground",
  "--action-soft",
  "--action-ink",
];

/**
 * The tokens whose VALUE differs per preset. Every one of them must be
 * declared in both presets: a token that exists in one and not the
 * other is a surface that silently keeps the other preset's value when
 * the reader switches.
 */
const PER_PRESET_TOKENS = [
  // surfaces
  "--surface-inverse",
  "--surface-featured",
  "--surface-attention",
  "--surface-attention-border",
  // selection
  "--selected-surface",
  "--selected-ink",
  "--surface-nav-hover",
  // action
  "--action-surface-hover",
  // chart surfaces (the ECharts canvas reads these)
  "--chart-axis",
  "--chart-grid",
  "--chart-tooltip-surface",
  "--chart-tooltip-ink",
  "--chart-tooltip-border",
  // illustration art
  "--illustration-ink",
  "--illustration-primary",
  "--illustration-secondary",
  "--illustration-water",
  "--illustration-surface",
  "--illustration-accent",
];

describe("preset plug-and-play — both presets declare the same semantics", () => {
  it.each(SHARED_SEMANTIC_TOKENS)("declares %s once, in the shared layer", (name) => {
    expect(tokens(MINT_BLOCK).has(name), `${name} missing from the shared layer`).toBe(true);
    // Restating a shared token per preset is how the layer drifts.
    expect(
      tokens(LAVENDER_BLOCK).has(name),
      `${name} must follow the base palette, not be restated per preset`,
    ).toBe(false);
  });

  it.each(PER_PRESET_TOKENS)("declares %s in the default preset", (name) => {
    expect(tokens(MINT_BLOCK).has(name), `${name} missing from the default preset`).toBe(true);
  });

  it.each(PER_PRESET_TOKENS)("declares %s in the second preset", (name) => {
    expect(tokens(LAVENDER_BLOCK).has(name), `${name} missing from the second preset`).toBe(true);
  });
});

describe("Lavender Club — the approved Option B palette", () => {
  it("paints the pale lilac canvas and sidebar the reference shows", () => {
    // The reference: canvas #f8f7fc, sidebar #efebf7.
    expect(hexOf(LAVENDER_BLOCK, "--color-deck")).toBe("#F8F7FC");
    expect(hexOf(LAVENDER_BLOCK, "--color-sidebar")).toBe("#EFEBF7");
  });

  it("acts in the approved plum and reads in the approved aubergine", () => {
    // The reference: action #634889, ink #292136.
    expect(hexOf(LAVENDER_BLOCK, "--accent-strong")).toBe("#634889");
    expect(hexOf(LAVENDER_BLOCK, "--color-ink")).toBe("#292136");
  });

  it("keeps the selected navigation pill on the preset's own selection tokens", () => {
    const selected = hexOf(LAVENDER_BLOCK, "--selected-surface");
    const ink = hexOf(LAVENDER_BLOCK, "--selected-ink");
    expect(contrast(ink, selected)).toBeGreaterThanOrEqual(4.5);
  });

  it("gives the attention panel its own soft surface, not a status colour", () => {
    expect(hexOf(LAVENDER_BLOCK, "--surface-attention")).toMatch(/^#[0-9A-F]{6}$/);
    expect(hexOf(MINT_BLOCK, "--surface-attention")).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe.each([
  ["mint", MINT_BLOCK],
  ["lavender", LAVENDER_BLOCK],
])("preset %s — the approved surfaces stay readable", (_name, block) => {
  it("keeps body text at AA on the canvas, the sidebar and the raised surface", () => {
    const ink3 = hexOf(block, "--color-ink-3");
    const canvas = hexOf(block, "--color-deck");
    const paper = hexOf(block, "--color-paper");
    const sidebar = hexOf(block, "--color-sidebar");
    for (const bg of [canvas, paper, sidebar]) {
      expect(contrast(ink3, bg), `ink-3 on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the focus ring at 3:1 on every surface a control sits on", () => {
    const ring = hexOf(block, "--focus-ring");
    for (const surface of [
      "--color-deck",
      "--color-paper",
      "--color-sidebar",
      "--surface-attention",
    ]) {
      expect(
        contrast(ring, hexOf(block, surface)),
        `focus ring on ${surface}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps white text on the action surface readable", () => {
    expect(contrast("#FFFFFF", hexOf(block, "--accent-strong"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the chart tooltip surface readable against its own ink", () => {
    expect(
      contrast(
        hexOf(block, "--chart-tooltip-ink"),
        hexOf(block, "--chart-tooltip-surface"),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe("illustration art", () => {
  it("gives the artwork its own semantic colours in both presets", () => {
    for (const name of [
      "--illustration-ink",
      "--illustration-primary",
      "--illustration-secondary",
      "--illustration-water",
      "--illustration-surface",
      "--illustration-accent",
    ]) {
      expect(hexOf(MINT_BLOCK, name), `${name} missing from the default preset`).toMatch(
        /^#[0-9A-F]{6}$/,
      );
      expect(hexOf(LAVENDER_BLOCK, name), `${name} missing from the second preset`).toMatch(
        /^#[0-9A-F]{6}$/,
      );
    }
  });

  it("guards the gentle artwork motion behind prefers-reduced-motion", () => {
    // The artwork is static-first: it must not animate for a reader
    // who asked for reduced motion.
    expect(GLOBALS).toContain("prefers-reduced-motion");
    const reduced = mediaBlocks(GLOBALS, "prefers-reduced-motion: reduce");
    expect(
      reduced.some((block) => block.includes("illustration")),
      "a reduced-motion media block must neutralise the artwork motion",
    ).toBe(true);
  });
});
