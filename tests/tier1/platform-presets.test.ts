import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { listPresets, getActivePreset } from "@/db/platform-presets";

// Phase 2.1 — service-level proof for the preset catalogue read
// path. The two v1 presets land via the seedPlatformCatalogue
// extension to db/seed-platform.ts (per architecture §7.4 the
// schema was already created in migration 0007; this PR extends
// the seed, no new migration). The test suite relies on that
// seed — if the seed didn't run, the assertions below fail
// loudly and the regression surface is the same shape it would
// be on a production database.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

beforeAll(async () => {
  // Belt and suspenders: explicitly re-run the seed so a dev DB
  // that lost the rows (or never had them) is in a known state.
  // The seed is idempotent on (key, version), so running it again
  // is harmless.
  const { seedPlatformCatalogue } = await import("@/db/seed-platform");
  await seedPlatformCatalogue(env.MIGRATION_DATABASE_URL);
});

afterAll(async () => {
  await admin.end();
});

describe("listPresets", () => {
  it("returns at least the two v1 presets (swimming + multi-sport)", async () => {
    const presets = await listPresets();
    expect(presets.length).toBeGreaterThanOrEqual(2);
    const keys = presets.map((p) => p.key);
    expect(keys).toContain("swimming");
    expect(keys).toContain("multi-sport");
  });

  it("returns the catalogue metadata without parsing the full definition", async () => {
    // The list path doesn't pay the JSON-parse cost. The test
    // simply confirms the shape is what the picker UI consumes
    // (no `definition` field on the list entry).
    const presets = await listPresets();
    const swimming = presets.find((p) => p.key === "swimming");
    expect(swimming).toBeTruthy();
    expect(swimming).not.toHaveProperty("definition");
    expect(swimming?.name).toBe("Swimming academy");
    expect(swimming?.status).toBe("active");
    expect(swimming?.version).toBeGreaterThanOrEqual(1);
  });
});

describe("getActivePreset (swimming)", () => {
  it("returns the swimming row with the full definition parsed", async () => {
    const result = await getActivePreset("swimming");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    // Metadata sanity.
    expect(result.key).toBe("swimming");
    expect(result.version).toBeGreaterThanOrEqual(1);
    expect(result.status).toBe("active");

    // The Zod-parsed definition has the right shape. Spot-check
    // a few invariants that are core to the preset's purpose.
    const d = result.definition;
    expect(d.features).toContain("swim.levels");
    expect(d.features).toContain("pool.booking");
    expect(d.terminology).toMatchObject({
      student: "swimmer",
      lane: "lane",
    });
    expect(d.programs.length).toBeGreaterThan(0);
    expect(d.skillLevels.length).toBeGreaterThanOrEqual(3); // Beginner, Intermediate, Advanced
    expect(d.facilities.length).toBeGreaterThan(0);
    expect(d.facilities[0]?.subUnits.length).toBeGreaterThanOrEqual(1);
    expect(d.exampleBatches.length).toBeGreaterThan(0);
    expect(d.dashboardCards.length).toBeGreaterThan(0);
  });

  it("returns plan shapes with amountPaise = null (no seeded prices)", async () => {
    // Per architecture §7.4 the amountPaise field is deliberately
    // null — a seeded price becomes a billing dispute the moment
    // the first swimmer is invoiced. The test guards the invariant.
    const result = await getActivePreset("swimming");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.definition.planShapes.length).toBeGreaterThan(0);
    for (const shape of result.definition.planShapes) {
      expect(shape.amountPaise).toBeNull();
    }
  });

  it("returns skill rubrics with the four-level (1..4) structure", async () => {
    const result = await getActivePreset("swimming");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const firstSkill = result.definition.skillLevels[0]?.skills[0];
    expect(firstSkill).toBeTruthy();
    if (!firstSkill) return;
    expect(Object.keys(firstSkill.rubric).sort()).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    for (const level of [1, 2, 3, 4] as const) {
      expect(firstSkill.rubric[level].length).toBeGreaterThan(0);
    }
  });
});

describe("getActivePreset (multi-sport)", () => {
  it("returns the multi-sport row with empty vertical-specific content", async () => {
    // Multi-sport's whole point is "give me everything, load
    // nothing specific". Programs, skill levels, facilities, and
    // example batches are all empty arrays. The plan shapes are
    // the standard two; amountPaise is null.
    const result = await getActivePreset("multi-sport");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.definition.programs).toEqual([]);
    expect(result.definition.skillLevels).toEqual([]);
    expect(result.definition.facilities).toEqual([]);
    expect(result.definition.exampleBatches).toEqual([]);
    expect(result.definition.roles).toEqual([]);
    expect(result.definition.planShapes.length).toBe(2);
    for (const shape of result.definition.planShapes) {
      expect(shape.amountPaise).toBeNull();
    }
  });

  it("still enables the standard feature set (members, billing, etc.)", async () => {
    const result = await getActivePreset("multi-sport");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.definition.features).toContain("members");
    expect(result.definition.features).toContain("billing");
  });
});

describe("getActivePreset (error paths)", () => {
  it("returns not_found for an unknown key", async () => {
    const result = await getActivePreset("does-not-exist");
    expect(result).toEqual({ kind: "not_found" });
  });

  it("throws when the stored definition is malformed (data-integrity guard)", async () => {
    // Insert a deliberately broken definition directly via the
    // privileged pool, then verify the read path throws. The throw
    // is a fail-fast signal: a corrupted definition must not flow
    // into the apply engine silently.
    const brokenKey = "phase21-test-broken";
    const brokenVersion = 1;
    await admin.query(
      `insert into presets (key, version, name, description, definition, status)
       values ($1, $2, 'Broken', 'Test fixture', $3::jsonb, 'active')
       on conflict (key, version) do update set definition = excluded.definition`,
      [
        brokenKey,
        brokenVersion,
        JSON.stringify({
          // missing the required `features` array, missing
          // `terminology`, missing everything except name
          broken: true,
        }),
      ],
    );
    try {
      await expect(getActivePreset(brokenKey)).rejects.toThrow(
        /invalid definition/,
      );
    } finally {
      // Clean up so the seed re-run is safe.
      await admin.query("delete from presets where key = $1", [brokenKey]);
    }
  });
});
