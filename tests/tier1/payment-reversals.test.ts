import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asMemberId, asTenantId, asUserId } from "@/lib/ids";
import { seedRoleTemplates } from "@/lib/services/roles";
import { recordPayment } from "@/lib/services/payments";
import { reversePayment } from "@/lib/services/payment-reversals";
import { deleteAuditRowsForTenant } from "../helpers/audit-log-cleanup";

// PR2-C8 — payment reversals. A reversal is a NEW row; the original
// payment is never edited. The invoice's paid/outstanding figures are
// recomputed in the same transaction, over-reversal is refused, the
// row lock serialises concurrent reversals, and the new
// payments.refund permission is held by owner/admin/accountant only.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const tenantId = asTenantId(uuidv7());
const otherTenantId = asTenantId(uuidv7());
const locationId = uuidv7();
const otherLocationId = uuidv7();
const personId = uuidv7();
const memberId = asMemberId(uuidv7());
const planId = uuidv7();
const subscriptionId = uuidv7();
const invoiceId = uuidv7();
const actorId = asUserId(uuidv7());

const ctx = { tenantId, userId: actorId };
const otherCtx = { tenantId: otherTenantId, userId: actorId };
const TOTAL = 250000;

let paymentId = "";

async function paymentRow() {
  const { rows } = await admin.query<{
    amount_paise: string;
    status: string;
    method: string;
  }>(
    "select amount_paise::text, status, method from payments where id = $1",
    [paymentId],
  );
  return rows[0]!;
}

async function invoiceRow() {
  const { rows } = await admin.query<{ status: string; paid_paise: string }>(
    "select status, paid_paise::text from invoices where id = $1",
    [invoiceId],
  );
  return { status: rows[0]!.status, paidPaise: Number(rows[0]!.paid_paise) };
}

async function reversedTotal(): Promise<number> {
  const { rows } = await admin.query<{ total: string }>(
    "select coalesce(sum(amount_paise),0)::text as total from payment_reversals where payment_id = $1",
    [paymentId],
  );
  return Number(rows[0]!.total);
}

beforeAll(async () => {
  await admin.query(
    `insert into tenants (id, slug, name, status, timezone) values
       ($1, $2, 'Reversals', 'active', 'Asia/Kolkata'),
       ($3, $4, 'Reversals B', 'active', 'Asia/Kolkata')`,
    [tenantId, `rev-${RUN}`, otherTenantId, `rev-b-${RUN}`],
  );
  await seedRoleTemplates(tenantId);
  await seedRoleTemplates(otherTenantId);
  await admin.query(
    "insert into users (id, phone) values ($1, $2) on conflict do nothing",
    [actorId, `+9196${String(Date.now()).slice(-8)}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $2, 'Main', true), ($3, $4, 'Other', true)`,
    [locationId, tenantId, otherLocationId, otherTenantId],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Reversal Member')",
    [personId, tenantId],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [memberId, tenantId, personId, locationId, `REV-${RUN}`],
  );
  await admin.query(
    `insert into membership_plans (id, tenant_id, location_id, name, kind, duration_days, amount_paise)
     values ($1, $2, $3, 'Monthly', 'duration', 30, 250000)`,
    [planId, tenantId, locationId],
  );
  await admin.query(
    `insert into subscriptions (id, tenant_id, member_id, plan_id, location_id, starts_on, ends_on, status)
     values ($1, $2, $3, $4, $5, '2026-09-01', '2026-09-30', 'active')`,
    [subscriptionId, tenantId, memberId, planId, locationId],
  );
  await admin.query(
    `insert into invoices (id, tenant_id, location_id, member_id, subscription_id, invoice_number, financial_year, issued_on, due_on, subtotal_paise, tax_paise, total_paise, status)
     values ($1, $2, $3, $4, $5, $6, '2026-27', '2026-09-01', '2026-09-10', $7, 0, $7, 'issued')`,
    [invoiceId, tenantId, locationId, memberId, subscriptionId, `RV-${RUN}-1`, TOTAL],
  );

  const payment = await recordPayment(ctx, {
    invoiceId,
    amountPaise: 100000,
    method: "cash",
  });
  if (!payment.ok) throw new Error("fixture payment failed");
  paymentId = payment.id;
});

afterAll(async () => {
  for (const tenant of [tenantId, otherTenantId]) {
    await admin.query("delete from payment_reversals where tenant_id = $1", [tenant]);
    await admin.query("delete from payments where tenant_id = $1", [tenant]);
    await admin.query("delete from invoices where tenant_id = $1", [tenant]);
    await admin.query("delete from subscriptions where tenant_id = $1", [tenant]);
    await admin.query("delete from membership_plans where tenant_id = $1", [tenant]);
    await admin.query("delete from members where tenant_id = $1", [tenant]);
    await admin.query("delete from persons where tenant_id = $1", [tenant]);
    await admin.query("delete from locations where tenant_id = $1", [tenant]);
    await deleteAuditRowsForTenant(admin, tenant);
  }
  await admin.query("delete from role_permissions where tenant_id = any($1::uuid[])", [
    [tenantId, otherTenantId],
  ]);
  await admin.query("delete from roles where tenant_id = any($1::uuid[])", [
    [tenantId, otherTenantId],
  ]);
  await admin.query("delete from tenants where id = any($1::uuid[])", [
    [tenantId, otherTenantId],
  ]);
  await admin.end();
});

describe("payments.refund permission (PR2-C8)", () => {
  it("is held by owner, admin and accountant — and not by receptionist or coach", async () => {
    const { rows } = await admin.query<{ role_key: string }>(
      `select r.key as role_key
         from role_permissions rp
         join roles r on r.id = rp.role_id and r.tenant_id = rp.tenant_id
        where rp.tenant_id = $1 and rp.permission_key = 'payments.refund'
        order by r.key`,
      [tenantId],
    );
    expect(rows.map((r) => r.role_key)).toEqual([
      "accountant",
      "admin",
      "owner",
    ]);
  });
});

describe("reversePayment", () => {
  it("creates a reversal row, recomputes the invoice and leaves the payment untouched", async () => {
    const result = await reversePayment(ctx, {
      paymentId,
      amountPaise: 40000,
      reason: "Duplicate cash entry at the counter",
    });
    expect(result).toMatchObject({ ok: true, invoiceStatus: "partial" });
    expect(await reversedTotal()).toBe(40000);
    expect(await invoiceRow()).toEqual({ status: "partial", paidPaise: 60000 });
    // The original payment row is immutable.
    expect(await paymentRow()).toEqual({
      amount_paise: "100000",
      status: "captured",
      method: "cash",
    });

    const audit = await admin.query<{ action: string; actor_id: string }>(
      "select action, actor_id from audit_log where tenant_id = $1 and action = 'payment.reverse' order by created_at desc limit 1",
      [tenantId],
    );
    expect(audit.rows[0]).toMatchObject({
      action: "payment.reverse",
      actor_id: actorId,
    });
  });

  it("refuses a reversal beyond the remaining amount", async () => {
    const over = await reversePayment(ctx, {
      paymentId,
      amountPaise: 70000,
      reason: "Too much",
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toMatch(/remaining/i);
    expect(await reversedTotal()).toBe(40000);
  });

  it("refuses a reason shorter than three characters", async () => {
    const bad = await reversePayment(ctx, {
      paymentId,
      amountPaise: 1000,
      reason: "x",
    });
    expect(bad.ok).toBe(false);
  });

  it("refuses a payment from another tenant", async () => {
    const cross = await reversePayment(otherCtx, {
      paymentId,
      amountPaise: 1000,
      reason: "Cross tenant",
    });
    expect(cross.ok).toBe(false);
  });

  it("serialises concurrent reversals of the same payment", async () => {
    // 60000 remains. Two concurrent full-remainder reversals: exactly
    // one may win.
    const [first, second] = await Promise.all([
      reversePayment(ctx, {
        paymentId,
        amountPaise: 60000,
        reason: "Counter reversal A",
      }),
      reversePayment(ctx, {
        paymentId,
        amountPaise: 60000,
        reason: "Counter reversal B",
      }),
    ]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect(await reversedTotal()).toBe(100000);
    expect(await invoiceRow()).toEqual({ status: "issued", paidPaise: 0 });
  });
});
