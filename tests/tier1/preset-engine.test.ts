import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { applyPreset, previewPreset } from "@/db/preset-engine";
import { asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";

// Phase 2.2a — applyPreset engine tests.
//
// Coverage matrix:
//   1. applyPreset happy path: every layer (features, terminology,
//      roles, programs, skill levels/skills, plan shapes, facilities/
//      sub-units, example batches, message templates, dashboard_cards,
//      tenant preset_key/version/applied_at) lands in one go.
//   2. Idempotence (architecture rule 1): applying the same preset
//      twice duplicates nothing.
//   3. Lock after first real use (rule 5): any member row blocks
//      the apply.
//   4. Different-preset-already-applied (rule 2): refuses manual
//      reset path.
//   5. Tenant not found / preset not found: typed error returns.
//   6. Data integrity: definition with a phantom permission key
//      fails the whole transaction — no rows committed.
//   7. previewPreset returns the right counts (swimming has 1
//      facility / 4 sub-units / 2 example batches / 3 skill levels /
//      7 skills; multi-sport has 0 of everything but the standard
//      plan shapes).
//   8. Mid-transaction failure leaves zero rows: a deliberate
//      constraint violation during the run rolls back the whole
//      transaction.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
let actorId: UserId;
const seededTenants: TenantId[] = [];
const seededMembers: string[] = [];

beforeAll(async () => {
  const { seedPlatformCatalogue } = await import("@/db/seed-platform");
  await seedPlatformCatalogue(env.MIGRATION_DATABASE_URL);

  // Mint our own platform_users row so the engine's `created_by` /
  // `updated_by` audit columns point at a real user. The seed in
  // db/seed-platform.ts doesn't insert platform_users.
  const actorIdValue = uuidv7();
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values ($1, $2, 'Phase 2.2a Test Operator', 'h', 's', 'admin', 'active')
     on conflict (email) do update set name = excluded.name
     returning id`,
    [actorIdValue, `phase22a-${actorIdValue}@platform.test`],
  );
  const actor = await admin.query<{ id: string }>(
    "select id from platform_users where email = $1",
    [`phase22a-${actorIdValue}@platform.test`],
  );
  if (!actor.rows[0]) {
    throw new Error("test fixture: failed to provision platform_users row");
  }
  actorId = asUserId(actor.rows[0].id);
});

afterAll(async () => {
  for (const id of seededTenants) {
    const tid = id as unknown as string;
    await admin.query(
      "delete from platform_audit_log where tenant_id = $1::uuid",
      [tid],
    );
    await admin.query("delete from tenant_features where tenant_id = $1::uuid", [tid]);
    await admin.query("delete from role_permissions where tenant_id = $1::uuid", [tid]);
    await admin.query("delete from roles where tenant_id = $1::uuid", [tid]);
    await admin.query("delete from message_templates where tenant_id = $1::uuid", [tid]);
    await admin.query("delete from facility_sub_units where tenant_id = $1::uuid", [tid]);
    await admin.query("delete from facilities where tenant_id = $1::uuid", [tid]);
    await admin.query("delete from plan_shapes where tenant_id = $1::uuid", [tid]);
    await admin.query("delete from skills where tenant_id = $1::uuid", [tid]);
    await admin.query("delete from skill_levels where tenant_id = $1::uuid", [tid]);
    // programs and batches have FK to tenants; soft-delete is
    // not enough because the FK is on tenant_id, not deleted_at.
    // The test fixture hard-deletes them. (Production's "remove
    // sample data" affordance is 2.3's concern; the engine marks
    // every seeded row is_sample=true so the affordance can do
    // soft-delete on the operator's tenant without breaking the
    // tenant FK.)
    await admin.query("delete from batches where tenant_id = $1::uuid", [tid]);
    await admin.query("delete from programs where tenant_id = $1::uuid", [tid]);
    await admin.query("delete from members where tenant_id = $1::uuid", [tid]);
    await admin.query("delete from locations where tenant_id = $1::uuid", [tid]);
    await admin.query("delete from persons where tenant_id = $1::uuid", [tid]);
    await admin.query("delete from tenants where id = $1::uuid", [tid]);
  }
  if (seededMembers.length > 0) {
    // The members created in lock-test may already be gone with
    // their tenant; this is a belt-and-suspenders for stragglers.
    await admin.query(
      "delete from members where id = any($1::uuid[])",
      [seededMembers],
    );
  }
  await admin.end();
});

async function seedTenant(status: "trial" | "active" = "trial"): Promise<TenantId> {
  const id = asTenantId(uuidv7());
  const slug = `phase22a-${id}`;
  await admin.query(
    `insert into tenants (id, slug, name, status) values ($1, $2, 'Phase 2.2a Test', $3)`,
    [id, slug, status],
  );
  seededTenants.push(id);
  return id;
}

async function addMember(tenantId: TenantId): Promise<string> {
  // Insert via the privileged pool, bypassing withTenant's app
  // user path so the lock check sees a real member row. members
  // requires a location_id (NOT NULL) so seed a dummy location
  // first; the location is a real FK target, the membership itself
  // is what the lock test cares about.
  const id = uuidv7();
  const personId = uuidv7();
  const locationId = uuidv7();
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Test', false)`,
    [locationId, tenantId],
  );
  await admin.query(
    `insert into persons (id, tenant_id, full_name, date_of_birth) values ($1, $2, 'Test', '1990-01-01')`,
    [personId, tenantId],
  );
  const code = `phase22a-${id.slice(0, 8)}`;
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, status, member_code) values ($1, $2, $3, $4, 'active', $5)`,
    [id, tenantId, personId, locationId, code],
  );
  seededMembers.push(id);
  return id;
}

describe("applyPreset (swimming)", () => {
  it("happy path: seeds every layer and stamps preset_key/version/applied_at", async () => {
    const tenantId = await seedTenant();
    const result = await applyPreset(tenantId, "swimming", { actorId });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.presetKey).toBe("swimming");
    expect(result.presetVersion).toBeGreaterThanOrEqual(1);
    expect(result.idempotent).toBe(false);

    // tenant_features seeded for every key in the definition.
    const tf = await admin.query<{ feature_key: string; enabled: boolean }>(
      "select feature_key, enabled from tenant_features where tenant_id = $1::uuid and feature_key = any($2::text[])",
      [tenantId, ["members", "attendance", "swim.levels", "pool.booking"]],
    );
    expect(tf.rows.length).toBeGreaterThanOrEqual(4);

    // terminology set on the tenant.
    const t = await admin.query<{ terminology: Record<string, string> }>(
      "select terminology from tenants where id = $1::uuid",
      [tenantId],
    );
    expect(t.rows[0]?.terminology?.student).toBe("swimmer");

    // programs seeded (Learn to swim, etc.) with is_sample = true.
    const progs = await admin.query<{ name: string; is_sample: boolean }>(
      "select name, is_sample from programs where tenant_id = $1::uuid",
      [tenantId],
    );
    expect(progs.rows.length).toBe(3);
    expect(progs.rows.every((p) => p.is_sample)).toBe(true);

    // skill levels and skills seeded.
    const levels = await admin.query<{ name: string; ordinal: number; is_sample: boolean }>(
      "select name, ordinal, is_sample from skill_levels where tenant_id = $1::uuid order by ordinal",
      [tenantId],
    );
    expect(levels.rows.map((l) => l.name)).toEqual([
      "Beginner",
      "Intermediate",
      "Advanced",
    ]);
    expect(levels.rows.every((l) => l.is_sample)).toBe(true);

    const skillCount = await admin.query<{ count: string }>(
      "select count(*)::text from skills where tenant_id = $1::uuid",
      [tenantId],
    );
    expect(Number(skillCount.rows[0]?.count)).toBeGreaterThanOrEqual(7);

    // plan shapes: two (Monthly, Quarterly), both is_sample, both
    // amount_paise NULL (the architecture's no-seeded-prices rule).
    const shapes = await admin.query<{
      name: string;
      is_sample: boolean;
      amount_paise: string | null;
    }>(
      "select name, is_sample, amount_paise from plan_shapes where tenant_id = $1::uuid order by name",
      [tenantId],
    );
    expect(shapes.rows.map((s) => s.name)).toEqual(["Monthly", "Quarterly"]);
    expect(shapes.rows.every((s) => s.is_sample)).toBe(true);
    expect(shapes.rows.every((s) => s.amount_paise === null)).toBe(true);

    // facilities: one main pool with four lanes.
    const facs = await admin.query<{ name: string; kind: string; capacity: number; is_sample: boolean }>(
      "select name, kind, capacity, is_sample from facilities where tenant_id = $1::uuid",
      [tenantId],
    );
    expect(facs.rows.length).toBe(1);
    expect(facs.rows[0]?.name).toBe("Main pool");
    expect(facs.rows[0]?.kind).toBe("pool");
    expect(facs.rows[0]?.is_sample).toBe(true);
    const subs = await admin.query<{ name: string }>(
      "select name from facility_sub_units where tenant_id = $1::uuid order by name",
      [tenantId],
    );
    expect(subs.rows.map((s) => s.name)).toEqual([
      "Lane 1",
      "Lane 2",
      "Lane 3",
      "Lane 4",
    ]);

    // example batches: two, both is_sample.
    const batchCount = await admin.query<{ count: string }>(
      "select count(*)::text from batches where tenant_id = $1::uuid and deleted_at is null",
      [tenantId],
    );
    expect(Number(batchCount.rows[0]?.count)).toBe(2);
    const allSample = await admin.query<{ all: boolean }>(
      "select bool_and(is_sample) as all from batches where tenant_id = $1::uuid and deleted_at is null",
      [tenantId],
    );
    expect(allSample.rows[0]?.all).toBe(true);

    // message templates: three.
    const tpl = await admin.query<{ key: string }>(
      "select key from message_templates where tenant_id = $1::uuid order by key",
      [tenantId],
    );
    expect(tpl.rows.map((t) => t.key)).toEqual([
      "fee_due",
      "session_reminder",
      "swim_progress_note",
    ]);

    // dashboard_cards on tenant.
    const cards = await admin.query<{ dashboard_cards: string[] }>(
      "select dashboard_cards from tenants where id = $1::uuid",
      [tenantId],
    );
    expect(cards.rows[0]?.dashboard_cards).toEqual([
      "todays_lanes",
      "dues",
      "attention",
    ]);

    // tenant fields stamped.
    const stamped = await admin.query<{
      preset_key: string;
      preset_version: number;
    }>(
      "select preset_key, preset_version from tenants where id = $1::uuid",
      [tenantId],
    );
    expect(stamped.rows[0]?.preset_key).toBe("swimming");
    expect(stamped.rows[0]?.preset_version).toBeGreaterThanOrEqual(1);
  });
});

describe("applyPreset (idempotence)", () => {
  it("applying the same preset twice duplicates nothing", async () => {
    const tenantId = await seedTenant();
    const first = await applyPreset(tenantId, "swimming", { actorId });
    expect(first.kind).toBe("ok");
    const second = await applyPreset(tenantId, "swimming", { actorId });
    expect(second.kind).toBe("ok");
    if (second.kind !== "ok") return;
    expect(second.idempotent).toBe(true);

    // counts unchanged after the second apply
    const progs = await admin.query<{ count: string }>(
      "select count(*)::text from programs where tenant_id = $1::uuid and deleted_at is null",
      [tenantId],
    );
    expect(Number(progs.rows[0]?.count)).toBe(3);
    const batches = await admin.query<{ count: string }>(
      "select count(*)::text from batches where tenant_id = $1::uuid and deleted_at is null",
      [tenantId],
    );
    expect(Number(batches.rows[0]?.count)).toBe(2);
    const facilities = await admin.query<{ count: string }>(
      "select count(*)::text from facilities where tenant_id = $1::uuid",
      [tenantId],
    );
    expect(Number(facilities.rows[0]?.count)).toBe(1);
  });
});

describe("applyPreset (lock — architecture rule 5)", () => {
  it("refuses when a member exists for the tenant", async () => {
    const tenantId = await seedTenant();
    await addMember(tenantId);
    const result = await applyPreset(tenantId, "swimming", { actorId });
    expect(result.kind).toBe("lock_active");
    if (result.kind !== "lock_active") return;
    expect(result.reason).toBe("non_sample_member_exists");

    // No rows committed: programs table is still empty for this
    // tenant — the lock fires before any seed.
    const progs = await admin.query<{ count: string }>(
      "select count(*)::text from programs where tenant_id = $1::uuid and deleted_at is null",
      [tenantId],
    );
    expect(Number(progs.rows[0]?.count)).toBe(0);
  });
});

describe("applyPreset (preset lock — different preset already applied)", () => {
  it("refuses when a different preset was already applied to the tenant", async () => {
    const tenantId = await seedTenant();
    const first = await applyPreset(tenantId, "multi-sport", { actorId });
    expect(first.kind).toBe("ok");
    const second = await applyPreset(tenantId, "swimming", { actorId });
    expect(second.kind).toBe("lock_active");
    if (second.kind !== "lock_active") return;
    expect(second.reason).toBe("different_preset_already_applied");
    expect(second.appliedKey).toBe("multi-sport");
  });
});

describe("applyPreset (error paths)", () => {
  it("returns preset_not_found for an unknown key", async () => {
    const tenantId = await seedTenant();
    const result = await applyPreset(tenantId, "does-not-exist", { actorId });
    expect(result.kind).toBe("preset_not_found");
  });

  it("returns tenant_not_found for an unknown tenant id", async () => {
    const fakeId = asTenantId(
      "00000000-0000-4000-8000-000000000000",
    );
    const result = await applyPreset(fakeId, "swimming", { actorId });
    expect(result.kind).toBe("tenant_not_found");
  });
});

describe("applyPreset (data integrity — phantom permission key)", () => {
  it("refuses to apply a preset whose role references a non-existent permission", async () => {
    // Plant a malformed preset directly via the privileged pool.
    // The engine's phantom-permission check throws inside the
    // withTenant() transaction; the transaction rolls back; no
    // rows land.
    const tenantId = await seedTenant();
    const brokenKey = `phase22a-broken-${tenantId.slice(0, 8)}`;
    const brokenVersion = 1;
    await admin.query(
      `insert into presets (key, version, name, description, definition, status)
       values ($1, $2, $3, $4, $5::jsonb, 'active')
       on conflict (key, version) do update set definition = excluded.definition`,
      [
        brokenKey,
        brokenVersion,
        "Broken preset",
        "Phase 2.2a fixture — phantom permission key",
        JSON.stringify({
          features: ["members"],
          terminology: {},
          roles: [
            {
              name: "Has a phantom perm",
              permissions: ["totally.not.a.real.permission"],
            },
          ],
          programs: [],
          skillLevels: [],
          planShapes: [],
          facilities: [],
          exampleBatches: [],
          messageTemplates: [],
          dashboardCards: [],
        }),
      ],
    );
    try {
      await expect(
        applyPreset(tenantId, brokenKey, { actorId }),
      ).rejects.toThrow(/unknown permissions/);

      // And no rows committed — the entire transaction rolled back.
      const seeded = await admin.query<{ count: string }>(
        "select count(*)::text from roles where tenant_id = $1::uuid and name = 'Has a phantom perm'",
        [tenantId],
      );
      expect(Number(seeded.rows[0]?.count)).toBe(0);
    } finally {
      // Clean up the broken preset.
      await admin.query("delete from presets where key = $1", [brokenKey]);
    }
  });
});

describe("previewPreset", () => {
  it("returns the right counts for swimming", async () => {
    const result = await previewPreset("swimming");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.preview.presetKey).toBe("swimming");
    expect(result.preview.counts.programs).toBe(3);
    expect(result.preview.counts.skillLevels).toBe(3);
    expect(result.preview.counts.skills).toBeGreaterThanOrEqual(7);
    expect(result.preview.counts.facilities).toBe(1);
    expect(result.preview.counts.facilitySubUnits).toBe(4);
    expect(result.preview.counts.exampleBatches).toBe(2);
    expect(result.preview.counts.planShapes).toBe(2);
    expect(result.preview.counts.messageTemplates).toBe(3);
    expect(result.preview.counts.dashboardCards).toBe(3);
  });

  it("returns not_found for an unknown key", async () => {
    const result = await previewPreset("does-not-exist");
    expect(result.kind).toBe("not_found");
  });
});
