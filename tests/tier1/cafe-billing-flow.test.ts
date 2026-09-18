import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asMemberId, asTenantId, asUserId } from "@/lib/ids";

// K-08 — reception café billing flow. Written before
// lib/services/cafe-billing.ts and the request-bill surface exist:
// the first run is deliberately red.
//
// The flow under test is the owner's direction: pick an open order →
// request the bill (finalizeOrder if not billed) → the itemized bill
// with the amount due → collect the payment. The maths assertions are
// the point of the file: lines + tax = subtotal + tax = total =
// amount due, all in integer paise, and every total matches the
// order snapshot and the issued invoice to the paisa.
//
// Walk-ins stay unbillable: an order without a member refuses with
// the server's reason, and no anonymous path is invented.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const tenant = asTenantId(uuidv7());
const loc = uuidv7();
const loc2 = uuidv7();
const actor = asUserId(uuidv7());
const personId = uuidv7();
const memberId = asMemberId(uuidv7());

const ctx = { tenantId: tenant, userId: actor, requestId: uuidv7() };

let menu: typeof import("@/lib/services/menu");
let orders: typeof import("@/lib/services/orders");
let payments: typeof import("@/lib/services/payments");
let billing: typeof import("@/lib/services/cafe-billing");

let categoryId = "";
let itemId = "";
const ITEM_PRICE = 100_000; // ₹1,000
const ITEM_RATE_BP = 500; // 5%
const ITEM_SAC = "996331";

async function invoiceCount(): Promise<number> {
  const { rows } = await admin.query<{ count: string }>(
    "select count(*)::text as count from invoices where tenant_id = $1 and source = 'cafe'",
    [tenant],
  );
  return Number(rows[0]?.count ?? "0");
}

beforeAll(async () => {
  menu = await import("@/lib/services/menu");
  orders = await import("@/lib/services/orders");
  payments = await import("@/lib/services/payments");
  billing = await import("@/lib/services/cafe-billing");

  await admin.query(
    "insert into tenants (id, slug, name, status, timezone, gstin) values ($1, $2, 'Cafe Billing', 'active', 'Asia/Kolkata', '27ABCDE1234F1Z5')",
    [tenant, `k08-${RUN}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $3, 'Counter', true), ($2, $3, 'Kiosk', false)`,
    [loc, loc2, tenant],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9194${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Café Member')",
    [personId, tenant],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [memberId, tenant, personId, loc, `K08-${RUN}`],
  );

  const category = await menu.createMenuCategory(ctx, {
    locationId: loc,
    name: "Snacks",
    sortOrder: 1,
  });
  if (!category.ok) throw new Error(category.error);
  categoryId = category.id;
  const item = await menu.createMenuItem(ctx, {
    categoryId,
    name: "Veg Sandwich",
    pricePaise: ITEM_PRICE,
    taxRateBp: ITEM_RATE_BP,
    sacCode: ITEM_SAC,
  });
  if (!item.ok) throw new Error(item.error);
  itemId = item.id;
}, 60_000);

afterAll(async () => {
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("K-08 café billing flow", () => {
  let memberOrderId = "";

  it("lists a placed order, requests the bill, and returns itemized paise maths", async () => {
    const created = await orders.createOrder(ctx, {
      locationId: loc,
      memberId,
      lines: [{ itemId, qty: 2 }],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    memberOrderId = created.orderId;

    const open = await billing.listOpenCafeOrders(ctx, {});
    const row = open.find((order) => order.orderId === memberOrderId);
    expect(row).toBeDefined();
    expect(row!.status).toBe("placed");
    expect(row!.memberName).toBe("Café Member");
    expect(row!.billable).toBe(true);
    expect(row!.invoiceId).toBeNull();
    expect(row!.totalPaise).toBe(210_000);
    expect(row!.amountDuePaise).toBe(210_000);

    const requested = await billing.requestCafeBill(ctx, memberOrderId);
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    expect(requested.alreadyBilled).toBe(false);
    expect(requested.bill.invoiceNumber).toMatch(/^INV\//);
    expect(requested.bill.memberName).toBe("Café Member");
    expect(requested.bill.lines).toHaveLength(1);

    const line = requested.bill.lines[0]!;
    expect(line.itemName).toBe("Veg Sandwich");
    expect(line.qty).toBe(2);
    expect(line.unitPricePaise).toBe(ITEM_PRICE);
    expect(line.linePaise).toBe(200_000);
    expect(line.taxRateBp).toBe(ITEM_RATE_BP);
    expect(line.taxPaise).toBe(10_000);

    // lines + tax = subtotal + tax = total = amount due (integer paise).
    const lineSum = requested.bill.lines.reduce(
      (sum, l) => sum + l.linePaise,
      0,
    );
    const taxSum = requested.bill.lines.reduce((sum, l) => sum + l.taxPaise, 0);
    expect(lineSum).toBe(requested.bill.subtotalPaise);
    expect(taxSum).toBe(requested.bill.taxPaise);
    expect(requested.bill.subtotalPaise + requested.bill.taxPaise).toBe(
      requested.bill.totalPaise,
    );
    expect(requested.bill.amountDuePaise).toBe(requested.bill.totalPaise);
    expect(requested.bill.totalPaise).toBe(210_000);

    // The invoice the bill points at carries the same figures.
    const { rows } = await admin.query<{
      subtotal_paise: string;
      tax_paise: string;
      total_paise: string;
      source: string;
    }>(
      "select subtotal_paise::text, tax_paise::text, total_paise::text, source from invoices where id = $1",
      [requested.bill.invoiceId],
    );
    expect(rows[0]!.source).toBe("cafe");
    expect(Number(rows[0]!.subtotal_paise)).toBe(requested.bill.subtotalPaise);
    expect(Number(rows[0]!.tax_paise)).toBe(requested.bill.taxPaise);
    expect(Number(rows[0]!.total_paise)).toBe(requested.bill.totalPaise);

    // The listed row now reflects the raised bill.
    const afterBill = await billing.listOpenCafeOrders(ctx, {});
    const billedRow = afterBill.find((order) => order.orderId === memberOrderId);
    expect(billedRow).toBeDefined();
    expect(billedRow!.status).toBe("billed");
    expect(billedRow!.invoiceNumber).toBe(requested.bill.invoiceNumber);
    expect(billedRow!.amountDuePaise).toBe(210_000);
  });

  it("requesting the bill twice returns the same invoice, not a second one", async () => {
    const first = await billing.requestCafeBill(ctx, memberOrderId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await billing.requestCafeBill(ctx, memberOrderId);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.alreadyBilled).toBe(true);
    expect(second.bill.invoiceId).toBe(first.bill.invoiceId);
    expect(second.bill.invoiceNumber).toBe(first.bill.invoiceNumber);
    expect(await invoiceCount()).toBe(1);
  });

  it("a walk-in order is listed but refuses to bill with the server's reason", async () => {
    const walkIn = await orders.createOrder(ctx, {
      locationId: loc,
      lines: [{ itemId, qty: 1 }],
    });
    expect(walkIn.ok).toBe(true);
    if (!walkIn.ok) return;

    const open = await billing.listOpenCafeOrders(ctx, {});
    const row = open.find((order) => order.orderId === walkIn.orderId);
    expect(row).toBeDefined();
    expect(row!.billable).toBe(false);
    expect(row!.memberName).toBeNull();
    expect(row!.amountDuePaise).toBe(105_000);

    const refused = await billing.requestCafeBill(ctx, walkIn.orderId);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/member/i);

    const { rows } = await admin.query<{ invoice_id: string | null }>(
      "select invoice_id from orders where id = $1",
      [walkIn.orderId],
    );
    expect(rows[0]!.invoice_id).toBeNull();
    expect(await invoiceCount()).toBe(1);
  });

  it("a captured payment settles the bill and removes it from the open list", async () => {
    const open = await billing.listOpenCafeOrders(ctx, {});
    const row = open.find((order) => order.orderId === memberOrderId);
    expect(row).toBeDefined();
    if (!row || !row.invoiceId) return;

    const paid = await payments.recordPayment(ctx, {
      invoiceId: row.invoiceId,
      amountPaise: row.amountDuePaise,
      method: "cash",
    });
    expect(paid.ok).toBe(true);

    const after = await billing.listOpenCafeOrders(ctx, {});
    expect(after.find((order) => order.orderId === memberOrderId)).toBeUndefined();
  });

  it("scopes the open list by location", async () => {
    const kioskCategory = await menu.createMenuCategory(ctx, {
      locationId: loc2,
      name: "Kiosk",
      sortOrder: 1,
    });
    if (!kioskCategory.ok) throw new Error(kioskCategory.error);
    const kioskItem = await menu.createMenuItem(ctx, {
      categoryId: kioskCategory.id,
      name: "Kiosk Water",
      pricePaise: 20_000,
      taxRateBp: 0,
      sacCode: ITEM_SAC,
    });
    if (!kioskItem.ok) throw new Error(kioskItem.error);

    const kioskOrder = await orders.createOrder(ctx, {
      locationId: loc2,
      memberId,
      lines: [{ itemId: kioskItem.id, qty: 1 }],
    });
    expect(kioskOrder.ok).toBe(true);
    if (!kioskOrder.ok) return;

    const kiosk = await billing.listOpenCafeOrders(ctx, { locationId: loc2 });
    expect(kiosk).toHaveLength(1);
    expect(kiosk[0]!.orderId).toBe(kioskOrder.orderId);
    expect(kiosk[0]!.locationId).toBe(loc2);

    const counter = await billing.listOpenCafeOrders(ctx, { locationId: loc });
    expect(
      counter.some((order) => order.orderId === kioskOrder.orderId),
    ).toBe(false);
  });

  it("excludes voided orders from the open list", async () => {
    const created = await orders.createOrder(ctx, {
      locationId: loc,
      memberId,
      lines: [{ itemId, qty: 1 }],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const before = await billing.listOpenCafeOrders(ctx, {});
    expect(before.some((order) => order.orderId === created.orderId)).toBe(true);

    const voided = await orders.voidOrder(ctx, created.orderId, "Rung up twice");
    expect(voided.ok).toBe(true);

    const after = await billing.listOpenCafeOrders(ctx, {});
    expect(after.some((order) => order.orderId === created.orderId)).toBe(false);
  });
});
