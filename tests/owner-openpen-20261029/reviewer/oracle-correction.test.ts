import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as driver from "./capture-owner";

// The 29 October 2026 owner shell run recorded four failures that are
// REVIEWER errors, not product defects:
//
//   nav-text-contrast-both-themes | contrast=1.5; color=rgb(15, 50, 32);
//                                   sidebar=rgba(0, 0, 0, 0)
//   browser-back-restores-list-position | before=1100px; after=19px
//
// (a) The nav-text check read the SIDEBAR's computed background. That
//     box is transparent, and a transparent box was treated as black,
//     so the focused link's real surface — its own white selection
//     pill — was never measured. The visible colours always passed;
//     the oracle did not look at them.
//
// (b) The back-scroll check scrolled the list to 1100px and then
//     clicked the FIRST member row. Playwright scrolled that row back
//     into view (1100px -> 19px) before the click, so the browser
//     restored 19px — the position the click had caused — and the
//     oracle compared it with the stale 1100px.
//
// These tests pin the CORRECTED oracle. The driver's exports are read
// through a typed lookup, so this file runs against the pre-patch
// driver (where the corrected oracle does not exist yet) and fails on
// an assertion rather than on a missing import.

type Rgba = [number, number, number, number];

type CorrectedDriver = {
  paintedBackground?: (stack: ReadonlyArray<Rgba | null>) => Rgba;
  navContrastAgainstPainted?: (
    color: string,
    stack: ReadonlyArray<Rgba | null>,
  ) => number | null;
  firstVisibleMemberRowIndex?: (
    rows: ReadonlyArray<{ index: number; top: number; bottom: number }>,
    viewport: { height: number; stickyTop: number },
  ) => number | null;
  backScrollRestored?: (
    before: number,
    after: number,
    tolerance?: number,
  ) => boolean;
  parseCssColor?: (value: string) => Rgba | null;
  contrastRatio?: (foreground: Rgba, background: Rgba) => number;
};

const corrected = driver as unknown as CorrectedDriver;

const rgba = (r: number, g: number, b: number, a = 1): Rgba => [r, g, b, a];

// The captured mint nav ink and the captured lavender nav ink, as the
// run recorded them.
const MINT_INK = "rgb(15, 50, 32)";
const LAVENDER_INK = "rgb(76, 50, 111)";
// The owner selection pill is opaque white in BOTH presets
// (--owner-nav-active: #FFFFFF).
const WHITE = "rgb(255, 255, 255)";
const TRANSPARENT = "rgba(0, 0, 0, 0)";

describe("owner shell QA oracle corrections (29 October 2026)", () => {
  it("composites the painted background instead of reading a transparent box as black", () => {
    expect(typeof corrected.paintedBackground).toBe("function");
    const painted = corrected.paintedBackground!([
      rgba(255, 255, 255), // the link's own selection pill
      rgba(0, 0, 0, 0), // the sidebar box: transparent
    ]);
    expect(painted).toEqual([255, 255, 255, 1]);
  });

  it("keeps an alpha layer in the composite", () => {
    expect(typeof corrected.paintedBackground).toBe("function");
    const halfBlack = corrected.parseCssColor!("rgba(0, 0, 0, 0.5)")!;
    const white = corrected.parseCssColor!(WHITE)!;
    const painted = corrected.paintedBackground!([halfBlack, white]);
    expect(painted[0]).toBeCloseTo(127.5, 1);
    expect(painted[3]).toBeCloseTo(1, 2);
  });

  it("measures the nav contrast against the painted surface, not the sidebar box", () => {
    expect(typeof corrected.navContrastAgainstPainted).toBe("function");
    expect(typeof corrected.contrastRatio).toBe("function");
    const ink = corrected.parseCssColor!(MINT_INK)!;
    const transparent = corrected.parseCssColor!(TRANSPARENT)!;
    const white = corrected.parseCssColor!(WHITE)!;

    // The old reading: the transparent sidebar box treated as black.
    expect(corrected.contrastRatio!(ink, transparent)).toBeLessThan(4.5);

    // The corrected reading: the surface actually painted under the
    // text. Both owner presets pass.
    expect(
      corrected.navContrastAgainstPainted!(MINT_INK, [white, transparent]),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      corrected.navContrastAgainstPainted!(LAVENDER_INK, [white, transparent]),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps both owner nav palettes above 4.5:1 on the selection pill", () => {
    expect(typeof corrected.navContrastAgainstPainted).toBe("function");
    // --owner-nav-active-ink in the current combined source.
    expect(
      corrected.navContrastAgainstPainted!("rgb(31, 94, 58)", [rgba(255, 255, 255)]),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      corrected.navContrastAgainstPainted!("rgb(76, 50, 111)", [
        rgba(255, 255, 255),
      ]),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("clicks a member row that is already on screen", () => {
    expect(typeof corrected.firstVisibleMemberRowIndex).toBe("function");
    const rows = [
      // The row the old oracle clicked: off screen at the 1100px
      // scroll position, so the click scrolled it back into view.
      { index: 0, top: -670, bottom: -591 },
      { index: 1, top: 120, bottom: 198 },
      { index: 2, top: 220, bottom: 298 },
    ];
    expect(
      corrected.firstVisibleMemberRowIndex!(rows, { height: 900, stickyTop: 80 }),
    ).toBe(1);
    // A row under the sticky top bar is covered, not visible.
    expect(
      corrected.firstVisibleMemberRowIndex!([{ index: 0, top: 10, bottom: 88 }], {
        height: 900,
        stickyTop: 80,
      }),
    ).toBeNull();
    expect(
      corrected.firstVisibleMemberRowIndex!([], { height: 900, stickyTop: 80 }),
    ).toBeNull();
  });

  it("compares the restored position with the position at the click", () => {
    expect(typeof corrected.backScrollRestored).toBe("function");
    expect(corrected.backScrollRestored!(1100, 1100)).toBe(true);
    expect(corrected.backScrollRestored!(1100, 1061)).toBe(true);
    expect(corrected.backScrollRestored!(1100, 1059)).toBe(false);
  });

  it("never clicks the first member row blindly", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "tests/owner-openpen-20261029/reviewer/capture-owner.ts",
      ),
      "utf8",
    );
    expect(source).not.toContain("MEMBER_ROW_LINK_SELECTOR).first().click()");
    expect(source).toContain("MEMBER_ROW_LINK_SELECTOR).nth(visibleRow).click()");
  });

  it("reads the list scroll at click time, not the destination scroll", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "tests/owner-openpen-20261029/reviewer/capture-owner.ts",
      ),
      "utf8",
    );
    // The click starts a navigation, so the list scroll has to be read
    // in the capture phase, before the document is replaced.
    expect(source).toContain("aqua:member-list-scroll-at-click");
    expect(source).toContain("scrollAtClick");
    // The destination document's scroll is not evidence about the list.
    expect(source).not.toContain("afterClick");
  });

  it("lets the click assertion decide the record status", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "tests/owner-openpen-20261029/reviewer/capture-owner.ts",
      ),
      "utf8",
    );
    expect(source).toContain("const recordPass = backPass && clickKeptScroll;");
    expect(source).toContain('status: recordPass ? "CAPTURED" : "CHANGES REQUIRED"');
    expect(source).toContain("the click moved the list");
  });
});
