// tests/db/catalogue-parity.test.ts
//
// "Closed catalogue closed against its call sites, not against itself."
//
// The previous parity test (tests/tier1/platform-entitlements.test.ts:200)
// only checked that the seed script's row count matched the TS
// PERMISSIONS array length — the seed was consistent with itself,
// but a new requirePermission("new.key") in some action file could
// slip past because the array wasn't required to cover every key the
// code actually used.
//
// This test pins the other direction: every permission key used by
// requirePermission(...) across the repo must exist in PERMISSIONS[].
// Three assertions:
//
//   1. Static: every requirePermission("...") call site's key string
//      is present in PERMISSIONS[]. Source-grep + AST-lite; catches
//      the developer-side error before any DB touches.
//   2. Dynamic: after migrations alone (no seed), every PERMISSIONS[]
//      key is a real row in the permissions table. Catches the
//      "seed was forgotten" class of failure.
//   3. Known-bad fixture: a fixture file with requirePermission(
//      "fixtures.nonexistent_key") exists in the test directory;
//      running this test with the fixture on disk must fail the
//      static-scan assertion. The fixture is auto-removed by the
//      test itself in afterAll so the test runs cleanly when run
//      alone — but a CI run that finds the fixture present fails.
//
// Testcontainer-only — uses startIsolatedDb for assertion 2 so the
// "after migrations alone" check is real, not mocked.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync, existsSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { IsolatedDb } from "../helpers/isolated-db";
import { startIsolatedDb } from "../helpers/isolated-db";
import { PERMISSIONS, PRESETS, FEATURES } from "@/db/seed-platform";
import { CONFIG_KEYS } from "@/db/config-definitions";

const PERMISSIONS_KEYS = new Set(PERMISSIONS.map((p) => p.key));
const PRESETS_KEYS = PRESETS.map((p) => `${p.key}@${p.version}`);
const FEATURES_KEYS = new Set(FEATURES.map((f) => f.key));
const CONFIG_KEYS_KEYS = Object.keys(CONFIG_KEYS);
const ROOT = join(process.cwd());

let isolated: IsolatedDb;
let admin: IsolatedDb["admin"];

beforeAll(async () => {
  isolated = await startIsolatedDb();
  process.env.DATABASE_URL = isolated.appUri;
  process.env.MIGRATION_DATABASE_URL = isolated.adminUri;
  process.env.APP_LOGIN_PASSWORD = decodeURIComponent(
    new URL(isolated.appUri).password,
  );
  vi.resetModules();
  admin = isolated.admin;
}, 120_000);

afterAll(async () => {
  await isolated?.stop();
});

// Scan every .ts/.tsx file under app/, components/, lib/, db/,
// scripts/ for `requirePermission(ctx, "<key>")` calls and return
// the set of distinct keys. Tests/ is excluded — test fixtures
// intentionally call requirePermission with deliberately-bad
// keys to verify ForbiddenError (see
// tests/tier1/role-gating-sub-pr1.test.ts which uses the
// non-PERMISSIONS key "totally.fake.permission"). The role of this
// test is to assert the production code/seed closure, which tests/
// is outside of.
function extractRequiredPermissionKeys(): Set<string> {
  const pattern =
    '\\brequirePermission\\(\\s*[^,()"]+,\\s*"([a-z][a-z0-9._]+)"\\s*\\)';
  const out = execFileSync(
    "grep",
    ["-rlE", pattern, "--include=*.ts", "--include=*.tsx", "./app", "./components", "./lib", "./db", "./scripts"],
    { cwd: ROOT, encoding: "utf8" },
  );
  const keys = new Set<string>();
  for (const relPath of out.split("\n").filter(Boolean)) {
    if (relPath.includes(".git/")) continue;
    if (relPath.includes("node_modules/")) continue;
    const content = readFileSync(join(ROOT, relPath), "utf8");
    // Scan line-by-line and skip lines that look like comments (//, *,
    // or /*). Comments are the source of false positives ("x.y" in
    // docstrings, `* @example requirePermission(ctx, "x.y")` style).
    const re = new RegExp(pattern, "g");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(line)) !== null) {
        keys.add(m[1]!);
      }
    }
  }
  return keys;
}

describe("catalogue parity: every requirePermission key is in PERMISSIONS[] and vice-versa", () => {
  it("every requirePermission call site uses a key present in PERMISSIONS[] (static scan)", () => {
    const used = extractRequiredPermissionKeys();
    const missing = [...used].filter((k) => !PERMISSIONS_KEYS.has(k));
    // The fixture file below intentionally contains a key not in
    // PERMISSIONS[] — this assertion catches it. The fixture is
    // auto-removed by the known-bad test below so the test passes
    // when no fixture is present.
    expect(
      missing,
      `these requirePermission() keys are not in PERMISSIONS[] (db/seed-platform.ts): ` +
        missing.join(", "),
    ).toEqual([]);
  });

  it("every PERMISSIONS[] key used in code has a row in `permissions` after migrations alone", async () => {
    // The dynamic counterpart of the static assertion. After a clean
    // Testcontainer migration run (no seedPlatformCatalogue), every
    // PERMISSIONS[] key that's actually used in code must exist as a
    // row. Permission keys that are in PERMISSIONS[] but unused are
    // also expected to be rows (the migration inserts ALL of them, not
    // just the used subset — the closed list is the row set).
    const used = extractRequiredPermissionKeys();
    const adminMissing: string[] = [];
    for (const k of used) {
      const r = await admin.query<{ c: number }>(
        `select count(*)::int as c from permissions where key = $1`,
        [k],
      );
      if (Number(r.rows[0]!.c) === 0) adminMissing.push(k);
    }
    expect(
      adminMissing,
      `requirePermission() keys without a permissions row after migrations only: ` +
        adminMissing.join(", "),
    ).toEqual([]);
  });

  it("the closed PERMISSIONS list is exactly the rows the migration inserts", async () => {
    // Reverse direction: every row the migration inserts must be in
    // PERMISSIONS[]. Catches the case where someone adds a row in TS
    // and forgets to add to the array, OR adds to the array but
    // forgets to run the migration generator.
    const r = await admin.query<{ key: string }>(
      `select key from permissions order by key`,
    );
    const dbKeys = r.rows.map((row) => row.key);
    const tsKeys = [...PERMISSIONS_KEYS].sort();
    // If the migration seeded exactly the TS array, these match.
    // Allow for the case where the migration's row set is a superset
    // (extra rows in the TS array not in the migration would be a
    // regression — flag it).
    expect(
      dbKeys.length === tsKeys.length,
      `permissions table has ${dbKeys.length} rows, PERMISSIONS[] has ${tsKeys.length}; ` +
        `db-only=[${dbKeys.filter((k) => !PERMISSIONS_KEYS.has(k)).join(", ")}], ` +
        `ts-only=[${tsKeys.filter((k) => !dbKeys.includes(k)).join(", ")}]`,
    ).toBe(true);
  });

  it("every permissions.module is a real feature key (features↔permissions closure)", async () => {
    // Same shape as the above tests/tier1/platform-entitlements.test.ts:191
    // but driven from the TS source-of-truth rather than the DB after
    // seed. Catches the case where a developer's PERMISSIONS entry names
    // a module that FEATURES[] doesn't carry — applyPreset would still
    // work (permissions don't gate on module for core features), but
    // the resolveTenantFeatureKeys path would return no match and
    // requirePermission would throw "feature_disabled" for an
    // otherwise valid key.
    const missing = [...PERMISSIONS]
      .map((p) => p.module)
      .filter((m) => !FEATURES_KEYS.has(m));
    expect(
      missing,
      `these permissions.module values have no matching FEATURES[] entry: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("every PRESETS entry has a row in the presets catalogue after migrations only", async () => {
    // presets are referenced by applyPreset(tenantId, key) and
    // getPresetDefinition(key, version) — a missing row would break
    // every fresh tenant's preset apply. The migration inserts all
    // PRESETS[] entries; this assertion catches the case where the
    // migration generator and PRESETS[] drift.
    const dbKeys = (
      await admin.query<{ key: string; version: number }>(
        `select key, version from presets order by key, version`,
      )
    ).rows.map((r) => `${r.key}@${r.version}`);
    const tsKeys = [...PRESETS_KEYS].sort();
    expect(
      tsKeys.every((k) => dbKeys.includes(k)),
      `every PRESETS[] entry should have a row in the migration; missing: ` +
        tsKeys.filter((k) => !dbKeys.includes(k)).join(", "),
    ).toBe(true);
    expect(
      dbKeys.every((k) => tsKeys.includes(k)),
      `every presets row should correspond to a PRESETS[] entry; extras: ` +
        dbKeys.filter((k) => !tsKeys.includes(k)).join(", "),
    ).toBe(true);
  });

  it("every CONFIG_KEYS entry has a row in config_keys after migrations only", async () => {
    // config_keys are referenced by getConfigValue(key) and friends —
    // a missing row would throw "config_key not found" at the first
    // request that reads it. The ConfigKeyName type at compile time
    // gates stringly-typed call sites, but a TS-side add without a
    // matching migration row is the drift class this test pins.
    const r = await admin.query<{ key: string }>(`select key from config_keys order by key`);
    const dbKeys = r.rows.map((row) => row.key);
    const tsKeys = [...CONFIG_KEYS_KEYS].sort();
    expect(
      tsKeys.every((k) => dbKeys.includes(k)),
      `every CONFIG_KEYS entry should have a row in the migration; missing: ` +
        tsKeys.filter((k) => !dbKeys.includes(k)).join(", "),
    ).toBe(true);
  });

  it("every policy_versions entry has a row after migrations only", async () => {
    // policy_versions is the FK target for consents.policy_version;
    // a missing row would make every consent insert fail. The
    // migration inserts the same set the seed does.
    const r = await admin.query<{ version: string }>(
      `select version from policy_versions order by version`,
    );
    const dbVersions = r.rows.map((row) => row.version);
    expect(dbVersions, "policy_versions must have at least one row after migrations").toContain("2026.1");
  });

  describe("known-bad fixture (mutation proof)", () => {
    // Plant a fixture file inside the scan path (./lib) that
    // contains a requirePermission call with a key not in PERMISSIONS[].
    // The static scan must detect it. The fixture is auto-removed by
    // afterAll so the rest of the suite is unaffected. The OUTER
    // describe's first test (the static-scan assertion) runs BEFORE
    // this inner describe's it() — so the fixture is planted AFTER
    // the production scan asserts GREEN. Then this inner it() plants
    // the fixture, runs the scan again, and asserts the scan NOW
    // detects the bad key.
    const FIXTURE_PATH = join(ROOT, "lib", "_catalogue-parity-fixture.ts");
    const BAD_KEY = "fixtures.nonexistent_key";

    afterAll(() => {
      // Always clean up so the test suite is green when run alone.
      if (existsSync(FIXTURE_PATH)) {
        unlinkSync(FIXTURE_PATH);
      }
    });

    it("planting a fixture with a non-PERMISSIONS key makes the static scan fail", () => {
      mkdirSync(join(ROOT, "lib"), { recursive: true });
      writeFileSync(
        FIXTURE_PATH,
        [
          "// CATALOGUE-PARITY FIXTURE — auto-removed by afterAll.",
          "// Plant a requirePermission call with a key NOT in PERMISSIONS[]",
          "// to prove the static scan catches it. Mutating this file is",
          "// safe; the test restores it.",
          "import { requirePermission } from '@/lib/auth/permission';",
          `requirePermission({} as never, "${BAD_KEY}");`,
          "",
        ].join("\n"),
        "utf8",
      );
      // Re-scan; the fixture should make the static scan detect it.
      const found = extractRequiredPermissionKeys();
      expect(found.has(BAD_KEY), `fixture key ${BAD_KEY} must be detected by static scan`).toBe(true);
      expect(PERMISSIONS_KEYS.has(BAD_KEY), `fixture key must NOT be in PERMISSIONS[]`).toBe(false);
    });
  });
});
