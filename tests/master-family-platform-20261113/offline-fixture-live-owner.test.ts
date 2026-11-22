import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { startIsolatedDb, type IsolatedDb } from "@/tests/helpers/isolated-db";
import type { Pool } from "pg";

const envKeys = ["DATABASE_URL", "MIGRATION_DATABASE_URL", "APP_LOGIN_PASSWORD"] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
let db: IsolatedDb;
let appPool: Pool | undefined;
beforeAll(async () => {
  db = await startIsolatedDb();
  process.env.DATABASE_URL = db.appUri;
  process.env.MIGRATION_DATABASE_URL = db.adminUri;
  process.env.APP_LOGIN_PASSWORD = "isolated-test-pw";
  execFileSync("pnpm", ["exec", "tsx", "scripts/seed.ts"], {
    env: { ...process.env, AQUA_NO_DOTENV: "1", NODE_ENV: "test", DATABASE_URL: db.appUri, MIGRATION_DATABASE_URL: db.adminUri, APP_LOGIN_PASSWORD: "isolated-test-pw" },
    stdio: "pipe", timeout: 180_000,
  });
  vi.resetModules();
  appPool = (await import("@/db/client")).pool;
}, 240_000);
afterAll(async () => {
  try {
    try { await appPool?.end(); }
    finally { await db?.stop(); }
  } finally {
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

it("creates and enrols a scoped synthetic roster as the seeded live owner", async () => {
  const { setupOfflineFixture, cleanupOfflineFixture } = await import("@/scripts/lib/offline-fixture");
  const fixture = await setupOfflineFixture(db.admin, randomUUID().slice(0, 8), 2);
  try {
    expect(fixture.memberIds).toHaveLength(2);
    const rows = await db.admin.query<{ role_key: string; action: string; n: number }>(
      `select r.key as role_key, a.action, count(*)::int as n from audit_log a
       join tenant_memberships tm on tm.tenant_id=a.tenant_id and tm.user_id=a.actor_id
       join roles r on r.id=tm.role_id and r.tenant_id=tm.tenant_id
       where a.tenant_id=$1 and a.action in ('member.create','member.enrol')
         and (a.entity_id=any($2::uuid[]) or (a.after->>'batchId')=$3)
       group by r.key,a.action order by a.action`,
      [fixture.tenantId, fixture.memberIds, fixture.batchId],
    );
    expect(rows.rows).toEqual([
      { role_key: "owner", action: "member.create", n: 2 },
      { role_key: "owner", action: "member.enrol", n: 2 },
    ]);
  } finally { await cleanupOfflineFixture(db.admin, fixture); }
}, 120_000);

it("refuses a revoked owner before creating the fixture batch", async () => {
  const { setupOfflineFixture } = await import("@/scripts/lib/offline-fixture");
  const { rows: [owner] } = await db.admin.query<{ id: string; tenant_id: string }>(
    `select tm.id, tm.tenant_id from tenant_memberships tm
     join users u on u.id=tm.user_id join tenants t on t.id=tm.tenant_id
     where t.slug='demo-academy' and u.phone='+919000000001'`,
  );
  const run = randomUUID().slice(0, 8);
  await db.admin.query("update tenant_memberships set status='revoked' where id=$1", [owner.id]);
  try {
    await expect(setupOfflineFixture(db.admin, run, 1)).rejects.toThrow("live seeded owner");
    const result = await db.admin.query("select id from batches where tenant_id=$1 and name=$2", [owner.tenant_id, `Offline Test ${run}`]);
    expect(result.rows).toHaveLength(0);
  } finally { await db.admin.query("update tenant_memberships set status='active' where id=$1", [owner.id]); }
}, 120_000);

it("cleans a failed duplicate setup without deleting the existing roster", async () => {
  const { setupOfflineFixture, cleanupOfflineFixture } = await import("@/scripts/lib/offline-fixture");
  const run = randomUUID().slice(0, 8);
  const first = await setupOfflineFixture(db.admin, run, 1);
  try {
    await expect(setupOfflineFixture(db.admin, run, 1)).rejects.toThrow();
    const batches = await db.admin.query("select id from batches where tenant_id=$1 and name=$2", [first.tenantId, `Offline Test ${run}`]);
    expect(batches.rows.map((row: { id: string }) => row.id)).toEqual([first.batchId]);
    const members = await db.admin.query("select id from members where tenant_id=$1 and id=any($2::uuid[])", [first.tenantId, first.memberIds]);
    expect(members.rows).toHaveLength(1);
  } finally { await cleanupOfflineFixture(db.admin, first); }
}, 120_000);
