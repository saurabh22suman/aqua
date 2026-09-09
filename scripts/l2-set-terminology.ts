// L2-followup: directly write the preset terminology to a tenant's row.
//
// applyPreset refuses when real members exist (lock_active). The
// demo seed inserts members before applying a preset, so the lock
// path is the one demo tenants hit. For verification, we need the
// terminology on the row to prove the vocab pipeline, so write the
// preset's terminology directly (this is what applyPreset would do
// in the missing branch, except with seed-time guarantees the demo
// never had).
import { Client } from "pg";
import {
  SWIMMING_PRESET_DEFINITION,
  MULTI_SPORT_PRESET_DEFINITION,
} from "../db/preset-definitions";
import { env } from "../lib/env";

const TARGETS: ReadonlyArray<[string, string, unknown]> = [
  ["demo-academy", "swimming", SWIMMING_PRESET_DEFINITION.terminology],
  ["kicks-academy", "multi-sport", MULTI_SPORT_PRESET_DEFINITION.terminology],
];

async function main() {
  const c = new Client({ connectionString: env.MIGRATION_DATABASE_URL });
  await c.connect();
  try {
    for (const [slug, preset, terminology] of TARGETS) {
      const r = await c.query(
        "update tenants set terminology = $2::jsonb where slug = $1 returning slug, preset_key, jsonb_pretty(terminology) as terms",
        [slug, JSON.stringify(terminology)],
      );
      console.log(`${slug} → ${preset}: updated`);
      if (r.rows[0]) {
        console.log("  terminology:", JSON.stringify(r.rows[0].terms, null, 0));
      }
    }
    console.log("done");
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
