import { expect, it } from "vitest";
import { completeEvidencePage as complete } from "@/scripts/lib/full-ci-evidence";
it("accepts a complete single-page API response", () => {
  expect(complete({ total_count: 1, workflow_runs: [{}] }, "workflow_runs")).toBe(true);
});
it("rejects malformed, missing and truncated evidence rather than trusting partial pages", () => {
  for (const page of [null, {}, { total_count: 1 }, { total_count: -1, check_runs: [] }, { total_count: 101, check_runs: Array(100).fill({}) }, { total_count: 1, check_runs: [] }]) {
    expect(complete(page, "check_runs")).toBe(false);
  }
});
