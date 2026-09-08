// L2-followup: the demo seed sets preset_key directly via SQL, bypassing
// applyPreset. That means tenants have a declared preset but empty
// terminology {} — vocab overrides never land. Fix the live DB by
// running applyPreset for both demo tenants. (scripts/seed-demo.ts
// should also do this in the right order; that's a follow-up.)
//
// applyPreset's idempotent branch (same preset_key already set)
// returns `ok` without re-writing terminology. So this script first
// clears preset_key/preset_version/preset_applied_at and allows a
// fresh apply.
import { Pool } from "pg";
import { applyPreset } from "../db/preset-engine";
import { asTenantId, asUserId, type UserId } from "../lib/ids";
import { env } from "../lib/env";

const TARGETS: Array<[string, string]> = [
  ["demo-academy", "swimming"],
  ["kicks-academy", "multi-sport"],
];

async function getOrCreateTestActor(c: Pool): Promise<UserId> {
  // platform_users row needed for the apply engine's created_by/updated_by.
  // The demo seed creates one but we reuse it via existing fixtures.
  const r = await c.query<{ id: string }>(
    "select id from platform_users where status = 'active' order by created_at asc limit 1",
  );
  if (r.rows[0]) return asUserId(r.rows[0].id);
  throw new Error("no platform actor; run scripts/seed-platform-user.ts first");
}

async function main() {
  const c = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
  const actor = await getOrCreateTestActor(c);
  for (const [slug, preset] of TARGETS) {
    const r = await c.query<{ id: string; preset_key: string }>(
      "select id, preset_key from tenants where slug = $1",
      [slug],
    );
    const t = r.rows[0];
    if (!t) {
      console.log(`skip ${slug} (not found)`);
      continue;
    }
    if (t.preset_key === preset) {
      // Clear the lock so applyPreset lands the full re-apply
      // rather than short-circuiting on its idempotency branch.
      await c.query(
        "update tenants set preset_key = NULL, preset_version = NULL, preset_applied_at = NULL, terminology = '{}'::jsonb where id = $1",
        [t.id],
      );
    }
    try {
      const result = await applyPreset(asTenantId(t.id), preset, { actorId: actor });
      console.log(`${slug} → ${preset}:`, result.kind);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`${slug} → ${preset}: error — ${msg.slice(0, 200)}`);
    }
  }
  await c.end();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
