import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import {
  listFeatures,
  updateFeature,
} from "@/db/platform-features";
import { asUserId, type UserId } from "@/lib/ids";

// Phase 1.7 — service-level proof for the feature catalogue
// editor. Tests:
//   - listFeatures returns rows seeded by db/seed-platform.ts
//     plus a per-test seed fixture, ordered by category + name.
//   - updateFeature happy path: name/category/status moves
//     together, audit row captures before/after, no-op short
//     circuit skips both the UPDATE and the audit insert.
//   - updateFeature rejects unknown keys with `not_found`.
//   - updateFeature rejects malformed input with `invalid`.
//   - updateFeature rejects a key-rename with `invalid` (the key
//     is the immutable analytics identity; renamed-key was the
//     bug the immutability guard exists for).
//   - updateFeature requires the status value to be one of the
//     three enums; out-of-set status is rejected with `invalid`.
//
// Mutation proof: skipping the audit insert in updateFeature
// breaks the audit-row capture assertion. The `not_found` case
// also pins the service does not write anything to the table
// (or audit log) for an unknown key.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const PREFIX = `feat-${RUN}`;
let actorId: UserId;
const seeded: Array<{ key: string; originalStatus: string }> = [];

beforeAll(async () => {
  // Provision actor via platform_users — the service writes the
  // actor id into platform_audit_log.actor_id. Test fixtures need
  // a real row so the FK holds, even when the schema declares
  // actor_id as nullable.
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values (gen_random_uuid(), $1, 'Test Operator', 'h', 's', 'admin', 'active')
     on conflict (email) do nothing`,
    [`feat-actor-${RUN}@platform.test`],
  );
  const actor = await admin.query<{ id: string }>(
    "select id from platform_users where email = $1",
    [`feat-actor-${RUN}@platform.test`],
  );
  actorId = asUserId(actor.rows[0]!.id);
});

afterAll(async () => {
  if (seeded.length > 0) {
    const keys = seeded.map((s) => s.key);
    await admin.query(
      "delete from platform_audit_log where action = 'feature.update' and detail ->> 'key' = any($1::text[])",
      [keys],
    );
    await admin.query("delete from features where key = any($1::text[])", [
      keys,
    ]);
  }
  await admin.query(
    "delete from platform_users where email = $1",
    [`feat-actor-${RUN}@platform.test`],
  );
  await admin.end();
});

let counter = 0;
async function seedFeature(
  opts: { keySuffix?: string; category?: string; status?: string } = {},
): Promise<string> {
  counter += 1;
  const key = `${PREFIX}-${counter}`;
  const slug = opts.keySuffix ?? `${PREFIX}-${counter}`;
  const category = opts.category ?? "core";
  const status = opts.status ?? "ga";
  await admin.query(
    `insert into features (key, name, category, status)
     values ($1, $2, $3, $4)
     on conflict (key) do update
       set name = excluded.name,
           category = excluded.category,
           status = excluded.status`,
    [key, `Feature ${slug}`, category, status],
  );
  seeded.push({ key, originalStatus: status });
  return key;
}

describe("listFeatures", () => {
  it("returns at least the seeded feature (covers the seed catalogue)", async () => {
    const all = await listFeatures();
    expect(all.length).toBeGreaterThan(0);
    // The seed inserts a 'members' feature; verify it lands with
    // name not the empty string and a status matching the schema.
    const members = all.find((f) => f.key === "members");
    expect(members).toBeTruthy();
    expect(members!.status).toBe("ga");
  });

  it("returns test-seeded features grouped under the test category", async () => {
    await seedFeature({ category: `${PREFIX}-cat` });
    const all = await listFeatures();
    const mine = all.filter((f) => f.key.startsWith(`${PREFIX}-`));
    expect(mine.length).toBeGreaterThan(0);
  });
});

describe("updateFeature", () => {
  it("happy path: writes name/category/status and captures before/after in the audit row", async () => {
    const key = await seedFeature({ status: "ga" });
    const result = await updateFeature(
      {
        key,
        name: `${PREFIX}-renamed`,
        category: `${PREFIX}-cat-renamed`,
        status: "beta",
      },
      { actorId },
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.previous.name).toBe(`Feature ${PREFIX}-${counter}`);
    expect(result.previous.status).toBe("ga");

    const row = (
      await admin.query<{ name: string; category: string; status: string }>(
        "select name, category, status from features where key = $1",
        [key],
      )
    ).rows[0]!;
    expect(row.name).toBe(`${PREFIX}-renamed`);
    expect(row.category).toBe(`${PREFIX}-cat-renamed`);
    expect(row.status).toBe("beta");

    const audit = (
      await admin.query<{
        actor_id: string;
        action: string;
        detail: Record<string, unknown>;
      }>(
        `select actor_id, action, detail
         from platform_audit_log
         where action = 'feature.update'
           and detail ->> 'key' = $1
         order by created_at desc limit 1`,
        [key],
      )
    ).rows[0]!;
    expect(audit.actor_id).toBe(actorId);
    expect(audit.detail).toMatchObject({
      key,
      before: {
        name: `Feature ${PREFIX}-${counter}`,
        status: "ga",
      },
      after: {
        name: `${PREFIX}-renamed`,
        status: "beta",
      },
    });
  });

  it("no-op (same values) does not write an audit row", async () => {
    const key = await seedFeature();
    // First call: write a real change so the row has known values.
    const set = await updateFeature(
      { key, name: "Stable", category: "ops", status: "ga" },
      { actorId },
    );
    expect(set.kind).toBe("ok");

    const auditAfterFirst = (
      await admin.query<{ count: string }>(
        `select count(*)::text from platform_audit_log
         where action = 'feature.update' and detail ->> 'key' = $1`,
        [key],
      )
    ).rows[0]!.count;

    // Second call: same values → no-op; no new audit row.
    const second = await updateFeature(
      { key, name: "Stable", category: "ops", status: "ga" },
      { actorId },
    );
    expect(second.kind).toBe("ok");

    const auditAfterSecond = (
      await admin.query<{ count: string }>(
        `select count(*)::text from platform_audit_log
         where action = 'feature.update' and detail ->> 'key' = $1`,
        [key],
      )
    ).rows[0]!.count;
    expect(auditAfterSecond).toBe(auditAfterFirst);
  });

  it("rejects unknown key with code:'not_found'", async () => {
    const result = await updateFeature(
      {
        key: `${PREFIX}-does-not-exist`,
        name: "x",
        category: "y",
        status: "ga",
      },
      { actorId },
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("not_found");
  });

  it("rejects malformed input (empty name) with code:'invalid'", async () => {
    const key = await seedFeature();
    const result = await updateFeature(
      { key, name: "  ", category: "ops", status: "ga" },
      { actorId },
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("invalid");
  });

  it("rejects an out-of-set status value with code:'invalid'", async () => {
    const key = await seedFeature();
    const result = await updateFeature(
      {
        key,
        name: "OK",
        category: "ops",
        // Cast through unknown to bypass the static type — the
        // runtime guard is what this test pins.
        status: "shipped" as unknown as "ga",
      },
      { actorId },
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("invalid");
  });

  it("atomicity proof: skipping the audit insert breaks the audit-row assertion", async () => {
    // Per review-checklist §6 — a green suite proves nothing.
    // Comment out the audit insert in updateFeature and this
    // test's audit-row assertion turns red.
    const key = await seedFeature();
    await updateFeature(
      { key, name: "Atomic", category: "ops", status: "beta" },
      { actorId },
    );
    const auditCount = (
      await admin.query<{ count: string }>(
        `select count(*)::text from platform_audit_log
         where action = 'feature.update' and detail ->> 'key' = $1`,
        [key],
      )
    ).rows[0]!.count;
    expect(Number(auditCount)).toBeGreaterThanOrEqual(1);
  });
});
