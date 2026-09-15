import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import type { IsolatedDb } from "./helpers/isolated-db";
import { startIsolatedDb } from "./helpers/isolated-db";

// PR2 (ops console improvements) — health has to run cross-tenant
// under withPlatformAdmin() without a per-tenant fan-out, because a
// query whose cost scales with tenant count is exactly the kind of
// thing that looks fine in dev with 5 tenants and falls over at 200.
// This test proves the query COUNT stays flat as tenant count grows
// from 5 to 200 (not just that it's "fast enough" at either size),
// and separately proves the join actually attaches each signal to
// the right tenant, not just that it runs without erroring.
//
// Runs against its own disposable Testcontainers Postgres, never the
// shared dev/CI database — the standing instruction for this PR is
// Testcontainers only. Statement counting works by wrapping every
// pooled client's .query() once a real connection is checked out
// (Drizzle's transaction() calls pool.connect(), not pool.query()),
// and excluding the driver/session plumbing (BEGIN/COMMIT/SET ROLE/
// set_config) so only application statements are counted — the same
// exclusion db/client.ts's own scope guard uses.

let isolated: IsolatedDb;
let listTenants: typeof import("@/db/platform-tenants").listTenants;
let appPool: typeof import("@/db/client").pool;
let queryLog: string[] = [];

const NON_STATEMENT_SQL = /^\s*(begin|commit|rollback|set\b|select\s+set_config)/i;

beforeAll(async () => {
  isolated = await startIsolatedDb();
  process.env.DATABASE_URL = isolated.appUri;
  process.env.MIGRATION_DATABASE_URL = isolated.adminUri;
  // lib/env.ts cross-checks APP_LOGIN_PASSWORD against the password
  // embedded in DATABASE_URL — extract it rather than hardcoding
  // isolated-db.ts's internal constant here.
  process.env.APP_LOGIN_PASSWORD = decodeURIComponent(
    new URL(isolated.appUri).password,
  );
  vi.resetModules();
  ({ listTenants } = await import("@/db/platform-tenants"));

  appPool = (await import("@/db/client")).pool;
  const pool = appPool;
  const origConnect = pool.connect.bind(pool);
  const WRAPPED = Symbol("query-count-wrapped");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pool as any).connect = async (...args: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = await (origConnect as any)(...args);
    // Pool clients are reused across connect() calls — wrap each
    // client's .query exactly once, or a client checked out N times
    // across the test file accumulates N stacked wrappers and every
    // real query gets counted N times, which is not "the number of
    // statements executed" at all.
    if (client[WRAPPED]) return client;
    client[WRAPPED] = true;
    const origQuery = client.query.bind(client);
    client.query = ((...qargs: unknown[]) => {
      const first = qargs[0] as string | { text?: string } | undefined;
      const text = typeof first === "string" ? first : first?.text ?? "";
      if (!NON_STATEMENT_SQL.test(text)) queryLog.push(text);
      return origQuery(...(qargs as Parameters<typeof origQuery>));
    }) as typeof client.query;
    return client;
  };
}, 180_000);

afterAll(async () => {
  // End the app pool's connections before stopping the container —
  // otherwise Postgres kills them out from under a still-open pool,
  // which node-postgres surfaces as an unhandled "terminating
  // connection due to administrator command" error after the test
  // has already finished.
  await appPool?.end();
  await isolated?.stop();
});

async function insertTenant(admin: IsolatedDb["admin"], overrides: {
  id: string;
  slug: string;
  status?: string;
  createdAt?: Date;
}): Promise<void> {
  await admin.query(
    `insert into tenants (id, slug, name, status, timezone, currency, created_at)
     values ($1, $2, $3, $4, 'Asia/Kolkata', 'INR', $5)`,
    [
      overrides.id,
      overrides.slug,
      `Tenant ${overrides.slug}`,
      overrides.status ?? "active",
      // Default to "now" so a fixture tenant starts inside the
      // no-activity grace period unless a test deliberately backdates
      // it — otherwise every fixture would need its own daily_rollups
      // row just to avoid an unrelated "No activity" signal.
      overrides.createdAt ?? new Date(),
    ],
  );
}

describe("tenant health — query shape and signal attachment", () => {
  it("attaches each signal to the correct tenant, not a neighbour's", async () => {
    const admin = isolated.admin;
    const healthy = uuidv7();
    const overdueTenant = uuidv7();
    const failedMsgTenant = uuidv7();
    const tenantIds = [healthy, overdueTenant, failedMsgTenant];

    for (const tid of tenantIds) {
      await insertTenant(admin, { id: tid, slug: `shape-${tid}` });
    }

    // One location + one member per tenant, so "zero members" doesn't
    // mask the signal actually under test in this fixture.
    const locationIdByTenant = new Map<string, string>();
    const memberIdByTenant = new Map<string, string>();
    for (const tid of tenantIds) {
      const locationId = (
        await admin.query<{ id: string }>(
          `insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true) returning id`,
          [uuidv7(), tid],
        )
      ).rows[0]!.id;
      locationIdByTenant.set(tid, locationId);

      const personId = (
        await admin.query<{ id: string }>(
          `insert into persons (id, tenant_id, full_name, date_of_birth) values ($1, $2, 'Fixture Member', '2000-01-01') returning id`,
          [uuidv7(), tid],
        )
      ).rows[0]!.id;

      const memberId = (
        await admin.query<{ id: string }>(
          `insert into members (id, tenant_id, person_id, location_id, member_code, status)
           values ($1, $2, $3, $4, $5, 'active') returning id`,
          [uuidv7(), tid, personId, locationId, `shape-${tid}`],
        )
      ).rows[0]!.id;
      memberIdByTenant.set(tid, memberId);
    }

    // Overdue invoice attached ONLY to overdueTenant.
    await admin.query(
      `insert into invoices
         (id, tenant_id, location_id, member_id, invoice_number, financial_year,
          issued_on, due_on, subtotal_paise, tax_paise, total_paise, status)
       values ($1, $2, $3, $4, 'INV-1', '2025-26',
               current_date - 30, current_date - 20, 100000, 0, 100000, 'issued')`,
      [
        uuidv7(),
        overdueTenant,
        locationIdByTenant.get(overdueTenant),
        memberIdByTenant.get(overdueTenant),
      ],
    );

    // Failed messages attached ONLY to failedMsgTenant.
    for (let i = 0; i < 3; i++) {
      await admin.query(
        `insert into message_log (id, tenant_id, direction, provider, status, category)
         values ($1, $2, 'outbound', 'mock', 'failed', 'utility')`,
        [uuidv7(), failedMsgTenant],
      );
    }

    const result = await listTenants({ search: "shape-" });
    const rows = new Map(result.rows.map((r) => [String(r.id), r]));

    expect(rows.get(healthy)?.health).toBe("healthy");
    expect(rows.get(overdueTenant)?.health).toBe("at_risk");
    expect(rows.get(overdueTenant)?.healthReasons.some((r) => r.includes("Invoice overdue"))).toBe(true);
    expect(rows.get(failedMsgTenant)?.health).toBe("attention");
    expect(rows.get(failedMsgTenant)?.healthReasons.some((r) => r.includes("failed messages"))).toBe(true);
  });

  it("issues a constant number of statements regardless of tenant count (5 vs 200)", async () => {
    const admin = isolated.admin;

    queryLog = [];
    await listTenants({ search: "count-check-nonexistent" });
    const statementsAtBaseline = queryLog.length;
    expect(statementsAtBaseline).toBeGreaterThan(0);

    // Bulk-insert 200 tenants in a single statement — the point is to
    // grow tenant count without growing the number of statements THIS
    // test itself issues while seeding.
    await admin.query(
      `insert into tenants (id, slug, name, status, timezone, currency, created_at)
       select gen_random_uuid(), 'perf-' || g, 'Perf Tenant ' || g, 'active',
              'Asia/Kolkata', 'INR', now() - (g || ' days')::interval
       from generate_series(1, 200) g`,
    );

    queryLog = [];
    const start = performance.now();
    const result = await listTenants({ search: "perf-", limit: 200 });
    const elapsedMs = performance.now() - start;
    const statementsAt200 = queryLog.length;

    expect(result.rows.length).toBe(200);
    expect(statementsAt200).toBe(statementsAtBaseline);
    console.log(
      `[tenant-health perf] 200 tenants: ${elapsedMs.toFixed(1)}ms, ${statementsAt200} SQL statements`,
    );
    // Generous ceiling — this asserts "did not fall over", not a
    // tuned performance budget. The query-count equality above is
    // the real regression guard.
    expect(elapsedMs).toBeLessThan(5000);
  }, 30_000);
});
