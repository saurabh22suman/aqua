import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import type { IsolatedDb } from "./helpers/isolated-db";
import { startIsolatedDb } from "./helpers/isolated-db";

// PR3 (ops console improvements) — platform.metrics-snapshot is the
// one cross-tenant job in worker/index.ts; this proves it writes the
// right counts and is idempotent (re-running the same day upserts,
// never duplicates). Testcontainers only, per the standing
// instruction for this PR series — never the shared dev/CI database.

let isolated: IsolatedDb;
let runPlatformMetricsSnapshotJob: typeof import("@/lib/jobs/platform-metrics-snapshot-job").runPlatformMetricsSnapshotJob;
let appPool: typeof import("@/db/client").pool;

beforeAll(async () => {
  isolated = await startIsolatedDb();
  process.env.DATABASE_URL = isolated.appUri;
  process.env.MIGRATION_DATABASE_URL = isolated.adminUri;
  process.env.APP_LOGIN_PASSWORD = decodeURIComponent(
    new URL(isolated.appUri).password,
  );
  vi.resetModules();
  ({ runPlatformMetricsSnapshotJob } = await import(
    "@/lib/jobs/platform-metrics-snapshot-job"
  ));
  appPool = (await import("@/db/client")).pool;
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await isolated?.stop();
});

async function insertTenant(
  admin: IsolatedDb["admin"],
  args: { id: string; slug: string; status: string },
): Promise<void> {
  await admin.query(
    `insert into tenants (id, slug, name, status, timezone, currency, created_at)
     values ($1, $2, $3, $4, 'Asia/Kolkata', 'INR', now())`,
    [args.id, args.slug, `Tenant ${args.slug}`, args.status],
  );
}

describe("runPlatformMetricsSnapshotJob", () => {
  it("writes correct aggregate counts and is idempotent on re-run", async () => {
    const admin = isolated.admin;
    const RUN = uuidv7().slice(0, 8);

    const active1 = uuidv7();
    const active2 = uuidv7();
    const trial1 = uuidv7();
    const atRiskTenant = uuidv7();
    const churned = uuidv7();

    await insertTenant(admin, { id: active1, slug: `pmsj-active1-${RUN}`, status: "active" });
    await insertTenant(admin, { id: active2, slug: `pmsj-active2-${RUN}`, status: "active" });
    await insertTenant(admin, { id: trial1, slug: `pmsj-trial1-${RUN}`, status: "trial" });
    await insertTenant(admin, { id: atRiskTenant, slug: `pmsj-atrisk-${RUN}`, status: "active" });
    await insertTenant(admin, { id: churned, slug: `pmsj-churned-${RUN}`, status: "churned" });

    // active1/active2/trial1 each get one member — not at-risk.
    for (const tid of [active1, active2, trial1]) {
      const locationId = (
        await admin.query<{ id: string }>(
          `insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true) returning id`,
          [uuidv7(), tid],
        )
      ).rows[0]!.id;
      const personId = (
        await admin.query<{ id: string }>(
          `insert into persons (id, tenant_id, full_name, date_of_birth) values ($1, $2, 'Fixture', '2000-01-01') returning id`,
          [uuidv7(), tid],
        )
      ).rows[0]!.id;
      await admin.query(
        `insert into members (id, tenant_id, person_id, location_id, member_code, status)
         values ($1, $2, $3, $4, $5, 'active')`,
        [uuidv7(), tid, personId, locationId, `pmsj-${tid}`],
      );
    }
    // atRiskTenant gets zero members — that's the "at risk" signal.

    // Two pending config change requests, on two different tenants.
    // The key must exist in config_keys (FK) — migrations seed exactly
    // one row (attendance.absence_alert_threshold_pct); reuse it
    // rather than pulling in the full seed-platform.ts catalogue.
    await admin.query(
      `insert into config_change_requests (id, tenant_id, key, requested_value, status)
       values ($1, $2, 'attendance.absence_alert_threshold_pct', '60', 'requested'),
              ($3, $4, 'attendance.absence_alert_threshold_pct', '70', 'requested')`,
      [uuidv7(), active1, uuidv7(), trial1],
    );

    await runPlatformMetricsSnapshotJob();

    const { rows } = await admin.query<{
      active_tenants: number;
      trial_tenants: number;
      at_risk_tenants: number;
      open_ops_tasks: number;
    }>(
      "select active_tenants, trial_tenants, at_risk_tenants, open_ops_tasks from platform_metrics_daily order by on_date desc limit 1",
    );
    const row = rows[0]!;

    // These are cumulative across the whole isolated DB (only fixtures
    // in this suite), so exact equality is safe here.
    expect(row.active_tenants).toBe(3); // active1, active2, atRiskTenant
    expect(row.trial_tenants).toBe(1); // trial1
    expect(row.at_risk_tenants).toBe(1); // atRiskTenant (zero members)
    expect(row.open_ops_tasks).toBe(2);

    // Re-run: same day, must upsert (one row for today), not duplicate.
    await runPlatformMetricsSnapshotJob();
    const { rows: afterRerun } = await admin.query<{ n: string }>(
      "select count(*)::int as n from platform_metrics_daily",
    );
    expect(Number(afterRerun[0]!.n)).toBe(1);
  }, 30_000);
});
