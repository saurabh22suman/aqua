import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  listServiceFiles,
  LOCATION_SCOPE_ALLOWLIST,
  scanLocationScope,
} from "@/scripts/lib/location-scope-scan";

// O-08 positive controls for the location-scope scan.

const FIXTURES = join(process.cwd(), "tests", "scanner-fixtures", "fixtures");

describe("location-scope scan", () => {
  it("flags a service querying members without the helper", () => {
    const source = readFileSync(
      join(FIXTURES, "known-bad-location-scope.ts"),
      "utf8",
    );
    const result = scanLocationScope(source, "lib/services/known-bad.ts");
    expect(result.violation).toBe(true);
  });

  it("does not let a comment mentioning the helper satisfy the rule", () => {
    const source = `// resolveLocationAccess(tx, ctx) goes here
export async function x(tx: any) { return tx.select().from(members); }`;
    expect(
      scanLocationScope(source, "lib/services/known-bad-2.ts").violation,
    ).toBe(true);
  });

  it("passes a service that calls the helper", () => {
    const source = readFileSync(
      join(FIXTURES, "known-good-location-scope.ts"),
      "utf8",
    );
    expect(
      scanLocationScope(source, "lib/services/known-good.ts").violation,
    ).toBe(false);
  });

  it("does not flag files outside lib/services", () => {
    const source = `export async function x(tx: any) { return tx.select().from(members); }`;
    expect(scanLocationScope(source, "app/page.tsx").violation).toBe(false);
  });

  it("scans the real tree with no violations (CI parity)", () => {
    const violations = listServiceFiles().filter((file) => {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      return scanLocationScope(source, file).violation;
    });
    expect(violations).toEqual([]);
  });

  it("keeps every allowlist entry pointed at a real service file", () => {
    const files = new Set(listServiceFiles());
    for (const file of Object.keys(LOCATION_SCOPE_ALLOWLIST)) {
      expect(files.has(file), file).toBe(true);
    }
  });
});
