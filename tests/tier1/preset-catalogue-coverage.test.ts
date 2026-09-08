import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";

// L2 — preset catalogue coverage.
//
// The audit found five of seven v1 presets defined in source but
// not registered in the presets table. "Written-and-tested is not
// shipped." This test treats the source tree under
// db/preset-definitions*.ts as the contract: every exported
// `*_PRESET_DEFINITION` constant must have a corresponding active
// row in the presets table after seedPlatformCatalogue().
//
// Source-tree extraction deliberately uses regex against the
// literal file. The author of a preset adds a new file with a new
// constant; the test then picks it up at next run. Importing the
// constants would couple the test to a chosen listing and lose
// that property — the same reasoning
// tests/tier1/preset-key-runtime-reads.test.ts gives for hardcoding
// SCAN_DIRS rather than importing them.

const ROOT = process.cwd();
const SCAN_DIR = "db";
const ADMIN = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listTsFiles(full));
    else if (/\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

interface PresetConstant {
  constName: string;
  presetKey: string;
}

// Convert a UPPER_SNAKE_CASE_PRESET_DEFINITION into a kebab-case
// preset key. "SWIMMING_PRESET_DEFINITION" → "swimming",
// "BADMINTON_PRESET_DEFINITION" → "badminton", "START_FROM_SCRATCH_PRESET_DEFINITION"
// → "start-from-scratch". Hyphens within the source name survive;
// the trailing _PRESET_DEFINITION is stripped.
function constNameToPresetKey(constName: string): string {
  return constName
    .replace(/_PRESET_DEFINITION$/, "")
    .toLowerCase()
    .replace(/_/g, "-");
}

function extractPresetConstants(): PresetConstant[] {
  const out: PresetConstant[] = [];
  const files = listTsFiles(join(ROOT, SCAN_DIR)).filter((f) =>
    /\/preset-definitions[^/]*\.ts$/.test(f),
  );
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    // Match either a const declared from the schema's `.parse(...)`
    // call (the r22 file's shape) or a const declared as a literal
    // `{...}` (the canonical SWIMMING/MULTI_SPORT shape). Both must
    // produce a row in the presets table.
    const matches = text.matchAll(
      /^export const ([A-Z][A-Z0-9_]*_PRESET_DEFINITION)\s*:/gm,
    );
    for (const match of matches) {
      const constName = match[1]!;
      out.push({
        constName,
        presetKey: constNameToPresetKey(constName),
      });
    }
  }
  return out;
}

beforeAll(async () => {
  // Belt and suspenders: re-run the seed so a DB that lost rows or
  // never had them is in a known state. The seed is idempotent on
  // (key, version), so re-running is harmless.
  const { seedPlatformCatalogue } = await import("@/db/seed-platform");
  await seedPlatformCatalogue(env.MIGRATION_DATABASE_URL);
});

afterAll(async () => {
  await ADMIN.end();
});

describe("L2 — preset catalogue coverage", () => {
  it("the source tree exports at least the seven v1 preset constants", () => {
    const constants = extractPresetConstants();
    const keys = constants.map((c) => c.presetKey).sort();
    expect(keys.length).toBeGreaterThanOrEqual(7);
    expect(keys).toEqual(
      expect.arrayContaining([
        "swimming",
        "multi-sport",
        "start-from-scratch",
        "badminton",
        "gym",
        "football",
        "dance-ma",
      ]),
    );
    // Names of the constants, in source order. If a future preset
    // is added in a third file, both arrays will grow together —
    // a reviewer watches them move side-by-side.
    expect(keys).toEqual(keys.sort());
    expect([...keys].sort()).toEqual(keys);
  });

  it("the presets table contains every definition exported from the source tree", async () => {
    const constants = extractPresetConstants();
    const rows = await ADMIN.query<{ key: string; version: number }>(
      "select key, version from presets where status = 'active' order by key",
    );
    const dbKeys = new Set(rows.rows.map((r) => r.key));

    const missing: string[] = [];
    for (const { presetKey, constName } of constants) {
      if (!dbKeys.has(presetKey)) {
        missing.push(`${presetKey} (from ${constName})`);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `Preset constants defined in source but not registered in the presets table:\n` +
          missing.map((m) => `  - ${m}`).join("\n") +
          `\n\n` +
          `db/seed-platform.ts PRESETS is the catalogue — every exported *_PRESET_DEFINITION must have a row.\n` +
          `Written-and-tested is not shipped (audit L2).`,
      );
    }
    expect(missing).toHaveLength(0);
  });

  it("every presets row has a parseable definition against the current schema", async () => {
    // A row registered against a stale schema (e.g. one missing the
    // terminology-nested shape from L1) would fail to parse and the
    // apply path would throw at runtime. Walk every active row
    // through the schema and assert zero errors. This catches a
    // future schema-shape migration that the catalogue didn't follow.
    const { presetDefinitionSchema } = await import(
      "@/db/preset-definitions"
    );
    const rows = await ADMIN.query<{ key: string; definition: unknown }>(
      "select key, definition from presets where status = 'active'",
    );
    const failures: string[] = [];
    for (const row of rows.rows) {
      const result = presetDefinitionSchema.safeParse(row.definition);
      if (!result.success) {
        const messages = result.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
        failures.push(`${row.key}: ${messages}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(
        `Catalogue rows failed to parse against the current schema:\n` +
          failures.map((f) => `  - ${f}`).join("\n"),
      );
    }
    expect(failures).toHaveLength(0);
  });
});
