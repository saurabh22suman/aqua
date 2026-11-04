// @vitest-environment node
//
// F01 durable recovery — PRE-EDIT RED for two real public-writer issues.
//
// These cases are written against the CURRENT public service before the
// approved F01 patch is applied. They do not import the new intent module
// or the new table; they assert only the existing public behaviour:
//
//   1. a second device whose recovery read saw no committed intent must
//      not record a second payment after another device committed; and
//   2. two devices racing with DIFFERENT operation keys must produce one
//      effect, not two.
//
// Today both requests are accepted because the public service strips the
// operation identity. The intended failure is a real duplicate money row,
// not an import/setup error. The same file becomes GREEN after the
// approved durable-intent change.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import { todayInZone } from "@/lib/time/tz";
import { recordPayment } from "@/lib/services/payments";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";

const TZ = "Asia/Kolkata";
const RUN = Date.now().toString(36);
const PHONE_RUN = String(Date.now() % 100_000_000).padStart(8, "0");

const tenantId: TenantId = asTenantId(uuidv7());
const locationId = uuidv7();
const personId = uuidv7();
const memberId = uuidv7();
const userId = asUserId(randomUUID());
const staleInvoiceId = uuidv7();
const raceInvoiceId = uuidv7();

const ctx = {
  tenantId,
  userId,
  roleKey: "receptionist",
  allLocations: true,
  locationIds: [] as string[],
  permissions: new Set([
    "payments.record",
    "payments.read",
    "payments.refund",
    "invoices.read",
    "invoices.write",
  ]),
};

async function paymentRows(forInvoiceId: string) {
  const result = await admin.query(
    "select id, amount_paise from payments where tenant_id = $1 and invoice_id = $2 order by created_at",
    [tenantId, forInvoiceId],
  );
  return result.rows as { id: string; amount_paise: string }[];
}

async function auditRows(entityId: string) {
  const result = await admin.query(
    "select id from audit_log where tenant_id = $1 and action = 'payment.record' and entity_id = $2",
    [tenantId, entityId],
  );
  return result.rows as { id: string }[];
}

async function outboxRows() {
  const result = await admin.query(
    "select id from whatsapp_notification_outbox where tenant_id = $1 and member_id = $2",
    [tenantId, memberId],
  );
  return result.rows as { id: string }[];
}

beforeAll(async () => {
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Pre-edit Red Club', 'active', $3)",
    [tenantId, `pre-edit-${RUN}`, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Site A', true)",
    [locationId, tenantId],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name, phone, date_of_birth) values ($1, $2, 'Pre-edit Member', $3, '1990-01-01')",
    [personId, tenantId, `+9198${PHONE_RUN}41`],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status, joined_on) values ($1, $2, $3, $4, $5, 'active', current_date - 200)",
    [memberId, tenantId, personId, locationId, `PRE-${RUN}`.slice(0, 16)],
  );
  const today = todayInZone(TZ);
  await admin.query(
    `insert into invoices (id, tenant_id, location_id, member_id, invoice_number,
       financial_year, issued_on, due_on, subtotal_paise, tax_paise, total_paise,
       paid_paise, status)
     values ($1, $2, $3, $4, $5, '2026-27', $6, $6, 10000, 0, 10000, 0, 'issued'),
            ($7, $2, $3, $4, $8, '2026-27', $6, $6, 10000, 0, 10000, 0, 'issued')`,
    [
      staleInvoiceId,
      tenantId,
      locationId,
      memberId,
      `PRE${RUN}1`.slice(0, 16),
      today,
      raceInvoiceId,
      `PRE${RUN}2`.slice(0, 16),
    ],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    userId,
    `+9198${PHONE_RUN}42`,
  ]);
}, 120_000);

beforeEach(async () => {
  // The outbox is per member, not per invoice: each case must see only its
  // own notification. The payment/audit rows stay per invoice.
  await admin.query(
    "delete from whatsapp_notification_outbox where tenant_id = $1",
    [tenantId],
  );
});

afterAll(async () => {
  await deleteAuditRowsForTenant(admin, tenantId);
  await admin.query(
    "delete from whatsapp_notification_outbox where tenant_id = $1",
    [tenantId],
  );
  // F01 hardening (M-03): the durable intent rows reference the
  // financial targets, so they are removed BEFORE the targets, in
  // the same order the production teardown uses.
  await admin.query("delete from payment_intents where tenant_id = $1", [
    tenantId,
  ]);
  await admin.query("delete from payments where tenant_id = $1", [tenantId]);
  await admin.query("delete from invoices where tenant_id = $1", [tenantId]);
  await admin.query("delete from members where tenant_id = $1", [tenantId]);
  await admin.query("delete from persons where tenant_id = $1", [tenantId]);
  await admin.query("delete from locations where tenant_id = $1", [tenantId]);
  await admin.query("delete from tenants where id = $1", [tenantId]);
  await admin.query("delete from users where id = $1", [userId]);
  await admin.end();
}, 120_000);

describe("F01 pre-edit RED — current public writer duplicates on a stale second device", () => {
  it("refuses a new key whose observed read is stale after another device committed", async () => {
    const first = await recordPayment(ctx, {
      invoiceId: staleInvoiceId,
      amountPaise: 1000,
      method: "cash",
      idempotencyKey: randomUUID(),
      observedIntentId: null,
    });
    expect(first.ok).toBe(true);

    // The second device's recovery read happened before the first commit:
    // it saw no committed intent and sends a new key with null.
    const second = await recordPayment(ctx, {
      invoiceId: staleInvoiceId,
      amountPaise: 1000,
      method: "cash",
      idempotencyKey: randomUUID(),
      observedIntentId: null,
    });
    expect(second.ok).toBe(false);
    expect(second.ok === false ? second.conflict : undefined).toBe(
      "stale_observation",
    );

    const rows = await paymentRows(staleInvoiceId);
    expect(rows).toHaveLength(1);
    expect(await auditRows(rows[0].id)).toHaveLength(1);
    expect(await outboxRows()).toHaveLength(1);
  }, 60_000);

  it("records one effect when two devices race with different keys", async () => {
    const attempts = [randomUUID(), randomUUID()].map((idempotencyKey) =>
      recordPayment(ctx, {
        invoiceId: raceInvoiceId,
        amountPaise: 1000,
        method: "cash",
        idempotencyKey,
        observedIntentId: null,
      }),
    );
    const results = await Promise.all(attempts);
    const accepted = results.filter((result) => result.ok);
    const refused = results.filter((result) => !result.ok);

    expect(accepted).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(
      refused[0].ok === false ? refused[0].conflict : undefined,
    ).toMatch(/^(already_prepared|stale_observation)$/);

    const rows = await paymentRows(raceInvoiceId);
    expect(rows).toHaveLength(1);
    expect(await auditRows(rows[0].id)).toHaveLength(1);
    expect(await outboxRows()).toHaveLength(1);
  }, 60_000);
});
