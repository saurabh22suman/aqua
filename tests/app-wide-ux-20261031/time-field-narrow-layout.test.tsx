// @vitest-environment jsdom
//
// The shared TimeField — the NARROW layout contract (31 Oct 2026).
//
// THE MEASURED RED — the coordinator's independent production Chrome run
// (.playwright-mcp/app-wide-ux-20261031/chrome-standalone-6/review.json).
// The shared hour/minutes/AM-PM group clipped at 320 and 360, in BOTH the
// Ops activity filter and the reception enquiry follow-up:
//
//   reception follow-up, 320:  "AM"   7.75px of text room, needs 26.14px
//   reception follow-up, 360:  "AM"  19.67px of text room, needs 26.14px
//   Ops, 320:                 "AM/PM" 0.00px of text room, needs 26.14px
//                             "12"    7.39px of text room, needs 14.98px
//                             "00"    7.41px of text room, needs 21.55px
//   Ops, 360:                 "AM/PM" 22.06px of text room, needs 26.14px
//
// 390 is green. The cause is the shared primitive's own group: three
// tracks whose minimum is ZERO, so at a narrow width every select is
// compressed until its own text no longer fits. The fix belongs in the
// shared control, not in the pages that use it.
//
// The contract this file pins (LAYOUT INTENT):
//
//   1. No track may collapse: a select is never narrower than the text it
//      must show — the measured 16px "AM" needs 26.14px, plus the shared
//      control's own 54px of padding and border.
//   2. The group WRAPS when its container cannot fit three usable widths,
//      instead of squeezing three controls into one row.
//   3. No clipping, negative-spacing or tiny-text workaround.
//
// LAYOUT INTENT: this asserts the intended COMPOSITION, not a rendered
// measurement. The real geometry is the coordinator's Chrome pass after
// the rebuild; the numbers quoted above are that independent RED.
//
// The primitive's behaviour — canonical HH:mm, midnight and noon, partial
// and invalid reporting, labels, focus, disabled and native form
// behaviour — is already covered by
// tests/owner-openpen-20261029/shared/time-field.test.tsx and is not
// repeated here.
//
// PARKED, NOT DELETED — human steering, 31 October 2026: the Ops and
// reception FILTERS become date-only, so the consumer evidence that
// motivated this RED is withdrawn. The shared TimeField itself survives —
// scheduling forms keep their time controls — so this primitive-level
// contract stands until the coordinator's revised contract replaces it.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TimeField } from "@/components/ui/TimeField";

/** The shared select's own padding and border (pl-4 + pr-9 + 2px). */
const CONTROL_CHROME_PX = 54;
/** The measured text each control must be able to show, at 16px. */
const TEXT_NEEDS_PX = { hour: 14.98, minutes: 21.55, period: 26.14 };
/** A sub-pixel tolerance: the measurement is a browser measurement. */
const TOLERANCE_PX = 0.5;
/** The track must fit the widest control it carries — the AM/PM select. */
const WIDEST_NEED_PX = TEXT_NEEDS_PX.period + CONTROL_CHROME_PX;

afterEach(cleanup);

function renderTimeField() {
  render(
    <TimeField id="time-field" label="Time" value="12:00" onChange={() => {}} />,
  );
}

beforeEach(renderTimeField);

/** The row that holds the hour, minutes and AM/PM controls. */
function groupRow(): HTMLElement {
  const label = screen.getByLabelText("AM/PM").closest("label");
  const group = label?.parentElement;
  expect(group, "the AM/PM control has no group row").toBeTruthy();
  return group as HTMLElement;
}

/** The pixel minimum of every track the group declares for itself. */
function trackMinimums(classes: string): number[] {
  return Array.from(
    classes.matchAll(/min(?:max)?\(\s*([0-9.]+)px/g),
    (match) => Number(match[1]),
  );
}

/** The pixel minimum the group's own controls declare for themselves. */
function controlMinimums(group: HTMLElement): number[] {
  return Array.from(group.querySelectorAll<HTMLElement>("[class]")).flatMap((node) =>
    Array.from(
      (node.getAttribute("class") ?? "").matchAll(/min-w-\[([0-9.]+)px\]/g),
      (match) => Number(match[1]),
    ),
  );
}

describe("the shared TimeField — the narrow layout contract", () => {
  it("never lets a track collapse below the text its control must show (LAYOUT INTENT)", () => {
    const group = groupRow();
    const classes = group.getAttribute("class") ?? "";

    // A zero minimum is what let the AM/PM select collapse to nothing.
    expect(
      classes,
      "the group declares a zero-minimum track, so a select can collapse",
    ).not.toMatch(/minmax\(\s*0\s*,/);

    const declared = trackMinimums(classes);
    const minimums = declared.length > 0 ? declared : controlMinimums(group);
    expect(
      minimums.length,
      "the group declares no pixel minimum for its tracks",
    ).toBeGreaterThan(0);

    if (minimums.length === 1) {
      // One minimum for every track: it must fit the widest control.
      expect(minimums[0]).toBeGreaterThanOrEqual(WIDEST_NEED_PX - TOLERANCE_PX);
      return;
    }
    // One minimum per control, in the order the controls are rendered.
    expect(minimums, "the group declares one minimum per control").toHaveLength(3);
    const needs = [
      TEXT_NEEDS_PX.hour + CONTROL_CHROME_PX,
      TEXT_NEEDS_PX.minutes + CONTROL_CHROME_PX,
      TEXT_NEEDS_PX.period + CONTROL_CHROME_PX,
    ];
    minimums.forEach((minimum, index) => {
      expect(
        minimum,
        `track ${index} is narrower than the control it carries needs`,
      ).toBeGreaterThanOrEqual(needs[index]! - TOLERANCE_PX);
    });
  });

  it("wraps the group instead of squeezing three controls into one row (LAYOUT INTENT)", () => {
    const classes = groupRow().getAttribute("class") ?? "";
    // The group must be able to reflow when its container cannot fit
    // three usable widths — a content-responsive grid, or a row that
    // wraps. It is not a per-page fix and not a viewport guess.
    const contentResponsive = /auto-fit|auto-fill/.test(classes);
    const wrappingRow = /flex-wrap/.test(classes);
    expect(
      contentResponsive || wrappingRow,
      "the group cannot wrap: it lays three controls in one row and squeezes them",
    ).toBe(true);
  });

  it("uses no clipping or negative-spacing workaround (LAYOUT INTENT)", () => {
    const classes = groupRow().getAttribute("class") ?? "";
    expect(
      classes,
      "the group hides its overflow instead of wrapping",
    ).not.toMatch(/overflow-hidden/);
    expect(
      classes,
      "the group pulls its controls together with negative spacing",
    ).not.toMatch(/(?:^|\s)-[mp][xytrbl]?-\d/);
  });
});
