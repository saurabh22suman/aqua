import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asMemberId, asTenantId, asUserId } from "@/lib/ids";

// K-04 — café payments. Written before
// db/migrations/20260918103000_k04_payment_methods.sql and the café
// rule in lib/services/payments.ts exist: the first run is
// deliberately red. Two safety rules are guarded here, each with a
// named mutation proof in the task:
//   1. a partial payment against a café invoice is refused;
//   2. card/other require a reference (no card data, just the
//      terminal's reference).

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const tenant = asTenantId(uuidv7());
const loc = uuidv7();
const actor = asUserId(uuidv7());
const personId = uuidv7();
const memberId = asMemberId(uuidv7());

const ctx = { tenantId: tenant, userId: actor, requestId: uuidv7() };

let menu: typeof import("@/lib/services/menu");
let orders: typeof import("@/lib/services/orders");
let payments: typeof import("@/lib/services/payments");

let categoryId = "";
let itemId = "";

async function newCafeInvoice(): Promise<{ invoiceId: string; totalPaise: number }> {
  const order = await orders.createOrder(ctx, {
    locationId: loc,
    memberId,
    lines: [{ itemId, qty: 1 }],
  });
  if (!order.ok) throw new Error(order.error);
  const billed = await orders.finalizeOrder(ctx, order.orderId);
  if (!billed.ok) throw new Error(billed.error);
  return { invoiceId: billed.invoiceId, totalPaise: order.totalPaise };
}

async function paymentCount(invoiceId: string): Promise<number> {
  const { rows } = await admin.query<{ count: string }>(
    "select count(*)::text as count from payments where invoice_id = $1",
    [invoiceId],
  );
  return Number(rows[0]?.count ?? "0");
}

async function invoicePaid(invoiceId: string): Promise<number> {
  const { rows } = await admin.query<{ paid_paise: string }>(
    "select paid_paise from invoices where id = $1",
    [invoiceId],
  );
  return Number(rows[0]?.paid_paise ?? "0");
}

beforeAll(async () => {
  menu = await import("@/lib/services/menu");
  orders = await import("@/lib/services/orders");
  payments = await import("@/lib/services/payments");

  await admin.query(
    "insert into tenants (id, slug, name, status, timezone, gstin) values ($1, $2, 'Cafe Pay', 'active', 'Asia/Kolkata', '27ABCDE1234F1Z5')",
    [tenant, `k04-${RUN}`],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Counter', true)",
    [loc, tenant],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9192${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Payer')",
    [personId, tenant],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [memberId, tenant, personId, loc, `K04-${RUN}`],
  );

  const category = await menu.createMenuCategory(ctx, { locationId: loc, name: "Drinks" });
  if (!category.ok) throw new Error(category.error);
  categoryId = category.id;
  const item = await menu.createMenuItem(ctx, {
    categoryId,
    name: "Cold Coffee",
    pricePaise: 80_000,
    taxRateBp: 500,
    sacCode: "996331",
  });
  if (!item.ok) throw new Error(item.error);
  itemId = item.id;
}, 60_000);

afterAll(async () => {
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("K-04 café payments", () => {
  it("accepts card and other, each with a reference, and refuses card without one", async () => {
    const first = await newCafeInvoice();
    const card = await payments.recordPayment(ctx, {
      invoiceId: first.invoiceId,
      amountPaise: first.totalPaise,
      method: "card",
    });
    expect(card.ok).toBe(false);
    if (!card.ok) expect(card.error).toMatch(/reference/i);

    const cardWithRef = await payments.recordPayment(ctx, {
      invoiceId: first.invoiceId,
      amountPaise: first.totalPaise,
      method: "card",
      reference: `TERM-${RUN}`,
    });
    expect(cardWithRef.ok).toBe(true);

    const second = await newCafeInvoice();
    const other = await payments.recordPayment(ctx, {
      invoiceId: second.invoiceId,
      amountPaise: second.totalPaise,
      method: "other",
      reference: `TXN-${RUN}`,
    });
    expect(other.ok).toBe(true);

    const { rows } = await admin.query<{ method: string }>(
      "select method from payments where invoice_id = $1",
      [first.invoiceId],
    );
    expect(rows[0]?.method).toBe("card");
  });

  it("refuses a partial payment against a café invoice and writes nothing", async () => {
    const { invoiceId, totalPaise } = await newCafeInvoice();
    const partial = await payments.recordPayment(ctx, {
      invoiceId,
      amountPaise: totalPaise - 1,
      method: "cash",
    });
    expect(partial.ok).toBe(false);
    if (!partial.ok) expect(partial.error).toMatch(/full|outstanding/i);

    expect(await paymentCount(invoiceId)).toBe(0);
    expect(await invoicePaid(invoiceId)).toBe(0);

    const exact = await payments.recordPayment(ctx, {
      invoiceId,
      amountPaise: totalPaise,
      method: "cash",
    });
    expect(exact.ok).toBe(true);
    expect(await invoicePaid(invoiceId)).toBe(totalPaise);
  });

  it("still refuses overpayment of a café invoice", async () => {
    const { invoiceId, totalPaise } = await newCafeInvoice();
    const over = await payments.recordPayment(ctx, {
      invoiceId,
      amountPaise: totalPaise + 100,
      method: "cash",
    });
    expect(over.ok).toBe(false);
    expect(await paymentCount(invoiceId)).toBe(0);
  });

  it("keeps partial payments working for a membership invoice", async () => {
    const invoiceId = uuidv7();
    await admin.query(
      `insert into invoices
         (id, tenant_id, location_id, member_id, invoice_number, financial_year,
          issued_on, due_on, subtotal_paise, tax_paise, total_paise, status)
       values ($1, $2, $3, $4, $5, '2026-27', current_date, current_date,
               100000, 0, 100000, 'issued')`,
      [invoiceId, tenant, loc, memberId, `MEM-${RUN}`],
    );

    const partial = await payments.recordPayment(ctx, {
      invoiceId,
      amountPaise: 25_000,
      method: "cash",
    });
    expect(partial.ok).toBe(true);
    expect(await invoicePaid(invoiceId)).toBe(25_000);
  });

  it("audits every café payment in the payments service", async () => {
    const { rows } = await admin.query<{ count: string }>(
      "select count(*)::text as count from audit_log where tenant_id = $1 and action = 'payment.record'",
      [tenant],
    );
    expect(Number(rows[0]?.count ?? "0")).toBeGreaterThanOrEqual(4);
  });
});
