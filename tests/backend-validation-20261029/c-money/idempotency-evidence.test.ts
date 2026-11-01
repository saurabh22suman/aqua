// @vitest-environment node
//
// Lane c-money — EVIDENCE ONLY, not a regression gate.
//
// Two open questions are reproduced here with exact rows, balances and
// audit counts. Neither is fixed in this lane:
//
// F-09 (cash payments and repeated reversals have no idempotency):
//   the reproduction shows what a duplicate submission does to the
//   money, the invoice balance and the audit trail. The fix needs a
//   schema/migration change (an idempotency key and a unique
//   constraint), which is human-owned: the proposed patch is prepared
//   UNAPPLIED at
//   docs/audits/backend-validation-20261029/c-money/proposals/f09-idempotency-proposed.patch
//
// F-05 (the cafe void path can void an invoice with only
// payments.record, while a direct invoice void needs settings.manage):
//   the reproduction shows both answers side by side. No rule is
//   invented here; the proposal is at
//   docs/audits/backend-validation-20261029/c-money/proposals/f05-cafe-void-authority-proposal.md
//
// These assertions describe TODAY's behaviour on purpose: they are the
// record the human decides against, not a gate that must stay green
// after the decision.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import { todayInZone } from "@/lib/time/tz";
import { recordPayment } from "@/lib/services/payments";
import { reversePayment } from "@/lib/services/payment-reversals";
import { voidInvoice } from "@/lib/services/invoice-mutations";
import { createOrder, finalizeOrder } from "@/lib/services/orders";
import { getInvoice } from "@/lib/services/invoices";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";

const RUN = Date.now().toString(36);
const tenantId: TenantId = asTenantId(uuidv7());
const locationA = uuidv7();
const personA = uuidv7();
const memberA = uuidv7();
const planA = uuidv7();
const menuItemA = uuidv7();
const menuCategoryA = uuidv7();

const userId = asUserId(randomUUID());

// A counter caller: payments.record, no settings.manage — the shape a
// receptionist holds.
const counterCtx = {
  tenantId,
  userId,
  roleKey: "receptionist",
  allLocations: true,
  locationIds: [] as string[],
  permissions: new Set([
    "payments.record",
    "invoices.read",
    "invoices.write",
    "members.read",
    "members.write",
  ]),
};

const invoiceId = uuidv7();
const invoiceBId = uuidv7();

beforeAll(async () => {
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Evidence Club', 'active', 'Asia/Kolkata')",
    [tenantId, `evidence-${RUN}`],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Site A', true)",
    [locationA, tenantId],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Evidence Member')",
    [personA, tenantId],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [memberA, tenantId, personA, locationA, `EVID-${RUN}`],
  );
  await admin.query(
    "insert into membership_plans (id, tenant_id, location_id, name, kind, duration_days, amount_paise) values ($1, $2, $3, 'Monthly', 'duration', 30, 100000)",
    [planA, tenantId, locationA],
  );
  await admin.query(
    "insert into menu_categories (id, tenant_id, location_id, name) values ($1, $2, $3, 'Cafe')",
    [menuCategoryA, tenantId, locationA],
  );
  await admin.query(
    `insert into menu_items (id, tenant_id, location_id, category_id, name, price_paise, tax_rate_bp, sac_code, is_active)
     values ($1, $2, $3, $4, 'Cafe item', 5000, 0, '9999', true)`,
    [menuItemA, tenantId, locationA, menuCategoryA],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    userId,
    `+9155${RUN}${String(1).padStart(3, "0")}`,
  ]);
  // Two live invoices: the first for the duplicate-payment case, the
  // second for the repeated-reversal case.
  await admin.query(
    `insert into invoices (id, tenant_id, location_id, member_id, invoice_number,
       financial_year, issued_on, due_on, subtotal_paise, tax_paise, total_paise,
       paid_paise, status)
     values ($1, $2, $3, $4, $5, '2026-27', $6, $6, 10000, 0, 10000, 0, 'issued'),
            ($7, $2, $3, $4, $8, '2026-27', $6, $6, 5000, 0, 5000, 0, 'issued')`,
    [
      invoiceId,
      tenantId,
      locationA,
      memberA,
      `EVI${RUN.slice(-10)}`,
      todayInZone("Asia/Kolkata"),
      invoiceBId,
      `EVJ${RUN.slice(-10)}`,
    ],
  );
}, 120_000);

afterAll(async () => {
  await deleteAuditRowsForTenant(admin, tenantId);
  await admin.query("delete from payment_reversals where tenant_id = $1", [tenantId]);
  await admin.query("delete from payments where tenant_id = $1", [tenantId]);
  await admin.query("delete from order_lines where tenant_id = $1", [tenantId]);
  await admin.query("delete from orders where tenant_id = $1", [tenantId]);
  await admin.query("delete from menu_items where tenant_id = $1", [tenantId]);
  await admin.query("delete from menu_categories where tenant_id = $1", [tenantId]);
  await admin.query("delete from invoices where tenant_id = $1", [tenantId]);
  await admin.query("delete from membership_plans where tenant_id = $1", [tenantId]);
  await admin.query("delete from members where tenant_id = $1", [tenantId]);
  await admin.query("delete from persons where tenant_id = $1", [tenantId]);
  await admin.query("delete from locations where tenant_id = $1", [tenantId]);
  await admin.query("delete from tenants where id = $1", [tenantId]);
  await admin.query("delete from users where phone like $1", [`+9155${RUN}%`]);
  await admin.end();
}, 120_000);

describe("F-09 evidence — a repeated submission is applied twice", () => {
  it("records a second cash payment when the same one is submitted again", async () => {
    const first = await recordPayment(counterCtx, {
      invoiceId,
      amountPaise: 5000,
      method: "cash",
    });
    expect(first.ok).toBe(true);

    // The same submission again — no reference to deduplicate on.
    const second = await recordPayment(counterCtx, {
      invoiceId,
      amountPaise: 5000,
      method: "cash",
    });
    expect(second.ok).toBe(true);

    const payments = await admin.query(
      "select id, amount_paise, method, reference from payments where tenant_id = $1 and invoice_id = $2 order by created_at",
      [tenantId, invoiceId],
    );
    expect(payments.rows).toHaveLength(2);
    expect(payments.rows.map((row) => Number(row.amount_paise))).toEqual([
      5000, 5000,
    ]);
    // Both rows carry no reference: there is nothing that could have
    // told the second one apart from the first.
    expect(payments.rows.every((row) => row.reference === null)).toBe(true);

    const invoice = await getInvoice(counterCtx, invoiceId);
    expect(invoice!.paidPaise).toBe(10000);
    expect(invoice!.status).toBe("paid");

    const audits = await admin.query(
      "select id from audit_log where tenant_id = $1 and action = 'payment.record' and entity_id = any($2::uuid[])",
      [tenantId, payments.rows.map((row) => row.id)],
    );
    expect(audits.rows).toHaveLength(2);
  }, 60_000);

  it("reverses the same payment twice when the same partial reversal is sent again", async () => {
    // A FULL second reversal is already refused ("This payment is
    // already fully reversed"): the remaining-amount check catches it.
    // A repeated PARTIAL reversal is not: the same 300 is taken twice.
    const payment = await recordPayment(counterCtx, {
      invoiceId: invoiceBId,
      amountPaise: 1000,
      method: "cash",
    });
    expect(payment.ok).toBe(true);
    if (!payment.ok) return;

    const first = await reversePayment(counterCtx, {
      paymentId: payment.id,
      amountPaise: 300,
      reason: "Wrong entry",
    });
    expect(first.ok).toBe(true);

    const second = await reversePayment(counterCtx, {
      paymentId: payment.id,
      amountPaise: 300,
      reason: "Wrong entry",
    });
    expect(second.ok).toBe(true);

    const reversals = await admin.query(
      "select id, amount_paise from payment_reversals where tenant_id = $1 and payment_id = $2",
      [tenantId, payment.id],
    );
    expect(reversals.rows).toHaveLength(2);
    expect(reversals.rows.map((row) => Number(row.amount_paise))).toEqual([
      300, 300,
    ]);

    // The invoice gave up 600 against a single 1000 payment.
    const invoice = await getInvoice(counterCtx, invoiceBId);
    expect(invoice!.paidPaise).toBe(400);

    const audits = await admin.query(
      "select id from audit_log where tenant_id = $1 and action = 'payment.reverse' and entity_id = $2",
      [tenantId, payment.id],
    );
    expect(audits.rows).toHaveLength(2);
  }, 60_000);
});

describe("F-05 evidence — two doors to voiding an invoice", () => {
  it("refuses a direct invoice void without settings.manage", async () => {
    const refused = await voidInvoice(counterCtx, invoiceId, "Duplicate raise");
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error).toMatch(/owner or admin/i);
  }, 60_000);

  it("voids the cafe invoice through the order path with the same permissions", async () => {
    const order = await createOrder(counterCtx, {
      locationId: locationA,
      memberId: memberA,
      lines: [{ itemId: menuItemA, qty: 1 }],
    });
    expect(order.ok).toBe(true);
    if (!order.ok) return;

    const billed = await finalizeOrder(counterCtx, order.orderId);
    expect(billed.ok).toBe(true);
    if (!billed.ok) return;

    // The cafe void rides payments.record only.
    const { voidOrder } = await import("@/lib/services/orders");
    const voided = await voidOrder(counterCtx, order.orderId, "Wrong order");
    expect(voided.ok).toBe(true);

    const invoice = await getInvoice(counterCtx, billed.invoiceId);
    expect(invoice!.status).toBe("void");

    const audits = await admin.query(
      "select action from audit_log where tenant_id = $1 and action = 'invoice.void' and entity_id = $2",
      [tenantId, billed.invoiceId],
    );
    expect(audits.rows).toHaveLength(1);
  }, 60_000);
});
