import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  listSourceFiles,
  scanPlatformLeadsImports,
} from "@/scripts/lib/platform-leads-import-scan";

// O-09 positive controls for the platform_leads import scan.

const FIXTURES = join(process.cwd(), "tests", "scanner-fixtures", "fixtures");

describe("platform_leads import scan", () => {
  it("flags a tenant-surface file importing the table directly", () => {
    const source = readFileSync(
      join(FIXTURES, "known-bad-leads-import.ts"),
      "utf8",
    );
    expect(
      scanPlatformLeadsImports(source, "app/(owner)/owner/page.tsx"),
    ).toBe(true);
  });

  it("allows the ops action importing the service", () => {
    const source = readFileSync(
      join(FIXTURES, "known-good-leads-import.ts"),
      "utf8",
    );
    expect(
      scanPlatformLeadsImports(source, "lib/actions/platform-leads.ts"),
    ).toBe(false);
  });

  it("allows the service importing its own schema", () => {
    expect(
      scanPlatformLeadsImports(
        `import { platformLeads } from "./schema/platform-leads";`,
        "db/platform-leads.ts",
      ),
    ).toBe(false);
  });

  it("does not flag the scan helpers' own filenames", () => {
    expect(
      scanPlatformLeadsImports(
        `import { listSourceFiles } from "./lib/platform-leads-import-scan";`,
        "scripts/check-platform-leads-imports.ts",
      ),
    ).toBe(false);
  });

  it("scans the real tree with no violations (CI parity)", () => {
    const violations = listSourceFiles().filter((file) =>
      scanPlatformLeadsImports(
        readFileSync(join(process.cwd(), file), "utf8"),
        file,
      ),
    );
    expect(violations).toEqual([]);
  });
});
