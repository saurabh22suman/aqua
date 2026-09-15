import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asMemberId, asTenantId } from "@/lib/ids";
import { addDays, dayRangeUtc, todayInZone } from "@/lib/time/tz";

// C-47 — the nightly billing jobs. Done when: re-running a night's
// jobs changes nothing. Each job runs twice here and the second run is
// asserted to be a no-op (state equal, no new rows).

type Jobs = {
  expire: typeof import("@/lib/jobs/subscriptions-expire-job");
  generate: typeof import("@/lib/jobs/invoices-generate-job");
  rollup: typeof import("@/lib/jobs/reports-rollup-job");
};

let container: StartedPostgreSqlContainer;
let admin: Pool;
let jobs: Jobs;

const tenantA = asTenantId(uuidv7());
const locA = uuidv7();
const memberLapsed = asMemberId(uuidv7());
const memberAuto = asMemberId(uuidv7());
const memberManual = asMemberId(uuidv7());
const planA = uuidv7();
const subLapsed = uuidv7();
const subAuto = uuidv7();
const subManual = uuidv7();
const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";
let todayIso = "";

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const adminUri = container.getConnectionUri();
  const appPassword = "isolated-test-pw";

  process.env.DATABASE_URL = `postgresql://app_login:${encodeURIComponent(appPassword)}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = appPassword;

  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(adminUri, appPassword);
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(adminUri);

  jobs = {
    expire: await import("@/lib/jobs/subscriptions-expire-job"),
    generate: await import("@/lib/jobs/invoices-generate-job"),
    rollup: await import("@/lib/jobs/reports-rollup-job"),
  };

  admin = new Pool({ connectionString: adminUri });
  const today = todayInZone(TZ);
  todayIso = today;

  await admin.query(
    `insert into tenants (id, slug, name, status, timezone, gstin) values ($1, $2, 'Jobs Club', 'active', $3, '27ABCDE1234F1Z5')`,
    [tenantA, `jobs-${RUN}`, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Worli', true)",
    [locA, tenantA],
  );
  await admin.query(
    `insert into persons (id, tenant_id, full_name) values
       ($1, $4, 'Lapsed Member'), ($2, $4, 'Auto Member'), ($3, $4, 'Manual Member')`,
    [uuidv7(), uuidv7(), uuidv7(), tenantA],
  );
  await admin.query(
    "insert into membership_plans (id, tenant_id, location_id, name, kind, duration_days, amount_paise) values ($1, $2, $3, 'Monthly', 'duration', 30, 250000)",
    [planA, tenantA, locA],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, member_code, status)
     select $1, $2, id, $3, 'JB-1', 'active' from persons where tenant_id = $2 and full_name = 'Lapsed Member'`,
    [memberLapsed, tenantA, locA],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, member_code, status)
     select $1, $2, id, $3, 'JB-2', 'active' from persons where tenant_id = $2 and full_name = 'Auto Member'`,
    [memberAuto, tenantA, locA],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, member_code, status)
     select $1, $2, id, $3, 'JB-3', 'active' from persons where tenant_id = $2 and full_name = 'Manual Member'`,
    [memberManual, tenantA, locA],
  );
  await admin.query(
    `insert into subscriptions (id, tenant_id, member_id, plan_id, location_id, starts_on, ends_on, status, auto_renew) values
       ($1, $4, $5, $8, $9, $10, $11, 'active', false),
       ($2, $4, $6, $8, $9, $10, $12, 'active', true),
       ($3, $4, $7, $8, $9, $10, $12, 'active', false)`,
    [
      subLapsed, subAuto, subManual,
      tenantA, memberLapsed, memberAuto, memberManual,
      planA, locA,
      addDays(today, -20),
      addDays(today, -1), // lapsed yesterday
      addDays(today, 3), // inside the renewal window
    ],
  );
}, 240_000);

afterAll(async () => {
  await admin?.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("subscriptions.expire", () => {
  it("expires lapsed active subscriptions and is idempotent", async () => {
    await jobs.expire.runSubscriptionsExpireJob(tenantA);

    const expired = await admin.query<{ status: string; updated_at: Date }>(
      "select status, updated_at from subscriptions where id = $1",
      [subLapsed],
    );
    expect(expired.rows[0]?.status).toBe("expired");
    const firstRunUpdatedAt = expired.rows[0]?.updated_at.toISOString();

    const stillActive = await admin.query<{ count: string }>(
      "select count(*)::text as count from subscriptions where tenant_id = $1 and status = 'active'",
      [tenantA],
    );
    expect(stillActive.rows[0]?.count).toBe("2");

    await jobs.expire.runSubscriptionsExpireJob(tenantA);
    const second = await admin.query<{ updated_at: Date }>(
      "select updated_at from subscriptions where id = $1",
      [subLapsed],
    );
    expect(second.rows[0]?.updated_at.toISOString()).toBe(firstRunUpdatedAt);
  });
});

describe("invoices.generate", () => {
  it("raises one renewal invoice for the auto-renew subscription only", async () => {
    await jobs.generate.runInvoicesGenerateJob(tenantA);

    const { rows } = await admin.query<{
      invoice_number: string;
      due_on: string;
      status: string;
      subscription_id: string;
      created_by: string | null;
      total_paise: string;
    }>("select invoice_number, due_on::text as due_on, status, subscription_id, created_by, total_paise from invoices where tenant_id = $1", [
      tenantA,
    ]);
    expect(rows).toHaveLength(1);
    const invoice = rows[0]!;
    expect(invoice.subscription_id).toBe(subAuto);
    expect(invoice.status).toBe("issued");
    expect(invoice.created_by).toBeNull();
    expect(invoice.due_on).toBe(addDays(todayIso, 4));
    expect(invoice.total_paise).toBe("295000");
    expect(invoice.invoice_number).toBe("INV/2026-27/0001");

    const line = await admin.query<{ description: string; tax_rate_bp: number }>(
      "select description, tax_rate_bp from invoice_line_items where tenant_id = $1",
      [tenantA],
    );
    expect(line.rows[0]?.description).toBe("Monthly");
    expect(line.rows[0]?.tax_rate_bp).toBe(1800);
  });

  it("is a no-op on a second run", async () => {
    const before = await admin.query<{ count: string }>(
      "select count(*)::text as count from invoices where tenant_id = $1",
      [tenantA],
    );
    await jobs.generate.runInvoicesGenerateJob(tenantA);
    const after = await admin.query<{ count: string }>(
      "select count(*)::text as count from invoices where tenant_id = $1",
      [tenantA],
    );
    expect(before.rows[0]?.count).toBe("1");
    expect(after.rows[0]?.count).toBe("1");
  });
});

describe("reports.rollup", () => {
  it("upserts yesterday's summary and recomputes the same numbers", async () => {
    const yesterday = addDays(todayIso, -1);
    const { fromUtc } = dayRangeUtc(yesterday, TZ);
    const receivedAt = new Date(fromUtc.getTime() + 12 * 60 * 60 * 1000);

    // A payment and a member that landed yesterday, so the rollup has
    // something real to count.
    await admin.query(
      `insert into payments (tenant_id, member_id, location_id, amount_paise, method, received_at, status)
       values ($1, $2, $3, 50000, 'cash', $4, 'captured')`,
      [tenantA, memberAuto, locA, receivedAt],
    );
    await admin.query(
      `insert into members (id, tenant_id, person_id, location_id, member_code, status, created_at)
       select $1, $2, id, $3, 'JB-4', 'active', $4 from persons where tenant_id = $2 and full_name = 'Auto Member'`,
      [asMemberId(uuidv7()), tenantA, locA, receivedAt],
    );

    await jobs.rollup.runReportsRollupJob(tenantA);

    const first = await admin.query<{
      payments_count: number;
      collections_paise: string;
      new_members: number;
    }>(
      "select payments_count, collections_paise, new_members from daily_rollups where tenant_id = $1 and on_date = $2",
      [tenantA, yesterday],
    );
    expect(first.rows[0]?.payments_count).toBe(1);
    expect(first.rows[0]?.collections_paise).toBe("50000");
    expect(first.rows[0]?.new_members).toBe(1);

    await jobs.rollup.runReportsRollupJob(tenantA);

    const second = await admin.query<{ count: string }>(
      "select count(*)::text as count from daily_rollups where tenant_id = $1",
      [tenantA],
    );
    expect(second.rows[0]?.count).toBe("1");
    const again = await admin.query<{
      payments_count: number;
      collections_paise: string;
    }>(
      "select payments_count, collections_paise from daily_rollups where tenant_id = $1 and on_date = $2",
      [tenantA, yesterday],
    );
    expect(again.rows[0]?.payments_count).toBe(1);
    expect(again.rows[0]?.collections_paise).toBe("50000");
  });
});
