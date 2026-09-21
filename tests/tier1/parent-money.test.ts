import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asMemberId, asTenantId } from "@/lib/ids";
import { getParentViewData } from "@/lib/services/parent-view";
import { getReceiptForMember } from "@/lib/services/receipts";
import { deleteAuditRowsForTenant } from "../helpers/audit-log-cleanup";

// PR2-C10 — the parent link shows money, read-only and scoped to the
// one child the token names: outstanding invoices and payment
// history. Nothing from a sibling or another tenant can appear.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const locA = uuidv7();
const locB = uuidv7();
const personA = uuidv7();
const personB = uuidv7();
const personSibling = uuidv7();
const childA = asMemberId(uuidv7());
const childB = asMemberId(uuidv7());
const sibling = asMemberId(uuidv7());
const planA = uuidv7();
const planB = uuidv7();

const today = "2026-09-21";

async function seedMember(
  tenant: string,
  person: string,
  member: string,
  location: string,
  code: string,
  plan: string,
) {
  await admin.query(
    `insert into membership_plans (id, tenant_id, location_id, name, kind, duration_days, amount_paise)
     values ($1, $2, $3, 'Monthly', 'duration', 30, 250000)`,
    [plan, tenant, location],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [member, tenant, person, location, code],
  );
}

beforeAll(async () => {
  await admin.query(
    `insert into tenants (id, slug, name, status, timezone) values
       ($1, $2, 'Parent Money A', 'active', 'Asia/Kolkata'),
       ($3, $4, 'Parent Money B', 'active', 'Asia/Kolkata')`,
    [tenantA, `pm-a-${RUN}`, tenantB, `pm-b-${RUN}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $2, 'Main', true), ($3, $4, 'Main', true)`,
    [locA, tenantA, locB, tenantB],
  );
  await admin.query(
    `insert into persons (id, tenant_id, full_name, date_of_birth) values
       ($1, $2, 'Money Child', '2015-01-01'),
       ($3, $2, 'Money Sibling', '2016-01-01'),
       ($4, $5, 'Other Child', '2015-01-01')`,
    [personA, tenantA, personSibling, personB, tenantB],
  );
  await seedMember(tenantA, personA, childA, locA, `PMA-${RUN}`, planA);
  await seedMember(tenantA, personSibling, sibling, locA, `PMS-${RUN}`, uuidv7());
  await seedMember(tenantB, personB, childB, locB, `PMB-${RUN}`, planB);

  // Child A: one open invoice (paid 500 of 2500) and one settled.
  await admin.query(
    `insert into invoices (id, tenant_id, location_id, member_id, invoice_number, financial_year, issued_on, due_on, subtotal_paise, tax_paise, total_paise, paid_paise, status)
     values
       (gen_random_uuid(), $1, $2, $3, $4, '2026-27', '2026-09-01', '2026-09-10', 250000, 0, 250000, 50000, 'partial'),
       (gen_random_uuid(), $1, $2, $3, $5, '2026-27', '2026-08-01', '2026-08-10', 250000, 0, 250000, 250000, 'paid')`,
    [tenantA, locA, childA, `PA-${RUN}-1`, `PA-${RUN}-2`],
  );
  // Sibling and other tenant invoices — must never appear for child A.
  await admin.query(
    `insert into invoices (id, tenant_id, location_id, member_id, invoice_number, financial_year, issued_on, due_on, subtotal_paise, tax_paise, total_paise, paid_paise, status)
     values
       (gen_random_uuid(), $1, $2, $3, $4, '2026-27', '2026-09-01', '2026-09-10', 100000, 0, 100000, 0, 'issued'),
       (gen_random_uuid(), $5, $6, $7, $8, '2026-27', '2026-09-01', '2026-09-10', 100000, 0, 100000, 0, 'issued')`,
    [tenantA, locA, sibling, `PS-${RUN}-1`, tenantB, locB, childB, `PB-${RUN}-1`],
  );
  // Child A payments: one against the open invoice.
  await admin.query(
    `insert into payments (id, tenant_id, member_id, location_id, invoice_id, amount_paise, method, received_at, status)
     select gen_random_uuid(), $1, $2, $3, i.id, 50000, 'cash', '2026-09-05T10:00:00Z', 'captured'
       from invoices i where i.tenant_id = $1 and i.member_id = $2 and i.invoice_number = $4`,
    [tenantA, childA, locA, `PA-${RUN}-1`],
  );
  // A sibling payment and another tenant payment.
  await admin.query(
    `insert into payments (id, tenant_id, member_id, location_id, amount_paise, method, received_at, status)
     values
       (gen_random_uuid(), $1, $2, $3, 10000, 'cash', '2026-09-06T10:00:00Z', 'captured'),
       (gen_random_uuid(), $4, $5, $6, 20000, 'cash', '2026-09-07T10:00:00Z', 'captured')`,
    [tenantA, sibling, locA, tenantB, childB, locB],
  );
});

afterAll(async () => {
  for (const tenant of [tenantA, tenantB]) {
    await admin.query("delete from receipts where tenant_id = $1", [tenant]);
    await admin.query("delete from payments where tenant_id = $1", [tenant]);
    await admin.query("delete from invoices where tenant_id = $1", [tenant]);
    await admin.query("delete from members where tenant_id = $1", [tenant]);
    await admin.query("delete from persons where tenant_id = $1", [tenant]);
    await admin.query("delete from membership_plans where tenant_id = $1", [tenant]);
    await admin.query("delete from locations where tenant_id = $1", [tenant]);
    await deleteAuditRowsForTenant(admin, tenant);
    await admin.query("delete from tenants where id = $1", [tenant]);
  }
  await admin.end();
});

function loadChildA() {
  return getParentViewData({
    tenantId: tenantA,
    personId: childA,
    today,
    monthStart: "2026-09-01",
    monthEnd: "2026-10-01",
  });
}

describe("parent money view (PR2-C10)", () => {
  it("shows the child's outstanding invoices with real amounts", async () => {
    const data = await loadChildA();
    expect(data).not.toBeNull();
    expect(data!.fees.outstanding).toHaveLength(1);
    expect(data!.fees.outstanding[0]).toMatchObject({
      invoiceNumber: `PA-${RUN}-1`,
      totalPaise: 250000,
      paidPaise: 50000,
      outstandingPaise: 200000,
      status: "partial",
      dueOn: "2026-09-10",
    });
    // The settled invoice is not "outstanding".
    expect(
      data!.fees.outstanding.some((i) => i.invoiceNumber === `PA-${RUN}-2`),
    ).toBe(false);
  });

  it("shows only the child's payment history, newest first", async () => {
    const data = await loadChildA();
    expect(data!.fees.payments).toHaveLength(1);
    expect(data!.fees.payments[0]).toMatchObject({
      amountPaise: 50000,
      method: "cash",
      invoiceNumber: `PA-${RUN}-1`,
    });
  });

  it("never leaks a sibling's or another tenant's money", async () => {
    const data = await loadChildA();
    const serialized = JSON.stringify(data!.fees);
    expect(serialized).not.toContain(`PS-${RUN}-1`);
    expect(serialized).not.toContain(`PB-${RUN}-1`);
    expect(data!.fees.payments.every((p) => p.amountPaise !== 10000)).toBe(true);
    expect(data!.fees.payments.every((p) => p.amountPaise !== 20000)).toBe(true);
  });

  it("is read-only: the shape carries no mutation affordance", async () => {
    const data = await loadChildA();
    expect(Object.keys(data!.fees).sort()).toEqual(["outstanding", "payments"]);
  });
});

describe("token-scoped receipt download (PR2-C11)", () => {
  async function paymentIdForChildA(): Promise<string> {
    const { rows } = await admin.query<{ id: string }>(
      "select id from payments where tenant_id = $1 and member_id = $2 and status = 'captured' limit 1",
      [tenantA, childA],
    );
    return rows[0]!.id;
  }

  it("generates a PDF for the token's own payment and audits the parent path", async () => {
    const paymentId = await paymentIdForChildA();
    const result = await getReceiptForMember(tenantA, childA, paymentId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pdf.subarray(0, 5).toString()).toBe("%PDF-");

    const audit = await admin.query<{
      actor_type: string;
      source: string;
      after: { via?: string };
    }>(
      "select actor_type, source, after from audit_log where tenant_id = $1 and action = 'receipt.generate' order by created_at desc limit 1",
      [tenantA],
    );
    expect(audit.rows[0]).toMatchObject({
      actor_type: "system",
      source: "api",
    });
    expect(audit.rows[0]!.after.via).toBe("parent_link");
  });

  it("serves the stored copy on a second read (one receipt row)", async () => {
    const paymentId = await paymentIdForChildA();
    const first = await getReceiptForMember(tenantA, childA, paymentId);
    const second = await getReceiptForMember(tenantA, childA, paymentId);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(Buffer.compare(first.pdf, second.pdf)).toBe(0);

    const { rows } = await admin.query<{ n: string }>(
      "select count(*)::text as n from receipts where tenant_id = $1 and payment_id = $2",
      [tenantA, paymentId],
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it("refuses a sibling's payment and another tenant's payment", async () => {
    const paymentId = await paymentIdForChildA();
    const siblingAttempt = await getReceiptForMember(
      tenantA,
      sibling,
      paymentId,
    );
    expect(siblingAttempt.ok).toBe(false);

    const crossTenant = await getReceiptForMember(tenantB, childA, paymentId);
    expect(crossTenant.ok).toBe(false);
  });

  it("refuses a forged payment id", async () => {
    const result = await getReceiptForMember(tenantA, childA, uuidv7());
    expect(result.ok).toBe(false);
  });
});
