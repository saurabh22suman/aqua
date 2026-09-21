import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asMemberId, asTenantId, asUserId, type TenantId } from "@/lib/ids";
import { seedRoleTemplates } from "@/lib/services/roles";
import { recordPayment } from "@/lib/services/payments";
import { deleteAuditRowsForTenant } from "../helpers/audit-log-cleanup";

// PR2-C3 — receptionist counter payments. The permission audit first:
// the receptionist template already holds payments.record,
// invoices.read and invoices.write (the last added in PR2-C2), so
// recording rides the existing service with no new grant. Then the
// money rules the counter depends on: cash and UPI, partial balances,
// duplicate-reference refusal, overpayment refusal and the audit row.

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
const invoiceA = uuidv7();
const invoiceB = uuidv7();
const actorId = asUserId(uuidv7());

const ctx = { tenantId, userId: actorId };
const otherCtx = { tenantId: otherTenantId, userId: actorId };

const TOTAL = 250000;

async function invoiceState(id: string) {
  const { rows } = await admin.query<{
    status: string;
    paid_paise: string;
  }>("select status, paid_paise::text from invoices where id = $1", [id]);
  return { status: rows[0]!.status, paidPaise: Number(rows[0]!.paid_paise) };
}

beforeAll(async () => {
  await admin.query(
    `insert into tenants (id, slug, name, status, timezone) values
       ($1, $2, 'Reception Payments', 'active', 'Asia/Kolkata'),
       ($3, $4, 'Other Payments', 'active', 'Asia/Kolkata')`,
    [tenantId, `recpay-${RUN}`, otherTenantId, `recpay-b-${RUN}`],
  );
  await seedRoleTemplates(tenantId);
  await seedRoleTemplates(otherTenantId);
  await admin.query(
    "insert into users (id, phone) values ($1, $2) on conflict do nothing",
    [actorId, `+9197${String(Date.now()).slice(-8)}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $2, 'Main', true), ($3, $4, 'Other', true)`,
    [locationId, tenantId, otherLocationId, otherTenantId],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Counter Member')",
    [personId, tenantId],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [memberId, tenantId, personId, locationId, `REC-${RUN}`],
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
     values
       ($1, $2, $3, $4, $5, $6, '2026-27', '2026-09-01', '2026-09-10', $8, 0, $8, 'issued'),
       ($7, $2, $3, $4, $5, $9, '2026-27', '2026-09-01', '2026-10-10', $8, 0, $8, 'issued')`,
    [
      invoiceA,
      tenantId,
      locationId,
      memberId,
      subscriptionId,
      `RP-${RUN}-1`,
      invoiceB,
      TOTAL,
      `RP-${RUN}-2`,
    ],
  );
});

afterAll(async () => {
  for (const tenant of [tenantId, otherTenantId]) {
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

describe("receptionist permission audit (PR2-C3)", () => {
  it("holds payments.record, invoices.read and invoices.write — no missing key", async () => {
    const { rows } = await admin.query<{ permission_key: string }>(
      `select rp.permission_key
         from role_permissions rp
         join roles r on r.id = rp.role_id and r.tenant_id = rp.tenant_id
        where rp.tenant_id = $1
          and r.key = 'receptionist'
          and rp.permission_key in ('payments.record', 'invoices.read', 'invoices.write')
        order by rp.permission_key`,
      [tenantId],
    );
    expect(rows.map((r) => r.permission_key)).toEqual([
      "invoices.read",
      "invoices.write",
      "payments.record",
    ]);
  });
});

describe("receptionist counter payments", () => {
  it("records a partial cash payment and audits it", async () => {
    const result = await recordPayment(ctx, {
      invoiceId: invoiceA,
      amountPaise: 100000,
      method: "cash",
    });
    expect(result).toMatchObject({ ok: true, invoiceStatus: "partial" });
    expect(await invoiceState(invoiceA)).toEqual({
      status: "partial",
      paidPaise: 100000,
    });

    const { rows } = await admin.query<{ action: string; actor_id: string }>(
      "select action, actor_id from audit_log where tenant_id = $1 and action = 'payment.record'",
      [tenantId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_id).toBe(actorId);
  });

  it("refuses UPI without a reference and cash with one", async () => {
    const noRef = await recordPayment(ctx, {
      invoiceId: invoiceA,
      amountPaise: 50000,
      method: "upi",
    });
    expect(noRef.ok).toBe(false);

    const cashRef = await recordPayment(ctx, {
      invoiceId: invoiceA,
      amountPaise: 50000,
      method: "cash",
      reference: "UTR123",
    });
    expect(cashRef.ok).toBe(false);
  });

  it("records UPI with a reference and refuses a duplicate reference", async () => {
    const first = await recordPayment(ctx, {
      invoiceId: invoiceA,
      amountPaise: 50000,
      method: "upi",
      reference: `UTR-${RUN}-1`,
    });
    expect(first.ok).toBe(true);

    const dupe = await recordPayment(ctx, {
      invoiceId: invoiceB,
      amountPaise: 50000,
      method: "upi",
      reference: `UTR-${RUN}-1`,
    });
    expect(dupe.ok).toBe(false);
    if (!dupe.ok) expect(dupe.error).toMatch(/already been used/i);
  });

  it("refuses an overpayment beyond the outstanding balance", async () => {
    const over = await recordPayment(ctx, {
      invoiceId: invoiceA,
      amountPaise: TOTAL,
      method: "cash",
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toMatch(/outstanding/i);
  });

  it("settles the balance to paid with a final cash payment", async () => {
    const final = await recordPayment(ctx, {
      invoiceId: invoiceA,
      amountPaise: TOTAL - 150000,
      method: "cash",
    });
    expect(final).toMatchObject({ ok: true, invoiceStatus: "paid" });
    expect(await invoiceState(invoiceA)).toEqual({
      status: "paid",
      paidPaise: TOTAL,
    });
  });

  it("keeps payments tenant-isolated", async () => {
    const cross = await recordPayment(otherCtx, {
      invoiceId: invoiceA,
      amountPaise: 1000,
      method: "cash",
    });
    expect(cross.ok).toBe(false);
  });
});
