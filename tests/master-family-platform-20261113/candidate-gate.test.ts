import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("labels the safe candidate workflow as incomplete without the full integration gate", () => {
  const workflow = readFileSync(".github/workflows/khelsuite-safe-candidate.yml", "utf8");
  expect(workflow).toMatch(/GITHUB_STEP_SUMMARY/);
  expect(workflow).toMatch(/not (?:a |the )?full (?:integration |verification )?gate/i);
  expect(workflow).toMatch(/same (?:candidate|commit|revision)/i);
  expect(workflow).toMatch(/typecheck/i);
  expect(workflow).toMatch(/test:sharded/i);
});
it("requires exact candidate full CI evidence with read-only API permissions", () => {
  const workflow = readFileSync(".github/workflows/khelsuite-safe-candidate.yml", "utf8");
  expect(workflow).toMatch(/actions:\s*read/);
  expect(workflow).toMatch(/checks:\s*read/);
  expect(workflow).toMatch(/check-full-ci-evidence\.ts/);
  expect(workflow).toMatch(/GITHUB_TOKEN/);
});
