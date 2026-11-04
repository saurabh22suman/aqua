// @vitest-environment jsdom
//
// Icon geometry equivalence (31 Oct 2026, tranche 2; made portable in
// tranche 3).
//
// The reviewed asset set is the ORIGIN of this family. This file checks
// that the integrated React glyphs still ARE those glyphs: the same
// elements, in the same order, with the same geometry — element for
// element — and the two tone slots kept distinct.
//
// The sixteen reviewed revision-1 SVG sources now live IN the
// repository, under `docs/design-system/icons/quiet24/svg/`, with their
// provenance in `docs/design-system/icons/quiet24/README.md`. This
// check therefore runs on a fresh checkout, in CI and on any machine:
// it does not depend on a private or ignored review directory, and it
// is never skipped for a missing file.
//
// The adaptation itself: the source SVG files were transcribed into
// typed static React. The only intended difference is the SECONDARY
// tone slot, which shipped in the study as a hex fallback and is
// integrated as a theme token (`--icon-secondary`, falling back to
// `--color-ink-3`). The geometry is unchanged.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { KhelIcon, KHEL_ICON_NAMES, type KhelIconName } from "@/components/icons/khel-icons";

// A repository-relative path: no absolute machine path, no ignored
// review scratch directory.
const ASSET_DIR = join("docs", "design-system", "icons", "quiet24", "svg");

/** The geometry of one element, without the tone slot. */
function shape(el: Element): string {
  const attrs = Array.from(el.attributes)
    .filter((attr) => attr.name !== "fill")
    .map((attr) => `${attr.name}=${attr.value}`)
    .sort()
    .join(",");
  return `${el.tagName}[${attrs}]`;
}

describe("the integrated glyphs are the reviewed originals", () => {
  it("has the reviewed source set in the repository", () => {
    expect(
      existsSync(ASSET_DIR),
      `the reviewed SVG sources are missing from ${ASSET_DIR}`,
    ).toBe(true);
  });

  it("carries every reviewed glyph file", () => {
    const files = readdirSync(ASSET_DIR)
      .filter((file) => file.endsWith(".svg"))
      .map((file) => file.replace(/\.svg$/, ""))
      .sort();
    expect(files).toEqual([...KHEL_ICON_NAMES].sort());
  });

  it("reproduces every reviewed geometry, element for element", () => {
    for (const name of KHEL_ICON_NAMES) {
      const source = readFileSync(join(ASSET_DIR, `${name}.svg`), "utf8");
      const doc = new DOMParser().parseFromString(source, "image/svg+xml");
      const parsed = doc.documentElement;
      expect(parsed.getAttribute("viewBox")).toBe("0 0 24 24");

      const { container } = render(<KhelIcon name={name as KhelIconName} />);
      const rendered = container.querySelector("svg")!;

      // The same elements, in the same order, with the same geometry.
      const expected = Array.from(parsed.children).map(shape);
      const actual = Array.from(rendered.children).map(shape);
      expect(actual).toEqual(expected);
    }
  });

  it("keeps the two tone slots distinct on every glyph", () => {
    for (const name of KHEL_ICON_NAMES) {
      const source = readFileSync(join(ASSET_DIR, `${name}.svg`), "utf8");
      const doc = new DOMParser().parseFromString(source, "image/svg+xml");
      const parsed = doc.documentElement;

      const { container } = render(<KhelIcon name={name as KhelIconName} />);
      const rendered = container.querySelector("svg")!;

      // The primary slot is a pinned theme token on the root…
      expect(rendered.getAttribute("fill")).toBe(
        "var(--icon-primary, var(--color-ink-2))",
      );
      // …and every shape that carried the study's secondary fill still
      // carries a secondary fill, in the theme token rather than the
      // study hex.
      const sourceSecondary = Array.from(parsed.children).filter(
        (el) => el.getAttribute("fill")?.startsWith("var(--icon-secondary"),
      );
      const renderedSecondary = Array.from(rendered.querySelectorAll("[fill]"));
      expect(renderedSecondary.length).toBe(sourceSecondary.length);
      for (const el of renderedSecondary) {
        const fill = el.getAttribute("fill") ?? "";
        expect(fill).toMatch(/^var\(--icon-secondary/);
        expect(fill).not.toBe("var(--icon-primary, var(--color-ink-2))");
        expect(fill).not.toMatch(/#[0-9a-f]{3,8}/i);
      }
    }
  });
});
