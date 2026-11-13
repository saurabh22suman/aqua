import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asMemberId, asTenantId, asUserId } from "@/lib/ids";
import { addDays, dayRangeUtc, todayInZone } from "@/lib/time/tz";

// K-06 — café reconciliation. Written before
// db/migrations/20260918104000_k06_cafe_rollups.sql and the café
// additions to lib/services/reconciliation.ts and
// lib/jobs/reports-rollup-job.ts exist: the first run is deliberately
// red. The definition under test (same in both places): a café
// payment is a captured payment settled against an invoice with
// source = 'cafe'; café_orders counts the distinct café invoices so
// settled, café_paise sums their amounts. Membership payments stay in
// the existing totals, not in the café figures.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const tenant = asTenantId(uuidv7());
const otherTenant = asTenantId(uuidv7());
const loc = uuidv7();
const actor = asUserId(uuidv7());
const ownerRole = uuidv7(), ownerMembership = uuidv7();
const otherActor = asUserId(uuidv7()), otherRole = uuidv7(), otherMembership = uuidv7();
const phone = () => `+91${String(BigInt("0x" + uuidv7().replaceAll("-", "").slice(-12)) % 4_000_000_000n + 6_000_000_000n)}`;
const personId = uuidv7();
const memberId = asMemberId(uuidv7());

const ctx = { tenantId: tenant, userId: actor, requestId: uuidv7() };
const otherCtx = { tenantId: otherTenant, userId: otherActor };

let menu: typeof import("@/lib/services/menu");
let orders: typeof import("@/lib/services/orders");
let payments: typeof import("@/lib/services/payments");
let reconciliation: typeof import("@/lib/services/reconciliation");
let rollupJob: typeof import("@/lib/jobs/reports-rollup-job");

let categoryId = "";
let itemId = "";

const paidInvoiceIds: string[] = [];
let cafeTotalPaise = 0;

async function payNewCafeOrder(method: "cash" | "upi"): Promise<string> {
  const order = await orders.createOrder(ctx, {
    locationId: loc,
    memberId,
    lines: [{ itemId, qty: 1 }],
  });
  if (!order.ok) throw new Error(order.error);
  const billed = await orders.finalizeOrder(ctx, order.orderId);
  if (!billed.ok) throw new Error(billed.error);
  const paid = await payments.recordPayment(ctx, {
    invoiceId: billed.invoiceId,
    amountPaise: order.totalPaise,
    method,
    reference: method === "upi" ? `UTR-${RUN}-${paidInvoiceIds.length}` : undefined,
  });
  if (!paid.ok) throw new Error(paid.error);
  paidInvoiceIds.push(billed.invoiceId);
  cafeTotalPaise += order.totalPaise;
  return billed.invoiceId;
}

beforeAll(async () => {
  menu = await import("@/lib/services/menu");
  orders = await import("@/lib/services/orders");
  payments = await import("@/lib/services/payments");
  reconciliation = await import("@/lib/services/reconciliation");
  rollupJob = await import("@/lib/jobs/reports-rollup-job");

  await admin.query(
    `insert into tenants (id, slug, name, status, timezone, gstin) values
       ($1, $2, 'Cafe Recon', 'active', $3, '27ABCDE1234F1Z5'),
       ($4, $5, 'Cafe Recon B', 'active', $3, null)`,
    [tenant, `k06-${RUN}`, TZ, otherTenant, `k06-b-${RUN}`],
  );
  for (const id of [tenant, otherTenant]) await admin.query("insert into tenant_features(tenant_id,feature_key,enabled) values($1,'cafe.pos',true)", [id]);
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Counter', true)",
    [loc, tenant],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    phone(),
  ]);
  await admin.query("insert into roles(id,tenant_id,key,name,home_path,home_ordinal) values($1,$2,'owner','Owner','/owner',0)",[ownerRole,tenant]);
  await admin.query("insert into role_permissions(tenant_id,role_id,permission_key) select $1,$2,p.key from (values ('members.read'),('invoices.read'),('invoices.write'),('payments.record'),('reports.financial'),('settings.manage')) p(key)",[tenant,ownerRole]);
  await admin.query("insert into tenant_memberships(id,tenant_id,user_id,role_id,status,all_locations) values($1,$2,$3,$4,'active',true)",[ownerMembership,tenant,actor,ownerRole]);
  await admin.query("insert into users(id,phone) values($1,$2)",[otherActor,phone()]);
  await admin.query("insert into roles(id,tenant_id,key,name,home_path,home_ordinal) values($1,$2,'owner','Owner','/owner',0)",[otherRole,otherTenant]);
  await admin.query("insert into role_permissions(tenant_id,role_id,permission_key) select $1,$2,p.key from (values ('members.read'),('invoices.read'),('invoices.write'),('payments.record'),('reports.financial'),('settings.manage')) p(key)",[otherTenant,otherRole]);
  await admin.query("insert into tenant_memberships(id,tenant_id,user_id,role_id,status,all_locations) values($1,$2,$3,$4,'active',true)",[otherMembership,otherTenant,otherActor,otherRole]);
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Recon Member')",
    [personId, tenant],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [memberId, tenant, personId, loc, `K06-${RUN}`],
  );

  const category = await menu.createMenuCategory(ctx, { locationId: loc, name: "Meals" });
  if (!category.ok) throw new Error(category.error);
  categoryId = category.id;
  const item = await menu.createMenuItem(ctx, {
    categoryId,
    name: "Thali",
    pricePaise: 150_000,
    taxRateBp: 500,
    sacCode: "996331",
  });
  if (!item.ok) throw new Error(item.error);
  itemId = item.id;
}, 60_000);

afterAll(async () => {
  // Privileged cleanup is restricted to these synthetic tenant IDs; audit rows remain.
  for (const id of [tenant,otherTenant]) {
    for (const table of ["daily_rollups","receipts","payment_reversals","account_entries","payments","order_lines","orders","invoice_line_items","invoices","menu_items","menu_categories","members","persons","tenant_memberships","role_permissions","roles","locations"]) {
      await admin.query(`delete from "${table}" where tenant_id=$1`,[id]);
    }
    await admin.query("delete from tenant_features where tenant_id=$1", [id]);
    await admin.query("delete from tenants where id=$1",[id]);
  }
  await admin.query("delete from users where id=any($1::uuid[]) and not exists (select 1 from audit_log where actor_id=users.id)",[[actor,otherActor]]);
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("K-06 café reconciliation", () => {
  it("counts café payments separately in the daily collection report", async () => {
    await payNewCafeOrder("cash");
    await payNewCafeOrder("upi");

    const onDate = todayInZone(TZ);
    const report = await reconciliation.getDailyCollection(ctx, {
      onDate,
      locationId: loc,
    });

    expect(report.cafeOrders).toBe(2);
    expect(report.cafePaise).toBe(cafeTotalPaise);
    expect(report.totalPaise).toBeGreaterThanOrEqual(cafeTotalPaise);

    const cash = report.byMethod.find((g) => g.key === "cash");
    expect(cash?.totalPaise).toBeGreaterThanOrEqual(157_500);
    const upi = report.byMethod.find((g) => g.key === "upi");
    expect(upi?.totalPaise).toBe(157_500);
  });

  it("reports zero café figures for another tenant", async () => {
    const onDate = todayInZone(TZ);
    const report = await reconciliation.getDailyCollection(otherCtx, { onDate });
    expect(report.cafePaise).toBe(0);
    expect(report.cafeOrders).toBe(0);
    expect(report.totalPaise).toBe(0);
  });

  it("rolls café paise and order counts into daily_rollups for the day", async () => {
    const yesterday = addDays(todayInZone(TZ), -1);
    const { fromUtc } = dayRangeUtc(yesterday, TZ);
    const receivedAt = new Date(fromUtc.getTime() + 12 * 60 * 60 * 1000);

    // Move the first café payment to yesterday so the rollup (day just
    // ended) sees exactly one café order / payment.
    await admin.query("update payments set received_at = $2 where invoice_id = $1", [
      paidInvoiceIds[0],
      receivedAt,
    ]);

    await rollupJob.runReportsRollupJob(tenant);

    const { rows } = await admin.query<{
      cafe_paise: string;
      cafe_orders: number;
      collections_paise: string;
    }>(
      "select cafe_paise, cafe_orders, collections_paise from daily_rollups where tenant_id = $1 and on_date = $2",
      [tenant, yesterday],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.cafe_paise)).toBe(157_500);
    expect(rows[0]?.cafe_orders).toBe(1);
    expect(Number(rows[0]?.collections_paise)).toBe(157_500);
  });
});
