import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import type { IsolatedDb } from "./helpers/isolated-db";
import { startIsolatedDb } from "./helpers/isolated-db";

// PR3 (ops console improvements) — the two Overview read functions.
// Testcontainers only, per the standing instruction for this PR series.

let isolated: IsolatedDb;
let getPlatformMetricsSummary: typeof import("@/db/platform-overview").getPlatformMetricsSummary;
let getNeedsAttentionQueue: typeof import("@/db/platform-overview").getNeedsAttentionQueue;
let appPool: typeof import("@/db/client").pool;

beforeAll(async () => {
  isolated = await startIsolatedDb();
  process.env.DATABASE_URL = isolated.appUri;
  process.env.MIGRATION_DATABASE_URL = isolated.adminUri;
  process.env.APP_LOGIN_PASSWORD = decodeURIComponent(
    new URL(isolated.appUri).password,
  );
  vi.resetModules();
  ({ getPlatformMetricsSummary, getNeedsAttentionQueue } = await import(
    "@/db/platform-overview"
  ));
  appPool = (await import("@/db/client")).pool;
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await isolated?.stop();
});

describe("getPlatformMetricsSummary", () => {
  it("returns asOf: null when no snapshot has ever been written", async () => {
    const summary = await getPlatformMetricsSummary();
    expect(summary.asOf).toBeNull();
    expect(summary.activeTenants).toEqual({ current: 0, previous: null });
  });

  it("returns current + a >=30-day-old previous snapshot when both exist", async () => {
    const admin = isolated.admin;
    await admin.query(
      `insert into platform_metrics_daily (on_date, active_tenants, trial_tenants, at_risk_tenants, open_ops_tasks)
       values (current_date - 40, 100, 10, 2, 3)`,
    );
    await admin.query(
      `insert into platform_metrics_daily (on_date, active_tenants, trial_tenants, at_risk_tenants, open_ops_tasks)
       values (current_date, 128, 17, 6, 11)`,
    );

    const summary = await getPlatformMetricsSummary();
    expect(summary.asOf).not.toBeNull();
    expect(summary.activeTenants).toEqual({ current: 128, previous: 100 });
    expect(summary.trialTenants).toEqual({ current: 17, previous: 10 });
    expect(summary.atRiskTenants).toEqual({ current: 6, previous: 2 });
    expect(summary.openOpsTasks).toEqual({ current: 11, previous: 3 });
  });

  it("previous is null when the only history is inside the 30-day lookback window", async () => {
    const admin = isolated.admin;
    await admin.query("delete from platform_metrics_daily");
    await admin.query(
      `insert into platform_metrics_daily (on_date, active_tenants, trial_tenants, at_risk_tenants, open_ops_tasks)
       values (current_date - 10, 90, 9, 1, 1)`,
    );
    await admin.query(
      `insert into platform_metrics_daily (on_date, active_tenants, trial_tenants, at_risk_tenants, open_ops_tasks)
       values (current_date, 95, 9, 1, 1)`,
    );

    const summary = await getPlatformMetricsSummary();
    expect(summary.activeTenants).toEqual({ current: 95, previous: null });
  });
});

describe("getNeedsAttentionQueue", () => {
  it("flattens multiple issues per tenant and sorts at_risk before attention", async () => {
    const admin = isolated.admin;
    const RUN = uuidv7().slice(0, 8);
    const atRiskTenant = uuidv7();
    const attentionTenant = uuidv7();

    await admin.query(
      `insert into tenants (id, slug, name, status, timezone, currency, created_at)
       values ($1, $2, 'At Risk Co', 'active', 'Asia/Kolkata', 'INR', now()),
              ($3, $4, 'Attention Co', 'active', 'Asia/Kolkata', 'INR', now())`,
      [atRiskTenant, `queue-atrisk-${RUN}`, attentionTenant, `queue-attention-${RUN}`],
    );
    // attentionTenant gets a member (avoids the zero-members at_risk
    // signal) plus 3 failed messages (attention).
    const locationId = (
      await admin.query<{ id: string }>(
        `insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true) returning id`,
        [uuidv7(), attentionTenant],
      )
    ).rows[0]!.id;
    const personId = (
      await admin.query<{ id: string }>(
        `insert into persons (id, tenant_id, full_name, date_of_birth) values ($1, $2, 'Fixture', '2000-01-01') returning id`,
        [uuidv7(), attentionTenant],
      )
    ).rows[0]!.id;
    await admin.query(
      `insert into members (id, tenant_id, person_id, location_id, member_code, status)
       values ($1, $2, $3, $4, $5, 'active')`,
      [uuidv7(), attentionTenant, personId, locationId, `queue-${attentionTenant}`],
    );
    for (let i = 0; i < 3; i++) {
      await admin.query(
        `insert into message_log (id, tenant_id, direction, provider, status, category)
         values ($1, $2, 'outbound', 'mock', 'failed', 'utility')`,
        [uuidv7(), attentionTenant],
      );
    }
    // atRiskTenant: zero members (no fixture needed beyond the tenant row).

    const queue = await getNeedsAttentionQueue(50);
    const forRun = queue.filter((i) => i.tenantSlug.includes(RUN));
    expect(forRun).toHaveLength(2);
    // at_risk sorts before attention regardless of insertion order.
    expect(forRun[0]?.tenantId).toBe(atRiskTenant);
    expect(forRun[0]?.severity).toBe("at_risk");
    expect(forRun[0]?.text).toBe("Zero members");
    expect(forRun[1]?.tenantId).toBe(attentionTenant);
    expect(forRun[1]?.severity).toBe("attention");
    expect(forRun[1]?.text).toContain("failed messages");
  });

  it("respects the limit parameter", async () => {
    const queue = await getNeedsAttentionQueue(1);
    expect(queue.length).toBeLessThanOrEqual(1);
  });
});
