// tests/platform-metrics-snapshot-scope.test.ts
//
// Item 7 (PR #175 audit follow-up) — the snapshot job is the ONE
// legitimate writer of platform_metrics_daily. This test proves it
// mechanically, by mutation: each direction is exercised and the
// alternative scope is asserted to be the one that fails.
//
//   * withPlatformAdmin can READ platform_metrics_daily (Overview
//     needs it) but can NO LONGER write to it.
//   * withPlatformMetricsWriter CAN write to platform_metrics_daily
//     but CANNOT write to any tenant table.
//
// The migration that introduces the two policies is
// 20260917000000_platform_metrics_writer_scope.sql; this test would
// fail without that migration (withPlatformAdmin would still write).
//
// Testcontainers only — never the shared dev DB.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { IsolatedDb } from "./helpers/isolated-db";
import { startIsolatedDb } from "./helpers/isolated-db";

// Postgres SQLSTATE: 42501 = insufficient_privilege, surfaced
// from RLS policies and from table-level grants.
const PG_INSUFFICIENT_PRIVILEGE = "42501";

let isolated: IsolatedDb;
let withPlatformAdmin: typeof import("@/db/scope").withPlatformAdmin;
let withPlatformMetricsWriter: typeof import("@/db/scope").withPlatformMetricsWriter;
let appPool: typeof import("@/db/client").pool;

beforeAll(async () => {
  isolated = await startIsolatedDb();
  process.env.DATABASE_URL = isolated.appUri;
  process.env.MIGRATION_DATABASE_URL = isolated.adminUri;
  process.env.APP_LOGIN_PASSWORD = decodeURIComponent(
    new URL(isolated.appUri).password,
  );
  vi.resetModules();
  ({ withPlatformAdmin } = await import("@/db/scope"));
  ({ withPlatformMetricsWriter } = await import("@/db/scope"));
  appPool = (await import("@/db/client")).pool;
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await isolated?.stop();
});

describe("platform_metrics_daily scope narrowing", () => {
  it("withPlatformAdmin can read platform_metrics_daily", async () => {
    // Seed a row directly via the admin connection (MIGRATION url
    // bypasses app_user, so RLS doesn't apply for setup), then read
    // it through withPlatformAdmin which sets app.platform_admin.
    const admin = isolated.admin;
    await admin.query(
      `delete from platform_metrics_daily where on_date = current_date`,
    );
    await admin.query(
      `insert into platform_metrics_daily
         (on_date, active_tenants, trial_tenants, at_risk_tenants, open_ops_tasks)
       values (current_date, 0, 0, 0, 0)`,
    );
    const rows = await withPlatformAdmin(async (tx) =>
      tx.execute(
        `select on_date::text as d, active_tenants from platform_metrics_daily`,
      ),
    );
    const typed = (
      rows as unknown as { rows: Array<{ d: string; active_tenants: number }> }
    ).rows;
    expect(typed.length).toBe(1);
    expect(typed[0]!.d).toBe(new Date().toISOString().slice(0, 10));
  }, 30_000);

  it("withPlatformAdmin can NO LONGER write to platform_metrics_daily", async () => {
    const admin = isolated.admin;
    await admin.query(
      `delete from platform_metrics_daily where on_date = current_date`,
    );
    let err: unknown = null;
    try {
      await withPlatformAdmin(async (tx) => {
        await tx.execute(
          `insert into platform_metrics_daily
             (on_date, active_tenants, trial_tenants, at_risk_tenants, open_ops_tasks)
           values (current_date, 1, 0, 0, 0)`,
        );
      });
    } catch (e) {
      err = e;
    }
    expect(err, "withPlatformAdmin insert must have failed").not.toBeNull();
    // Drizzle's wrapper nests the pg error under err.cause with .code
    // (the SQLSTATE). 42501 = insufficient_privilege; the message on
    // err.cause is the underlying Postgres text. Asserting on code
    // keeps the test stable across pg-version wording changes.
    const cause = (err as { cause?: { code?: string; message?: string } })
      ?.cause;
    expect(
      cause?.code,
      `expected insufficient_privilege (42501); got code=${cause?.code} message=${cause?.message ?? ""}`,
    ).toBe(PG_INSUFFICIENT_PRIVILEGE);

    // And the row was NOT written.
    const { rows } = await admin.query<{ n: string }>(
      `select count(*)::int as n from platform_metrics_daily`,
    );
    expect(Number(rows[0]!.n)).toBe(0);
  }, 30_000);

  it("withPlatformMetricsWriter CAN write to platform_metrics_daily", async () => {
    const admin = isolated.admin;
    await admin.query(
      `delete from platform_metrics_daily where on_date = current_date`,
    );
    await withPlatformMetricsWriter(async (tx) => {
      await tx.execute(
        `insert into platform_metrics_daily
           (on_date, active_tenants, trial_tenants, at_risk_tenants, open_ops_tasks)
         values (current_date, 5, 0, 0, 0)
         on conflict (on_date) do update set active_tenants = excluded.active_tenants`,
      );
    });
    const { rows } = await admin.query<{ active_tenants: number }>(
      `select active_tenants from platform_metrics_daily where on_date = current_date`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.active_tenants).toBe(5);
  }, 30_000);

  it("withPlatformMetricsWriter CANNOT write to a tenant table", async () => {
    // Pick a tenant table — message_log is one of the few with a
    // platform_admin_write policy, so it lets us assert the negative
    // independent of any tenant-scoped row that might exist.
    const admin = isolated.admin;
    const tenantId = (
      await admin.query<{ id: string }>(
        `insert into tenants (id, slug, name, status, timezone, currency, created_at)
         values (gen_random_uuid(), $1, 'NarrowTest', 'trial', 'Asia/Kolkata', 'INR', now())
         returning id`,
        [`narrow-${Date.now()}`],
      )
    ).rows[0]!.id;

    let err: unknown = null;
    try {
      await withPlatformMetricsWriter(async (tx) => {
        await tx.execute(
          sql`insert into message_log (tenant_id, direction, provider, status, category)
              values (${tenantId}, 'outbound', 'mock', 'sent', 'utility')`,
        );
      });
    } catch (e) {
      err = e;
    }
    expect(err, "withPlatformMetricsWriter insert into message_log must have failed").not.toBeNull();
    // The error has to be a policy / privilege denial. message_log
    // has a tenant_isolation policy keyed on app.tenant_id;
    // withPlatformMetricsWriter doesn't set that variable, so the
    // insert must hit the policy's USING/WITH CHECK clauses. The
    // underlying SQLSTATE may be 42501 (insufficient_privilege) or
    // 42501 with a row-level-security message. Asserting on the
    // cause.code is the most portable form.
    const cause = (err as { cause?: { code?: string; message?: string } })
      ?.cause;
    expect(
      cause?.code,
      `expected insufficient_privilege (42501); got code=${cause?.code} message=${cause?.message ?? ""}`,
    ).toBe(PG_INSUFFICIENT_PRIVILEGE);

    // No row leaked.
    const { rows } = await admin.query<{ n: string }>(
      `select count(*)::int as n from message_log where tenant_id = $1`,
      [tenantId],
    );
    expect(Number(rows[0]!.n)).toBe(0);

    await admin.query(`delete from tenants where id = $1`, [tenantId]);
  }, 30_000);
});
