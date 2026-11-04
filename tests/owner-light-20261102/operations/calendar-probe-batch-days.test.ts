import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createBatchSchema } from "@/lib/schemas";

// The Calendar probe fixture (e2e/owner-redesign-c3-fixture.ts) inserts
// SYNTHETIC batches straight into the disposable database, so it bypasses
// the action's input validation. The product's own batch contract accepts
// weekdays 0-6 (the JS day indices the calendar's daysLabel prints); a
// "7" is not a weekday, and the calendar prints "Day not recognised" for
// that batch.
//
// This check validates the days the fixture ACTUALLY inserts against the
// application's existing batch input schema — the contract the product
// itself enforces — rather than comparing a source string.

const FIXTURE = join(process.cwd(), "e2e/owner-redesign-c3-fixture.ts");

/**
 * Every daysOfWeek array the fixture inserts into the BATCHES table.
 *
 * Only the batch inserts are read: the fixture also writes a booking
 * price rule, whose empty daysOfWeek means "every day" for a price and
 * is not a batch's weekday set.
 */
function insertedBatchDays(source: string): number[][] {
  const found: number[][] = [];
  for (const block of source.split(/insert\(/).slice(1)) {
    if (!block.startsWith("batches")) continue;
    const match = /daysOfWeek:\s*(\[[^\]]*\])/.exec(block);
    if (!match) continue;
    found.push(JSON.parse(match[1].replace(/'/g, '"')) as number[]);
  }
  return found;
}

describe("the Calendar probe fixture's synthetic batches", () => {
  it("inserts weekday arrays the product's batch input accepts", () => {
    const source = readFileSync(FIXTURE, "utf8");
    const arrays = insertedBatchDays(source);
    expect(arrays.length).toBeGreaterThan(0);

    for (const days of arrays) {
      // The app's own rule, read from its own schema.
      const parsed = createBatchSchema.shape.daysOfWeek.parse(days);
      expect(parsed).toEqual(days);
      // The probe wants a session EVERY day: the canonical seven.
      expect([...parsed].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    }
  });
});
