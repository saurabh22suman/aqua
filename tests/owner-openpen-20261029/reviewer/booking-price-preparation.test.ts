import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as driver from "./capture-owner";

// The responsive audit failed six cases on the booking-price route
// (both themes × three viewports):
//
//   keyboard-form-control-reached: 80 tab stops; formControl=false
//
// The oracle was wrong, not the page. The booking-price catalogue
// keeps its editor behind the page's OWN "Add price rule" control, and
// the driver never opened it: it looked for a form control on a page
// that honestly shows a button and a catalogue.
//
// The correction opens the page's existing control — the same way a
// person does — before the keyboard walk. Nothing is submitted, nothing
// is saved, no price is invented and no assertion is weakened.
//
// The driver's exports are read through a typed lookup, so this file
// runs against the pre-patch driver (where the preparation does not
// exist yet) and fails on an assertion rather than on a missing import.

type PreparedPage = {
  locator: (selector: string) => {
    count: () => Promise<number>;
    first: () => { click: () => Promise<void> };
  };
  waitForTimeout: (ms: number) => Promise<void>;
};

type CorrectedDriver = {
  prepareBookingPriceForm?: (page: PreparedPage) => Promise<boolean>;
};

const corrected = driver as unknown as CorrectedDriver;

function stubPage(controls: Record<string, number>) {
  const clicked: string[] = [];
  const page: PreparedPage = {
    locator: (selector: string) => ({
      count: async () => controls[selector] ?? 0,
      first: () => ({
        click: async () => {
          clicked.push(selector);
        },
      }),
    }),
    waitForTimeout: async () => {},
  };
  return { page, clicked };
}

describe("the responsive audit's booking-price preparation", () => {
  it("opens the page's own Add price rule control", async () => {
    expect(typeof corrected.prepareBookingPriceForm).toBe("function");

    const { page, clicked } = stubPage({
      '[data-testid="booking-price-add"]': 1,
    });
    const opened = await corrected.prepareBookingPriceForm!(page);

    expect(opened).toBe(true);
    expect(clicked).toEqual(['[data-testid="booking-price-add"]']);
  });

  it("does nothing when the route has no such control", async () => {
    expect(typeof corrected.prepareBookingPriceForm).toBe("function");

    const { page, clicked } = stubPage({});
    const opened = await corrected.prepareBookingPriceForm!(page);

    expect(opened).toBe(false);
    expect(clicked).toEqual([]);
  });

  it("runs the preparation for the booking-price view before the keyboard walk", () => {
    const source = readFileSync(join(process.cwd(), "tests/owner-openpen-20261029/reviewer/capture-owner.ts"), "utf8");

    expect(source).toContain("prepareBookingPriceForm");
    expect(source).toContain("responsive-booking-price");
  });
});
