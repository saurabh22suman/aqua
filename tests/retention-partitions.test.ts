import { describe, expect, it } from "vitest";
import {
  selectDroppablePartitions,
  type RetentionPartition,
} from "@/scripts/lib/retention-partitions";

// E-06 retention — the pure decision half of the operator script.
//
// scripts/retention-activity-events.ts is the only path that may DROP
// an activity_events partition; this function decides which ones are
// eligible. It is deliberately pure so the boundary cases (a partition
// that ends exactly at the cutoff, one that straddles it, one in the
// future) are pinned without a database and without a DROP.

const CUTOFF = new Date("2026-09-18T00:00:00.000Z");

function partition(name: string, from: string, to: string): RetentionPartition {
  return { name, from: new Date(from), to: new Date(to) };
}

describe("selectDroppablePartitions", () => {
  it("returns partitions whose entire range ends at or before the cutoff", () => {
    const partitions = [
      partition("activity_events_2026_07", "2026-07-01T00:00:00Z", "2026-08-01T00:00:00Z"),
      partition("activity_events_2026_08", "2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z"),
      partition("activity_events_2026_09", "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z"),
    ];

    expect(selectDroppablePartitions(partitions, CUTOFF).map((p) => p.name)).toEqual([
      "activity_events_2026_07",
      "activity_events_2026_08",
    ]);
  });

  it("keeps a partition that straddles the cutoff", () => {
    const partitions = [
      partition("straddles", "2026-09-01T00:00:00Z", "2026-09-19T00:00:00Z"),
    ];
    expect(selectDroppablePartitions(partitions, CUTOFF)).toEqual([]);
  });

  it("treats a partition ending exactly at the cutoff as droppable", () => {
    const partitions = [
      partition("ends-at-cutoff", "2026-08-18T00:00:00Z", CUTOFF.toISOString()),
    ];
    expect(selectDroppablePartitions(partitions, CUTOFF)).toHaveLength(1);
  });

  it("never returns a partition that starts at or after the cutoff", () => {
    const partitions = [
      partition("future", "2026-09-18T00:00:00Z", "2026-10-18T00:00:00Z"),
    ];
    expect(selectDroppablePartitions(partitions, CUTOFF)).toEqual([]);
  });

  it("preserves input order and handles an empty list", () => {
    const partitions = [
      partition("b", "2026-06-01T00:00:00Z", "2026-07-01T00:00:00Z"),
      partition("a", "2026-05-01T00:00:00Z", "2026-06-01T00:00:00Z"),
    ];
    expect(selectDroppablePartitions(partitions, CUTOFF).map((p) => p.name)).toEqual([
      "b",
      "a",
    ]);
    expect(selectDroppablePartitions([], CUTOFF)).toEqual([]);
  });
});
