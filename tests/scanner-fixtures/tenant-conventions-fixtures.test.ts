import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isMigrationAtOrAfterCutoff,
  listNewMigrationFiles,
  PRE_TENANT_INDEX_EXEMPTIONS,
  scanTenantConventions,
} from "@/scripts/lib/tenant-conventions-scan";

// H-02 positive controls for the tenant-convention scan. The production
// scan runs in CI (pnpm check:tenant-conventions); this file proves the
// rules can fail on a known-bad input and stay green across the real
// new-migration set.

const FIXTURES = join(process.cwd(), "tests", "scanner-fixtures", "fixtures");

describe("tenant-conventions scan", () => {
  it("flags a non-tenant-leading index and a v4 default in a known-bad migration", () => {
    const source = readFileSync(
      join(FIXTURES, "known-bad-tenant-conventions.sql"),
      "utf8",
    );
    const violations = scanTenantConventions(
      source,
      "db/migrations/20260919000000_known_bad.sql",
    );
    expect(violations.map((v) => `${v.rule}:${v.line}`)).toEqual([
      "uuid-v4-default:5",
      "index-tenant-leading:10",
    ]);
    expect(violations[1]?.message).toContain("widget_id");
  });

  it("passes a known-good migration (tenant-first, platform exempt, pre-tenant exempt)", () => {
    const source = readFileSync(
      join(FIXTURES, "known-good-tenant-conventions.sql"),
      "utf8",
    );
    expect(
      scanTenantConventions(source, "db/migrations/20260919000001_good.sql"),
    ).toEqual([]);
  });

  it("keeps every pre-tenant exemption narrow and reasoned", () => {
    const entries = Object.entries(PRE_TENANT_INDEX_EXEMPTIONS);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, reason] of entries) {
      expect(key, key).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(reason.length, key).toBeGreaterThan(20);
    }
  });

  it("grandfathers migrations before the cutoff and scans the cutoff file itself", () => {
    expect(isMigrationAtOrAfterCutoff("20260918050000_h01.sql")).toBe(true);
    expect(isMigrationAtOrAfterCutoff("20260918051000_h02.sql")).toBe(true);
    expect(
      isMigrationAtOrAfterCutoff("20260918000000_reference_catalogue.sql"),
    ).toBe(false);
    expect(isMigrationAtOrAfterCutoff("0006_domain_schema.sql")).toBe(false);
  });

  it("scans the real new-migration set with no violations (CI parity)", () => {
    const files = listNewMigrationFiles();
    expect(files).toContain(
      "db/migrations/20260918050000_h01_hardening_indexes.sql",
    );
    const violations = files.flatMap((file) =>
      scanTenantConventions(
        readFileSync(join(process.cwd(), file), "utf8"),
        file,
      ),
    );
    expect(violations).toEqual([]);
  });
});
