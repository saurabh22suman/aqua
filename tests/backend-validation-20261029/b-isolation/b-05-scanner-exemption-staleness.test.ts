// Scanner check — are the two owner-surface exemptions in
// scripts/lib/location-scope-scan.ts still needed?
//
// Lane C fixed location scope in lib/services/owner-analytics.ts and
// lib/services/owner-reports.ts, so their tenant-wide allowlist reasons
// became stale and this lane (which owns the scanner file for this task)
// removed those two exemptions. The scanner ALGORITHM and every other
// allowlist entry are untouched.
//
// Portability: this test reads SHA-pinned source snapshots from its OWN
// fixtures/ directory (resolved relative to this file via import.meta.url),
// never from docs/ and never from the process cwd. A combined tree that
// copies tests without worker-only docs fixtures therefore still runs it.
// See fixtures/provenance.json for per-file SHA and provenance.
//
// Assertions:
//   - the two SCOPED snapshots (lane C's fixed sources) are NOT flagged;
//   - the two recorded BASE 239357f snapshots (pre-fix) ARE flagged, so the
//     scanner's detection ability is asserted against a fixed recorded
//     input rather than assumed from the current working tree;
//   - unrelated gaps are still detected and the other exemptions remain.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LOCATION_SCOPE_ALLOWLIST,
  scanLocationScope,
} from "@/scripts/lib/location-scope-scan";

const FIXTURES = new URL("./fixtures/", import.meta.url);

function fixtureSource(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, FIXTURES)), "utf8");
}

const SERVICE_PATHS = {
  analytics: "lib/services/owner-analytics.ts",
  reports: "lib/services/owner-reports.ts",
} as const;

const SCOPED_SOURCES = [
  { path: SERVICE_PATHS.analytics, file: "owner-analytics.scoped.ts.txt" },
  { path: SERVICE_PATHS.reports, file: "owner-reports.scoped.ts.txt" },
];

const BASE_SOURCES = [
  { path: SERVICE_PATHS.analytics, file: "owner-analytics.base-239357f.ts.txt" },
  { path: SERVICE_PATHS.reports, file: "owner-reports.base-239357f.ts.txt" },
];

describe("location-scope scanner: owner-surface exemptions are stale", () => {
  it.each(SCOPED_SOURCES)(
    "$path with lane C's scoped source is not flagged",
    ({ path, file }) => {
      const result = scanLocationScope(fixtureSource(file), path);
      expect(
        result.violation,
        "with the location helper in use, the scanner must not flag the file",
      ).toBe(false);
    },
  );

  it.each(BASE_SOURCES)(
    "$path at recorded base 239357f IS flagged (scanner detection proven)",
    ({ path, file }) => {
      const result = scanLocationScope(fixtureSource(file), path);
      expect(
        result.violation,
        "the recorded pre-fix source must still be flagged",
      ).toBe(true);
    },
  );

  it("both owner-surface exemptions are removed from the real allowlist", () => {
    for (const path of Object.values(SERVICE_PATHS)) {
      expect(
        LOCATION_SCOPE_ALLOWLIST[path],
        `${path} must no longer carry a scanner exemption`,
      ).toBeUndefined();
    }
  });

  it("the scanner still flags an unrelated service that queries members without the helper", () => {
    const source = `export async function x(tx: any) {
      return tx.select().from(members);
    }`;
    expect(scanLocationScope(source, "lib/services/known-bad.ts").violation).toBe(
      true,
    );
  });

  it("the scanner still flags a location-bearing table outside the helper for every allowlisted table's shape", () => {
    for (const table of ["members", "batches", "sessions", "attendance"]) {
      const source = `export async function x(tx: any) { return tx.select().from(${table}); }`;
      expect(
        scanLocationScope(source, "lib/services/known-bad.ts").violation,
        table,
      ).toBe(true);
    }
  });

  it("a comment mentioning the helper does not satisfy the rule", () => {
    const source = `// resolveLocationAccess(tx, ctx) goes here
export async function x(tx: any) { return tx.select().from(members); }`;
    expect(scanLocationScope(source, "lib/services/known-bad.ts").violation).toBe(
      true,
    );
  });

  it("the unrelated allowlist entries are untouched", () => {
    for (const key of [
      "lib/services/dashboard.ts",
      "lib/services/makeup.ts",
      "lib/services/facility-optins.ts",
      "lib/services/session-lifecycle.ts",
      "lib/services/coach-substitution.ts",
      "lib/services/coach-conflicts.ts",
      "lib/services/coach-load.ts",
      "lib/services/absence-alerts.ts",
      "lib/services/parent-view.ts",
      "lib/services/waitlist.ts",
      "lib/services/onboarding-checklist.ts",
      "lib/services/announcements.ts",
      "lib/services/announcement-audience.ts",
      "lib/services/wallet-core.ts",
      "lib/services/leave-approval.ts",
    ]) {
      expect(LOCATION_SCOPE_ALLOWLIST[key], key).toBeDefined();
    }
  });
});
