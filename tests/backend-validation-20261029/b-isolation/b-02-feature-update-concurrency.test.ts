// H2 — db/platform-features.ts updateFeature: the comment claims a row lock
// ("SELECT FOR UPDATE on the row so concurrent edits can't both succeed")
// but the query carries no lock, so two concurrent catalogue edits can both
// succeed and the second audit row's `before` value is stale.
//
// The intended contract: concurrent edits to the same feature key are
// serialized, so every audit row's `before` equals the previous row's
// `after` — the audit trail is a chain, not a set of parallel snapshots.
//
// How the race is made DETERMINISTIC: the test holds the feature row's
// lock from a separate connection, starts two concurrent updateFeature
// calls (both block on their UPDATE), then releases the lock. Without a
// row lock in the SELECT, both transactions read the same `previous` row
// before either writes, so both audit rows record the same stale `before`.
// With the row lock, the second transaction re-reads the row after the
// first commits and records the correct chain.
//
// Fixture setup uses the privileged pool (tests/db/privileged-fixture.ts);
// every assertion runs through the application path (app_login ->
// app_user, platform scope) via db/platform-features.ts itself.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { pool } from "@/db/client";
import { withPlatform } from "@/db/scope";
import { updateFeature } from "@/db/platform-features";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";

const RUN = Date.now().toString(36);
const KEY = `bv-h2-${RUN}`;

let actorId: string;

type AuditRow = {
  id: string;
  detail: { before?: { name?: string }; after?: { name?: string } } | null;
};

beforeAll(async () => {
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values (gen_random_uuid(), $1, 'H2 Operator', 'h', 's', 'admin', 'active')
     on conflict (email) do nothing`,
    [`bv-h2-${RUN}@platform.test`],
  );
  const actor = await admin.query<{ id: string }>(
    "select id from platform_users where email = $1",
    [`bv-h2-${RUN}@platform.test`],
  );
  actorId = actor.rows[0]!.id;
  await admin.query(
    `insert into features (key, name, category, status) values ($1, 'H2 Original', 'core', 'ga')`,
    [KEY],
  );
});

afterAll(async () => {
  await admin.query(
    "delete from platform_audit_log where detail ->> 'key' = $1",
    [KEY],
  );
  await admin.query("delete from features where key = $1", [KEY]);
  await admin.query("delete from platform_users where email = $1", [
    `bv-h2-${RUN}@platform.test`,
  ]);
  await admin.end();
});

async function auditRows(): Promise<AuditRow[]> {
  const { rows } = await admin.query<AuditRow>(
    `select id, detail from platform_audit_log
      where action = 'feature.update' and detail ->> 'key' = $1
      order by created_at asc, id asc`,
    [KEY],
  );
  return rows;
}

describe("H2 — concurrent feature-catalogue edits keep the audit chain intact", () => {
  it("serializes concurrent edits so every audit 'before' equals the previous audit 'after'", async () => {
    const original = "H2 Original";
    const first = "H2 First";
    const second = "H2 Second";

    // A dedicated connection that holds the feature row's lock, so both
    // concurrent updateFeature calls block on their UPDATE and only
    // proceed once the lock is released. The row lock is taken inside a
    // platform scope: the application pool refuses unscoped statements
    // (db/client.ts's scope guard).
    const blocker = await pool.connect();
    let released = false;
    try {
      await blocker.query("begin");
      await withPlatform(() =>
        blocker.query(`select key from features where key = $1 for update`, [KEY]),
      );

      const firstCall = updateFeature(
        { key: KEY, name: first, category: "core", status: "ga" },
        { actorId: actorId as never },
      );
      const secondCall = updateFeature(
        { key: KEY, name: second, category: "core", status: "ga" },
        { actorId: actorId as never },
      );

      // Let both calls reach their UPDATE (and block on the held lock).
      await new Promise((r) => setTimeout(r, 150));
      await blocker.query("commit");
      blocker.release();
      released = true;

      const results = await Promise.all([firstCall, secondCall]);
      expect(results.every((r) => r.kind === "ok")).toBe(true);
    } finally {
      if (!released) {
        try {
          await blocker.query("rollback");
        } catch {
          // the transaction may already be closed
        }
        blocker.release();
      }
    }

    const rows = await auditRows();
    expect(rows, "both concurrent edits must be audited").toHaveLength(2);

    // The audit trail must be a chain: each row's `before` is the previous
    // row's `after`. Without the row lock both rows carry the same stale
    // `before` (the original name), which is the defect.
    const befores = rows.map((r) => r.detail?.before?.name);
    const afters = rows.map((r) => r.detail?.after?.name);
    expect(befores[0], "the first audit row records the original name").toBe(original);
    expect(
      befores[1],
      "the second audit row must record the first edit's result, not a stale snapshot",
    ).toBe(afters[0]);
    expect(afters).toContain(first);
    expect(afters).toContain(second);
  });

  it("keeps the feature row and its audit trail consistent after the concurrent edits", async () => {
    const { rows } = await admin.query<{ name: string }>(
      "select name from features where key = $1",
      [KEY],
    );
    const finalName = rows[0]!.name;
    const audit = await auditRows();
    const lastAfter = audit[audit.length - 1]!.detail?.after?.name;
    // Whichever edit committed last, the audit chain's final `after` must
    // equal the row's current name.
    expect(lastAfter).toBe(finalName);
  });

  it("a no-op edit writes no audit row (unchanged behaviour)", async () => {
    const { rows } = await admin.query<{ name: string }>(
      "select name from features where key = $1",
      [KEY],
    );
    const before = (await auditRows()).length;
    const result = await updateFeature(
      { key: KEY, name: rows[0]!.name, category: "core", status: "ga" },
      { actorId: actorId as never },
    );
    expect(result.kind).toBe("ok");
    expect((await auditRows()).length).toBe(before);
  });

  it("an unknown key writes nothing", async () => {
    const missing = `bv-h2-missing-${uuidv7()}`;
    const result = await updateFeature(
      { key: missing, name: "H2 Missing", category: "core", status: "ga" },
      { actorId: actorId as never },
    );
    expect(result.kind).toBe("error");
    const { rows } = await admin.query<{ n: number }>(
      `select count(*)::int as n from platform_audit_log where detail ->> 'key' = $1`,
      [missing],
    );
    expect(rows[0]!.n).toBe(0);
    const { rows: featureRows } = await admin.query(
      "select key from features where key = $1",
      [missing],
    );
    expect(featureRows).toHaveLength(0);
  });
});
