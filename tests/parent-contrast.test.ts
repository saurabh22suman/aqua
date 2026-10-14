import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOKENS } from "@/lib/design-tokens";

// 2026-10-05 audit FE-07 — the parent document is rendered outside the
// Tailwind tree, and used an older palette that failed 4.5:1 for
// normal text. These tests pin the palette to globals.css and measure
// the actual text/status pairs the parent route renders.

function channel(hex: string, i: number): number {
  return parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
}

function luminance(hex: string): number {
  const linear = (c: number) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return (
    0.2126 * linear(channel(hex, 0)) +
    0.7152 * linear(channel(hex, 1)) +
    0.0722 * linear(channel(hex, 2))
  );
}

function contrast(foreground: string, background: string): number {
  const [a, b] = [luminance(foreground), luminance(background)].sort(
    (x, y) => y - x,
  );
  return (a + 0.05) / (b + 0.05);
}

describe("parent palette (FE-07)", () => {
  it("mirrors the approved tokens in app/globals.css", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const tokens: Array<[string, string]> = [
      ["paper", "--color-paper"],
      ["deck", "--color-deck"],
      ["ink", "--color-ink"],
      ["ink2", "--color-ink-2"],
      ["ink3", "--color-ink-3"],
      ["marine", "--color-marine"],
      ["water", "--color-water"],
      ["good", "--color-good"],
      ["goodSoft", "--color-good-soft"],
      ["late", "--color-late"],
      ["lateSoft", "--color-late-soft"],
      ["warn", "--color-warn"],
      ["warnSoft", "--color-warn-soft"],
    ];
    for (const [key, variable] of tokens) {
      const match = css.match(new RegExp(`${variable}:\\s*(#[0-9A-Fa-f]{6})`));
      expect(match, `${variable} missing from globals.css`).toBeTruthy();
      expect(TOKENS[key as keyof typeof TOKENS].toLowerCase()).toBe(
        match![1]!.toLowerCase(),
      );
    }
  });

  it("meets 4.5:1 for the text and status pairs the parent page renders", () => {
    const pairs: Array<[string, string, string]> = [
      ["ink on paper", TOKENS.ink, TOKENS.paper],
      ["ink2 on paper", TOKENS.ink2, TOKENS.paper],
      ["ink3 on paper", TOKENS.ink3, TOKENS.paper],
      ["ink3 on deck", TOKENS.ink3, TOKENS.deck],
      ["present on goodSoft", TOKENS.good, TOKENS.goodSoft],
      ["late on warnSoft", TOKENS.warn, TOKENS.warnSoft],
      ["absent on lateSoft", TOKENS.late, TOKENS.lateSoft],
      ["alert on warnSoft", TOKENS.warn, TOKENS.warnSoft],
      ["paper on marine", TOKENS.paper, TOKENS.marine],
    ];
    for (const [name, fg, bg] of pairs) {
      expect(contrast(fg, bg), `${name} (${fg} on ${bg})`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });
});
