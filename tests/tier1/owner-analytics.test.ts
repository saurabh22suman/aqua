import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asTenantId } from "@/lib/ids";
import { getMoneyAnalytics } from "@/lib/services/owner-analytics";

// U-01 / PR1-C1 — money analytics used to throw Postgres 42803
// ("column payments.received_at must appear in the GROUP BY clause")
// because the tenant timezone was bound as a separate parameter in
// the SELECT and GROUP BY expressions. This suite pins the fixed
// behaviour: tenant-local day grouping, exclusive period end, plan
// attribution, and cross-tenant isolation.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const tenantId = asTenantId(uuidv7());
const otherTenantId = asTenantId(uuidv7());
const locationId = uuidv7();
const otherLocationId = uuidv7();
const memberId = uuidv7();
const otherMemberId = uuidv7();
const planId = uuidv7();
const subscriptionId = uuidv7();
const invoiceId = uuidv7();
const otherInvoiceId = uuidv7();

const ctx = { tenantId };

beforeAll(async () => {
  await admin.query(
    `insert into tenants (id, slug, name, timezone) values
       ($1, $2, 'Analytics Test', $3),
       ($4, $5, 'Analytics Other', $3)`,
    [tenantId, `analytics-${RUN}`, TZ, otherTenantId, `analytics-other-${RUN}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $2, 'Main', true),
       ($3, $4, 'Other', true)`,
    [locationId, tenantId, otherLocationId, otherTenantId],
  );
  await admin.query(
    `insert into persons (id, tenant_id, full_name) values
       ($1, $3, 'Analytics Member'),
       ($2, $4, 'Other Member')`,
    [uuidv7(), uuidv7(), tenantId, otherTenantId],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, member_code, status)
     select $1, $2, p.id, $3, $4, 'active'
       from persons p
      where p.tenant_id = $2 and p.full_name = 'Analytics Member'`,
    [memberId, tenantId, locationId, `ANA-${RUN}`],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, member_code, status)
     select $1, $2, p.id, $3, $4, 'active'
       from persons p
      where p.tenant_id = $2 and p.full_name = 'Other Member'`,
    [otherMemberId, otherTenantId, otherLocationId, `ANA-O-${RUN}`],
  );
  await admin.query(
    `insert into membership_plans (id, tenant_id, location_id, name, kind, duration_days, amount_paise)
     values ($1, $2, $3, 'Monthly Analytics', 'duration', 30, 250000)`,
    [planId, tenantId, locationId],
  );
  await admin.query(
    `insert into subscriptions (id, tenant_id, member_id, plan_id, location_id, starts_on, ends_on, status)
     values ($1, $2, $3, $4, $5, '2026-09-01', '2026-09-30', 'active')`,
    [subscriptionId, tenantId, memberId, planId, locationId],
  );
  await admin.query(
    `insert into invoices (id, tenant_id, location_id, member_id, subscription_id, invoice_number, financial_year, issued_on, due_on, subtotal_paise, tax_paise, total_paise, status)
     values
       ($1, $2, $3, $4, $5, $6, '2026-27', '2026-09-01', '2026-09-10', 250000, 0, 250000, 'issued'),
       ($7, $8, $9, $10, null, $11, '2026-27', '2026-09-01', '2026-09-10', 90000, 0, 90000, 'issued')`,
    [
      invoiceId,
      tenantId,
      locationId,
      memberId,
      subscriptionId,
      `ANA-${RUN}-1`,
      otherInvoiceId,
      otherTenantId,
      otherLocationId,
      otherMemberId,
      `ANA-O-${RUN}-1`,
    ],
  );
  await admin.query(
    `insert into payments (id, tenant_id, invoice_id, member_id, location_id, amount_paise, method, received_at, status)
     values
       ($1, $2, $3, $4, $5, 100000, 'cash', '2026-09-30T17:00:00Z', 'captured'),
       ($6, $2, $3, $4, $5, 50000, 'cash', '2026-09-30T19:00:00Z', 'captured'),
       ($7, $2, $3, $4, $5, 70000, 'cash', '2026-09-30T17:30:00Z', 'refunded'),
       ($8, $9, $10, $11, $12, 90000, 'cash', '2026-09-30T17:00:00Z', 'captured')`,
    [
      uuidv7(),
      tenantId,
      invoiceId,
      memberId,
      locationId,
      uuidv7(),
      uuidv7(),
      uuidv7(),
      otherTenantId,
      otherInvoiceId,
      otherMemberId,
      otherLocationId,
    ],
  );
});

afterAll(async () => {
  for (const tenant of [tenantId, otherTenantId]) {
    await admin.query("delete from payments where tenant_id = $1", [tenant]);
    await admin.query("delete from invoices where tenant_id = $1", [tenant]);
    await admin.query("delete from subscriptions where tenant_id = $1", [tenant]);
    await admin.query("delete from membership_plans where tenant_id = $1", [tenant]);
    await admin.query("delete from member_status_transitions where tenant_id = $1", [tenant]);
    await admin.query("delete from members where tenant_id = $1", [tenant]);
    await admin.query("delete from persons where tenant_id = $1", [tenant]);
    await admin.query("delete from locations where tenant_id = $1", [tenant]);
  }
  await admin.query("delete from tenants where id = any($1::uuid[])", [
    [tenantId, otherTenantId],
  ]);
  await admin.end();
});

describe("getMoneyAnalytics (PR1-C1)", () => {
  it("groups captured payments by tenant-local day and attributes them to the plan", async () => {
    const result = await getMoneyAnalytics(ctx, {
      from: "2026-09-01",
      to: "2026-10-02",
    });

    // 17:00Z = 22:30 IST on 30 Sep; 19:00Z = 00:30 IST on 1 Oct.
    // The refunded payment and the other tenant's payment are out.
    expect(result.collections.totalPaise).toBe(150000);
    expect(result.collections.byDay).toEqual([
      { date: "2026-09-30", paise: 100000 },
      { date: "2026-10-01", paise: 50000 },
    ]);
    expect(result.collections.expensesPaise).toBeNull();
    expect(result.planRevenue).toEqual([
      { planName: "Monthly Analytics", paise: 150000, paymentCount: 2 },
    ]);
  });

  it("treats the period end as exclusive in the tenant's timezone", async () => {
    const result = await getMoneyAnalytics(ctx, {
      from: "2026-09-01",
      to: "2026-10-01",
    });

    // 00:30 IST on 1 Oct is outside the September window even
    // though it is still 30 Sep UTC.
    expect(result.collections.totalPaise).toBe(100000);
    expect(result.collections.byDay).toEqual([
      { date: "2026-09-30", paise: 100000 },
    ]);
  });
});
