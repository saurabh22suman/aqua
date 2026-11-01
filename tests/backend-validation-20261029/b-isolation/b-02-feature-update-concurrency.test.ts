// Concurrent edits must serialize their audit state transitions. created_at
// is transaction time, not lock or insertion order, so it cannot order them.
// The held row lock brings both calls into contention before release.
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
  actor_id: string | null;
  detail: { before?: { name?: string }; after?: { name?: string } } | null;
};

// The chain is determined by recorded state transitions, never timestamps or
// the requested-call order. Every audit must participate exactly once.
function assertCausalChain(rows: AuditRow[], original: string, requested: string[], final: string, actor: string): void {
  const reject = () => { throw new Error("invalid audit chain"); };
  if (rows.length !== 2 || new Set(rows.map((r) => r.id)).size !== 2 ||
      rows.some((r) => r.actor_id !== actor)) reject();
  const starts = rows.filter((r) => r.detail?.before?.name === original);
  if (starts.length !== 1) reject();
  const start = starts[0]!;
  const remaining = rows.filter((r) => r.id !== start.id);
  const next = remaining[0]!;
  const firstAfter = start.detail?.after?.name;
  const lastAfter = next.detail?.after?.name;
  if (!firstAfter || !lastAfter || next.detail?.before?.name !== firstAfter ||
      firstAfter === original || lastAfter === firstAfter || lastAfter === original ||
      requested.length !== 2 || new Set(requested).size !== 2 ||
      !requested.includes(firstAfter) || !requested.includes(lastAfter) || final !== lastAfter) reject();
}

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
    `select id, actor_id, detail from platform_audit_log
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

      // Give both calls time to reach the held row lock.
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

    const { rows: current } = await admin.query<{ name: string }>(
      "select name from features where key = $1", [KEY],
    );
    assertCausalChain(rows, original, [first, second], current[0]!.name, actorId);
  });

  it("keeps the feature row and its audit trail consistent after the concurrent edits", async () => {
    const { rows } = await admin.query<{ name: string }>(
      "select name from features where key = $1",
      [KEY],
    );
    const finalName = rows[0]!.name;
    const audit = await auditRows();
    assertCausalChain(audit, "H2 Original", ["H2 First", "H2 Second"], finalName, actorId);
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


describe("causal audit chain validation", () => {
  const edge = (id: string, before: string, after: string): AuditRow => ({
    id, actor_id: "actor", detail: { before: { name: before }, after: { name: after } },
  });
  const original = edge("1", "original", "first");
  const next = edge("2", "first", "second");
  const check = (rows: AuditRow[], final = "second") =>
    assertCausalChain(rows, "original", ["first", "second"], final, "actor");

  it("accepts the same valid chain in either query order", () => {
    expect(() => check([original, next])).not.toThrow();
    expect(() => check([next, original])).not.toThrow();
  });
  it.each([
    ["duplicate id", [original, { ...next, id: "1" }], "second"],
    ["stale before", [original, edge("2", "original", "second")], "second"],
    ["fork", [original, edge("2", "original", "first")], "first"],
    ["disconnected", [original, edge("2", "elsewhere", "second")], "second"],
    ["final mismatch", [original, next], "first"],
    ["wrong actor", [original, { ...next, actor_id: "other" }], "second"],
    ["lost requested value", [original, edge("2", "first", "other")], "other"],
  ])("rejects %s", (_name, rows, final) => {
    expect(() => check(rows as AuditRow[], final as string)).toThrow("invalid audit chain");
  });
});
