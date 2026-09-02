import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import {
  upsertTenantFeature,
  getAllOverriddenFeaturesForTenant,
  type UpsertTenantFeatureInput,
} from "@/db/platform-tenant-features";
import { asTenantId, asUserId, type UserId, type TenantId } from "@/lib/ids";

// Phase 1.8 — service-level proof for upsertTenantFeature().
//
// The service runs in withPlatformAdmin() and writes the
// tenant_features row + audit row inside one transaction. Tests:
//   - happy path: override enabled=true writes the row + audit
//   - override enabled=false writes the row + audit
//   - clear mode deletes the row + audit
//   - unknown feature_key returns feature_not_found
//   - unknown tenant_id returns tenant_not_found
//   - invalid input returns invalid (zod parse rejects)
//   - atomicity proof: comment out the audit insert → audit row
//     assertion breaks

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const PREFIX = `tf-${RUN}`;

let actorId: UserId;
const seededFeatures: string[] = [];
const seededTenants: TenantId[] = [];

beforeAll(async () => {
  // Mint an actor we can point platform_audit_log.actor_id at.
  // tenant_features.actor_id and tenants.created_by are nullable
  // uuid columns without FK enforcement on platform_users; we still
  // bind the audit row to a real user so the timeline reads
  // coherently to a reviewer running locally.
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values (gen_random_uuid(), $1, 'Test Operator', 'h', 's', 'admin', 'active')
     on conflict (email) do nothing`,
    [`tf-actor-${RUN}@platform.test`],
  );
  const actor = await admin.query<{ id: string }>(
    "select id from platform_users where email = $1",
    [`tf-actor-${RUN}@platform.test`],
  );
  actorId = asUserId(actor.rows[0]!.id);
});

afterAll(async () => {
  if (seededTenants.length > 0) {
    const ids = seededTenants.map((t) => t as unknown as string);
    await admin.query(
      "delete from platform_audit_log where tenant_id = any($1::uuid[])",
      [ids],
    );
    await admin.query(
      "delete from tenant_features where tenant_id = any($1::uuid[])",
      [ids],
    );
    await admin.query("delete from tenants where id = any($1::uuid[])", [ids]);
  }
  if (seededFeatures.length > 0) {
    await admin.query(
      "delete from features where key = any($1::text[])",
      [seededFeatures],
    );
  }
  await admin.query(
    "delete from platform_users where email = $1",
    [`tf-actor-${RUN}@platform.test`],
  );
  await admin.end();
});

let counter = 0;
async function seedFeature(): Promise<string> {
  counter += 1;
  const key = `${PREFIX}-feat-${counter}`;
  await admin.query(
    "insert into features (key, name, category, status) values ($1, 'Test', 'core', 'ga') on conflict (key) do nothing",
    [key],
  );
  seededFeatures.push(key);
  return key;
}

async function seedTenant(): Promise<TenantId> {
  counter += 1;
  const id = asTenantId(uuidv7());
  const slug = `${PREFIX}-t-${counter}`;
  await admin.query(
    "insert into tenants (id, slug, name, status) values ($1, $2, 'TF Test', 'trial')",
    [id, slug],
  );
  seededTenants.push(id);
  return id;
}

function baseInput(
  tenantId: TenantId,
  featureKey: string,
): UpsertTenantFeatureInput {
  return {
    tenantId,
    featureKey,
    mode: "override",
    enabled: true,
  };
}

describe("upsertTenantFeature (override mode)", () => {
  it("writes the tenant_features row and the audit row in one transaction (enabled=true)", async () => {
    const tenantId = await seedTenant();
    const featureKey = await seedFeature();
    const result = await upsertTenantFeature(
      baseInput(tenantId, featureKey),
      { actorId },
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    // Row 1: tenant_features.enabled = true
    const row = (
      await admin.query<{ enabled: boolean; expires_at: Date | null }>(
        "select enabled, expires_at from tenant_features where tenant_id = $1 and feature_key = $2",
        [tenantId, featureKey],
      )
    ).rows[0]!;
    expect(row.enabled).toBe(true);
    expect(row.expires_at).toBeNull();

    // Row 2: audit row tagged correctly
    const audit = (
      await admin.query<{
        action: string;
        detail: Record<string, unknown>;
      }>(
        `select action, detail from platform_audit_log
         where tenant_id = $1 and action = 'tenant_feature.upsert'`,
        [tenantId],
      )
    ).rows[0]!;
    expect(audit.detail).toMatchObject({
      featureKey,
      enabled: true,
    });
  });

  it("writes enabled=false and the audit row reflects it", async () => {
    const tenantId = await seedTenant();
    const featureKey = await seedFeature();
    const result = await upsertTenantFeature(
      { ...baseInput(tenantId, featureKey), enabled: false },
      { actorId },
    );
    expect(result.kind).toBe("ok");
    const row = (
      await admin.query<{ enabled: boolean }>(
        "select enabled from tenant_features where tenant_id = $1 and feature_key = $2",
        [tenantId, featureKey],
      )
    ).rows[0]!;
    expect(row.enabled).toBe(false);
  });

  it("captures expires_at when supplied", async () => {
    const tenantId = await seedTenant();
    const featureKey = await seedFeature();
    const future = new Date(Date.now() + 86400_000).toISOString();
    const result = await upsertTenantFeature(
      {
        ...baseInput(tenantId, featureKey),
        expiresAt: future,
      },
      { actorId },
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const row = (
      await admin.query<{ expires_at: Date | null }>(
        "select expires_at from tenant_features where tenant_id = $1 and feature_key = $2",
        [tenantId, featureKey],
      )
    ).rows[0]!;
    expect(row.expires_at).not.toBeNull();
    // The database stores to microsecond precision; allow a few ms.
    const actual = row.expires_at!.getTime();
    const expected = new Date(future).getTime();
    expect(Math.abs(actual - expected)).toBeLessThan(5_000);
  });

  it("upsert on the existing key updates in place (no duplicate row)", async () => {
    const tenantId = await seedTenant();
    const featureKey = await seedFeature();
    await upsertTenantFeature(baseInput(tenantId, featureKey), { actorId });
    await upsertTenantFeature(
      { ...baseInput(tenantId, featureKey), enabled: false },
      { actorId },
    );
    const rows = (
      await admin.query<{ enabled: boolean }>(
        "select enabled from tenant_features where tenant_id = $1 and feature_key = $2",
        [tenantId, featureKey],
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.enabled).toBe(false);
  });
});

describe("upsertTenantFeature (clear mode)", () => {
  it("deletes the override row and writes a clear audit row", async () => {
    const tenantId = await seedTenant();
    const featureKey = await seedFeature();
    // Seed the row first.
    await upsertTenantFeature(baseInput(tenantId, featureKey), { actorId });
    const beforeClear = (
      await admin.query<{ count: string }>(
        "select count(*)::text from tenant_features where tenant_id = $1",
        [tenantId],
      )
    ).rows[0]!.count;
    expect(Number(beforeClear)).toBe(1);

    // Clear it.
    const result = await upsertTenantFeature(
      { ...baseInput(tenantId, featureKey), mode: "clear" },
      { actorId },
    );
    expect(result.kind).toBe("ok");
    const afterClear = (
      await admin.query<{ count: string }>(
        "select count(*)::text from tenant_features where tenant_id = $1",
        [tenantId],
      )
    ).rows[0]!.count;
    expect(Number(afterClear)).toBe(0);

    // Audit row written with action='tenant_feature.clear'
    const audit = (
      await admin.query<{ action: string }>(
        `select action from platform_audit_log
         where tenant_id = $1 and action = 'tenant_feature.clear'`,
        [tenantId],
      )
    ).rows[0]!;
    expect(audit).toBeTruthy();
  });

  it("clear on a non-existent row returns ok (idempotent, no audit row)", async () => {
    const tenantId = await seedTenant();
    const featureKey = await seedFeature();
    const result = await upsertTenantFeature(
      { ...baseInput(tenantId, featureKey), mode: "clear" },
      { actorId },
    );
    expect(result.kind).toBe("ok");
    const audits = (
      await admin.query<{ count: string }>(
        `select count(*)::text from platform_audit_log
         where tenant_id = $1 and action = 'tenant_feature.clear'`,
        [tenantId],
      )
    ).rows[0]!.count;
    expect(Number(audits)).toBe(0);
  });
});

describe("upsertTenantFeature (rejections)", () => {
  it("returns 'feature_not_found' for an unknown key", async () => {
    const tenantId = await seedTenant();
    const result = await upsertTenantFeature(
      baseInput(tenantId, `${PREFIX}-does-not-exist`),
      { actorId },
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("feature_not_found");
  });

  it("returns 'tenant_not_found' for an unknown tenantId", async () => {
    const featureKey = await seedFeature();
    const fakeId = asTenantId(
      "00000000-0000-4000-8000-000000000000",
    );
    const result = await upsertTenantFeature(
      baseInput(fakeId, featureKey),
      { actorId },
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("tenant_not_found");
  });

  it("returns 'invalid' for malformed input (empty featureKey)", async () => {
    const tenantId = await seedTenant();
    const result = await upsertTenantFeature(
      { ...baseInput(tenantId, "ok-feature"), featureKey: "" },
      { actorId },
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("invalid");
  });
});

describe("upsertTenantFeature (atomicity)", () => {
  it("commenting the audit insert breaks the audit-row assertion", async () => {
    // Per review-checklist §6 — comment out the platform_audit_log
    // insert in upsertTenantFeature, and the audit-row assertions in
    // the override / clear tests above turn red.
    const tenantId = await seedTenant();
    const featureKey = await seedFeature();
    await upsertTenantFeature(baseInput(tenantId, featureKey), { actorId });
    const audit = (
      await admin.query<{ count: string }>(
        `select count(*)::text from platform_audit_log
         where tenant_id = $1 and action like 'tenant_feature.%'`,
        [tenantId],
      )
    ).rows[0]!.count;
    expect(Number(audit)).toBe(1);
  });
});

describe("getAllOverriddenFeaturesForTenant", () => {
  it("returns the rows written by upsertTenantFeature", async () => {
    const tenantId = await seedTenant();
    const featureKey = await seedFeature();
    await upsertTenantFeature(baseInput(tenantId, featureKey), { actorId });
    const rows = await getAllOverriddenFeaturesForTenant(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.featureKey).toBe(featureKey);
    expect(rows[0]?.enabled).toBe(true);
  });

  it("returns an empty array when no overrides exist", async () => {
    const tenantId = await seedTenant();
    const rows = await getAllOverriddenFeaturesForTenant(tenantId);
    expect(rows).toHaveLength(0);
  });
});
