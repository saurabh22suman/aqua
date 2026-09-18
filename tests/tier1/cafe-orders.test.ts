import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asMemberId, asTenantId, asUserId, type TenantId } from "@/lib/ids";

// K-02/K-03 — counter order capture and the café → invoice bridge.
// Written before the k02/k03 migrations and lib/services/orders.ts
// exist: the first run is deliberately red. The snapshot assertions
// are the point of the file — an issued café invoice must show the
// price/tax/SAC that were true when the order was placed, not the
// menu's current values.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const tenant = asTenantId(uuidv7());
const otherTenant = asTenantId(uuidv7());
const loc = uuidv7();
const otherLoc = uuidv7();
const actor = asUserId(uuidv7());
const personId = uuidv7();
const memberId = asMemberId(uuidv7());

const ctx = { tenantId: tenant, userId: actor, requestId: uuidv7() };
const otherCtx = { tenantId: otherTenant, userId: actor };

let menu: typeof import("@/lib/services/menu");
let orders: typeof import("@/lib/services/orders");
let payments: typeof import("@/lib/services/payments");

let categoryId = "";
let itemId = "";
const ITEM_PRICE = 100_000; // ₹1,000
const ITEM_RATE_BP = 500; // 5%
const ITEM_SAC = "996331";

async function auditCount(tenantId: TenantId, action: string): Promise<number> {
  const { rows } = await admin.query<{ count: string }>(
    "select count(*)::text as count from audit_log where tenant_id = $1 and action = $2",
    [tenantId, action],
  );
  return Number(rows[0]?.count ?? "0");
}

async function orderRow(orderId: string) {
  const { rows } = await admin.query<{
    status: string;
    invoice_id: string | null;
    void_reason: string | null;
  }>("select status, invoice_id, void_reason from orders where id = $1", [orderId]);
  return rows[0];
}

beforeAll(async () => {
  menu = await import("@/lib/services/menu");
  orders = await import("@/lib/services/orders");
  payments = await import("@/lib/services/payments");

  await admin.query(
    `insert into tenants (id, slug, name, status, timezone, gstin) values
       ($1, $2, 'Cafe Orders', 'active', 'Asia/Kolkata', '27ABCDE1234F1Z5'),
       ($3, $4, 'Cafe Orders B', 'active', 'Asia/Kolkata', null)`,
    [tenant, `k02-${RUN}`, otherTenant, `k02-b-${RUN}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $3, 'Counter', true), ($2, $4, 'Other Counter', true)`,
    [loc, otherLoc, tenant, otherTenant],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9191${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Cafe Member')",
    [personId, tenant],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [memberId, tenant, personId, loc, `CAFE-${RUN}`],
  );

  const category = await menu.createMenuCategory(ctx, {
    locationId: loc,
    name: "Snacks",
    sortOrder: 1,
  });
  expect(category.ok).toBe(true);
  if (category.ok) categoryId = category.id;

  const item = await menu.createMenuItem(ctx, {
    categoryId,
    name: "Veg Sandwich",
    pricePaise: ITEM_PRICE,
    taxRateBp: ITEM_RATE_BP,
    sacCode: ITEM_SAC,
  });
  expect(item.ok).toBe(true);
  if (item.ok) itemId = item.id;
}, 60_000);

afterAll(async () => {
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("K-02 order capture", () => {
  it("snapshots the item name, price, tax and SAC per line", async () => {
    const result = await orders.createOrder(ctx, {
      locationId: loc,
      memberId,
      lines: [{ itemId, qty: 2 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalPaise).toBe(210_000); // 2 × 100000 + 5% = 210000

    const { rows } = await admin.query<{
      item_name: string;
      qty: number;
      unit_price_paise: string;
      tax_rate_bp: number;
      sac_code: string;
      line_paise: string;
      tax_paise: string;
    }>("select * from order_lines where order_id = $1", [result.orderId]);
    expect(rows).toHaveLength(1);
    const line = rows[0]!;
    expect(line.item_name).toBe("Veg Sandwich");
    expect(line.qty).toBe(2);
    expect(Number(line.unit_price_paise)).toBe(ITEM_PRICE);
    expect(line.tax_rate_bp).toBe(ITEM_RATE_BP);
    expect(line.sac_code).toBe(ITEM_SAC);
    expect(Number(line.line_paise)).toBe(200_000);
    expect(Number(line.tax_paise)).toBe(10_000);

    expect(await auditCount(tenant, "order.create")).toBe(1);
  });

  it("refuses an inactive or unknown item", async () => {
    const unknown = await orders.createOrder(ctx, {
      locationId: loc,
      lines: [{ itemId: uuidv7(), qty: 1 }],
    });
    expect(unknown.ok).toBe(false);

    const otherTenantItem = await orders.createOrder(otherCtx, {
      locationId: otherLoc,
      lines: [{ itemId, qty: 1 }],
    });
    expect(otherTenantItem.ok).toBe(false);

    const noLines = await orders.createOrder(ctx, { locationId: loc, lines: [] });
    expect(noLines.ok).toBe(false);

    const badQty = await orders.createOrder(ctx, {
      locationId: loc,
      lines: [{ itemId, qty: 0 }],
    });
    expect(badQty.ok).toBe(false);
  });

  it("records a walk-in order without a member", async () => {
    const result = await orders.createOrder(ctx, {
      locationId: loc,
      lines: [{ itemId, qty: 1 }],
    });
    expect(result.ok).toBe(true);
  });

  it("a walk-in order cannot be billed (the invoice spine needs a member)", async () => {
    const created = await orders.createOrder(ctx, {
      locationId: loc,
      lines: [{ itemId, qty: 1 }],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const billed = await orders.finalizeOrder(ctx, created.orderId);
    expect(billed.ok).toBe(false);
    if (!billed.ok) expect(billed.error).toMatch(/member/i);
  });
});

describe("K-03 café ↔ invoice bridge", () => {
  let orderId = "";

  it("finalizes into exactly one café invoice and links it", async () => {
    const created = await orders.createOrder(ctx, {
      locationId: loc,
      memberId,
      lines: [{ itemId, qty: 2 }],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    orderId = created.orderId;

    // The menu price changes after the order is placed.
    const priceChange = await menu.updateMenuItem(ctx, {
      itemId,
      pricePaise: 999_00,
      taxRateBp: 1800,
    });
    expect(priceChange.ok).toBe(true);

    const billed = await orders.finalizeOrder(ctx, orderId);
    expect(billed.ok).toBe(true);
    if (!billed.ok) return;
    expect(billed.invoiceNumber).toMatch(/^INV\//);

    const row = await orderRow(orderId);
    expect(row?.status).toBe("billed");
    expect(row?.invoice_id).toBe(billed.invoiceId);

    const { rows } = await admin.query<{
      source: string;
      subtotal_paise: string;
      tax_paise: string;
      total_paise: string;
      status: string;
    }>("select source, subtotal_paise, tax_paise, total_paise, status from invoices where id = $1", [
      billed.invoiceId,
    ]);
    expect(rows[0]?.source).toBe("cafe");
    expect(Number(rows[0]?.subtotal_paise)).toBe(200_000);
    expect(Number(rows[0]?.tax_paise)).toBe(10_000);
    expect(Number(rows[0]?.total_paise)).toBe(210_000);
    expect(rows[0]?.status).toBe("issued");

    const { rows: lineRows } = await admin.query<{
      amount_paise: string;
      tax_rate_bp: number;
      sac_code: string;
      description: string;
    }>("select amount_paise, tax_rate_bp, sac_code, description from invoice_line_items where invoice_id = $1", [
      billed.invoiceId,
    ]);
    expect(lineRows).toHaveLength(1);
    expect(Number(lineRows[0]?.amount_paise)).toBe(200_000);
    // The snapshot, not the changed menu price/rate.
    expect(lineRows[0]?.tax_rate_bp).toBe(ITEM_RATE_BP);
    expect(lineRows[0]?.sac_code).toBe(ITEM_SAC);
    expect(lineRows[0]?.description).toContain("Veg Sandwich");

    const { rows: countRows } = await admin.query<{ count: string }>(
      "select count(*)::text as count from invoices where tenant_id = $1 and source = 'cafe'",
      [tenant],
    );
    expect(countRows[0]?.count).toBe("1");

    expect(await auditCount(tenant, "order.bill")).toBe(1);
  });

  it("refuses to finalize an order twice", async () => {
    const again = await orders.finalizeOrder(ctx, orderId);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/billed|already/i);
  });

  it("refuses to void a billed order with a captured payment", async () => {
    const row = await orderRow(orderId);
    expect(row?.invoice_id).toBeTruthy();
    const paid = await payments.recordPayment(ctx, {
      invoiceId: row!.invoice_id!,
      amountPaise: 210_000,
      method: "cash",
    });
    expect(paid.ok).toBe(true);

    const voided = await orders.voidOrder(ctx, orderId, "Customer complained");
    expect(voided.ok).toBe(false);
    if (!voided.ok) expect(voided.error).toMatch(/payment/i);

    const after = await orderRow(orderId);
    expect(after?.status).toBe("billed");
    expect(await auditCount(tenant, "order.void")).toBe(0);
  });

  it("voids an unpaid order, keeps its lines, and audits the reason", async () => {
    const created = await orders.createOrder(ctx, {
      locationId: loc,
      memberId: null,
      lines: [{ itemId, qty: 3 }],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const voided = await orders.voidOrder(ctx, created.orderId, "Wrong item rung up");
    expect(voided.ok).toBe(true);

    const row = await orderRow(created.orderId);
    expect(row?.status).toBe("voided");
    expect(row?.void_reason).toBe("Wrong item rung up");

    const { rows } = await admin.query<{ count: string }>(
      "select count(*)::text as count from order_lines where order_id = $1",
      [created.orderId],
    );
    expect(rows[0]?.count).toBe("1");

    expect(await auditCount(tenant, "order.void")).toBe(1);

    const again = await orders.voidOrder(ctx, created.orderId, "Trying again");
    expect(again.ok).toBe(false);
  });
});
