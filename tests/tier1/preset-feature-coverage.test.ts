import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireMigrationUrl } from "@/lib/env";

// L2-followup — preset feature coverage.
//
// The dance-ma preset (R.22 batch) referenced `levels.assess` in
// its features[] list — a permission key, not a feature key. The
// preset engine's tenant_features insert hit the FK to features.key
// and the apply rolled back. The hand-cross-check at audit time
// caught it; the mechanical version of that cross-check is this
// test. Every feature key in every exported *_PRESET_DEFINITION
// must exist as a row in the platform features table — otherwise
// applyPreset will roll back the transaction at FK violation time
// and the demo / tenant / preset will be silently broken.
//
// Source-tree extraction uses regex against the literal file,
// mirroring tests/tier1/preset-catalogue-coverage.test.ts. The
// shape:
//   export const FOO_PRESET_DEFINITION: PresetDefinition = ... {
//     ...
//     features: [
//       "members",
//       "pitch.booking",
//       ...
//     ],
//   }
// We extract the bracketed string-array body of every `features:`
// literal that follows a *_PRESET_DEFINITION declaration, and pull
// out every quoted token.

const ROOT = process.cwd();
const SCAN_DIR = "db";
const ADMIN = new Pool({ connectionString: requireMigrationUrl("tests/tier1/preset-feature-coverage.test.ts") });

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

interface PresetFeatures {
  constName: string;
  features: string[];
}

// Walk every preset-definition file, find every *_PRESET_DEFINITION
// constant, and pull out its features[] array contents as a list of
// string literals.
function extractPresetFeatures(): PresetFeatures[] {
  const out: PresetFeatures[] = [];
  const files = listTsFiles(join(ROOT, SCAN_DIR)).filter((f) =>
    /\/preset-definitions[^/]*\.ts$/.test(f),
  );
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    // Slice the file into per-constant chunks at every
    // "*_PRESET_DEFINITION:" header, then look inside each chunk
    // for a features: [...] array literal.
    const starts = [...text.matchAll(
      /export const ([A-Z][A-Z0-9_]*_PRESET_DEFINITION)\s*:/g,
    )];
    for (let i = 0; i < starts.length; i++) {
      const constName = starts[i]![1]!;
      const startIdx = starts[i]!.index ?? 0;
      const endIdx = i + 1 < starts.length
        ? (starts[i + 1]!.index ?? text.length)
        : text.length;
      const chunk = text.slice(startIdx, endIdx);
      const featuresMatch = chunk.match(/features\s*:\s*\[([\s\S]*?)\]/);
      if (!featuresMatch) continue;
      const body = featuresMatch[1]!;
      const keys = [
        ...body.matchAll(/"([a-z][a-z0-9._-]*)"/g),
      ].map((m) => m[1]!);
      if (keys.length > 0) out.push({ constName, features: keys });
    }
  }
  return out;
}

beforeAll(async () => {
  const { seedPlatformCatalogue } = await import("@/db/seed-platform");
  await seedPlatformCatalogue(requireMigrationUrl("tests/tier1/preset-feature-coverage.test.ts"));
});

afterAll(async () => {
  await ADMIN.end();
});

describe("L2-followup — every preset feature key exists in the features table", () => {
  it("the source tree has at least one preset with a features[] list", () => {
    const all = extractPresetFeatures();
    expect(all.length).toBeGreaterThanOrEqual(7);
  });

  it("every key referenced by every preset features[] exists in features.key", async () => {
    const all = extractPresetFeatures();
    const rows = await ADMIN.query<{ key: string }>(
      "select key from features order by key",
    );
    const known = new Set(rows.rows.map((r) => r.key));

    const missing: string[] = [];
    for (const { constName, features } of all) {
      for (const key of features) {
        if (!known.has(key)) {
          missing.push(`${constName} → "${key}"`);
        }
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `Preset features[] reference keys that do not exist in the features table:\n` +
          missing.map((m) => `  - ${m}`).join("\n") +
          `\n\n` +
          `db/seed-platform.ts FEATURES is the catalogue — every key in every preset's features[] must have a row.\n` +
          `A phantom feature key makes applyPreset roll back its entire transaction at FK violation time (audit L2-followup, dance-ma → levels.assess).`,
      );
    }
    expect(missing).toHaveLength(0);
  });
});