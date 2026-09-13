import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXEMPTIONS,
  listPlatformActionFiles,
  scanOpsActions,
} from "@/scripts/lib/ops-action-scan";

// O-05 positive controls for the ops-action scan. The production scan
// runs in CI (pnpm check:ops-actions); this file proves the rule can
// fail on a known-bad input and stays green across the real tree.

const FIXTURES = join(process.cwd(), "tests", "scanner-fixtures", "fixtures");

describe("ops-action scan", () => {
  it("flags a known-bad action that mutates without opsAction", () => {
    const source = readFileSync(
      join(FIXTURES, "known-bad-ops-action.ts"),
      "utf8",
    );
    const violations = scanOpsActions(
      source,
      "lib/actions/platform-known-bad.ts",
    );
    expect(violations).toEqual([
      {
        file: "lib/actions/platform-known-bad.ts",
        functionName: "updateSomethingAction",
      },
    ]);
  });

  it("passes a known-good action that calls opsAction", () => {
    const source = readFileSync(
      join(FIXTURES, "known-good-ops-action.ts"),
      "utf8",
    );
    expect(
      scanOpsActions(source, "lib/actions/platform-known-good.ts"),
    ).toEqual([]);
  });

  it("passes an exempt action without opsAction", () => {
    const source = `export async function listPlatformActivityAction(): Promise<string[]> {
      return [];
    }`;
    expect(
      scanOpsActions(source, "lib/actions/platform-activity.ts"),
    ).toEqual([]);
  });

  it("fails an unexempted read-shaped action in a read-only file", () => {
    const source = `export async function sneakMutationAction(): Promise<void> {
      return;
    }`;
    const violations = scanOpsActions(
      source,
      "lib/actions/platform-activity.ts",
    );
    expect(violations).toHaveLength(1);
  });

  it("scans the real tree with no violations (CI parity)", () => {
    const violations = [];
    for (const file of listPlatformActionFiles()) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      violations.push(...scanOpsActions(source, file));
    }
    expect(violations).toEqual([]);
  });

  it("keeps every exemption pointed at a real file#function", () => {
    const sources = new Map(
      listPlatformActionFiles().map((file) => [
        file,
        readFileSync(join(process.cwd(), file), "utf8"),
      ]),
    );
    for (const entry of Object.keys(EXEMPTIONS)) {
      const [file, fn] = entry.split("#");
      const source = sources.get(file);
      expect(source, file).toBeTruthy();
      expect(source?.includes(`function ${fn}(`), entry).toBe(true);
    }
  });
});
