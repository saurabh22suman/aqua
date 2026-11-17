import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { startIsolatedDb, type IsolatedDb } from "@/tests/helpers/isolated-db";

const keys = ["DATABASE_URL", "MIGRATION_DATABASE_URL", "APP_LOGIN_PASSWORD"] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
let db: IsolatedDb;
let appPool: Pool | undefined;
beforeAll(async () => {
  db = await startIsolatedDb();
  process.env.DATABASE_URL = db.appUri;
  process.env.MIGRATION_DATABASE_URL = db.adminUri;
  process.env.APP_LOGIN_PASSWORD = "isolated-test-pw";
  execFileSync("pnpm", ["exec", "tsx", "scripts/seed.ts"], {
    env: { ...process.env, AQUA_NO_DOTENV: "1", NODE_ENV: "test" }, stdio: "pipe", timeout: 180_000,
  });
  vi.resetModules();
  appPool = (await import("@/db/client")).pool;
}, 240_000);
afterAll(async () => {
  try { try { await appPool?.end(); } finally { await db?.stop(); } }
  finally { for (const key of keys) { const value = original[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

it("returns only the authorized session venue and denies other coaches and tenants", async () => {
  const { rows: [fixture] } = await db.admin.query<{ session_id: string; tenant_id: string; user_id: string; location_id: string; name: string; membership_id: string }>(
    `select s.id session_id,s.tenant_id,st.user_id,l.id location_id,l.name,tm.id membership_id
     from sessions s join staff st on st.id=s.coach_id and st.tenant_id=s.tenant_id
     join locations l on l.tenant_id=s.tenant_id and l.is_primary and l.deleted_at is null
     join tenant_memberships tm on tm.user_id=st.user_id and tm.tenant_id=s.tenant_id and tm.status='active'
     join tenants t on t.id=s.tenant_id where t.slug='demo-academy' limit 1`,
  );
  expect(fixture).toBeDefined();
  await db.admin.query("update sessions set location_id=$1 where id=$2", [fixture.location_id, fixture.session_id]);
  const { getRosterForSession } = await import("@/lib/services/register");
  const { asTenantId, asUserId } = await import("@/lib/ids");
  const ctx = { tenantId: asTenantId(fixture.tenant_id), userId: asUserId(fixture.user_id), roleKey: "coach" };
  expect(await getRosterForSession(ctx, fixture.session_id)).toMatchObject({ locationName: fixture.name });
  expect(await getRosterForSession({ ...ctx, userId: asUserId(randomUUID()) }, fixture.session_id)).toBeNull();
  expect(await getRosterForSession({ ...ctx, tenantId: asTenantId(randomUUID()) }, fixture.session_id)).toBeNull();
  await db.admin.query("update tenant_memberships set all_locations=false where id=$1", [fixture.membership_id]);
  await db.admin.query("delete from membership_locations where membership_id=$1", [fixture.membership_id]);
  expect(await getRosterForSession(ctx, fixture.session_id)).toBeNull();
  await db.admin.query("update tenant_memberships set all_locations=true where id=$1", [fixture.membership_id]);
  await db.admin.query("update sessions set location_id=null where id=$1", [fixture.session_id]);
  expect(await getRosterForSession(ctx, fixture.session_id)).toMatchObject({ locationName: null });
}, 120_000);
