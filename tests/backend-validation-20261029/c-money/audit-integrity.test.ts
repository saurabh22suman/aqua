// @vitest-environment node
//
// Lane c-money — audit integrity for the money mutations (F-11) and the
// idempotency of the cash-count reopen (F-06).
//
// F-11: the audit trail is the forensic record of money. Every
// tenant-side mutation writes its row in the same transaction, and the
// writer's contract (lib/audit/write.ts) is that the actor model
// (actor_type, actor_id, source, changed_fields, request_id) is
// applied in ONE place. The money mutations that still used an inline
// insert wrote no request_id, so the most frequent money row —
// payment.record — could not be joined to the request that caused it
// (architecture §8.11: the audit and the activity stream "join by
// request_id and entity_id when reconstructing what did the user see
// and what changed"). The sibling money mutations (payment.reverse,
// invoice.void, order.*, wallet.*) already carried it.
//
// F-06: reopening a closed day supersedes the live row. Two concurrent
// reopens used to both read the live row and both write it, so one
// reopen produced TWO cash_count.reopen audit rows — the audit trail
// over-reported a counter action. The reopen must be a no-op the
// second time.
//
// Fixture setup runs through the privileged pool; every assertion runs
// against the application's own services over the app_login connection.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import { addDays, todayInZone } from "@/lib/time/tz";
import { recordPayment } from "@/lib/services/payments";
import { reversePayment } from "@/lib/services/payment-reversals";
import { getOrCreateReceipt } from "@/lib/services/receipts";
import { createInvoiceForSubscription } from "@/lib/services/invoice-mutations";
import { createSubscription } from "@/lib/services/subscriptions";
import { createPaymentQr } from "@/lib/services/payment-qrs";
import {
  confirmCashCount,
} from "@/lib/services/reconciliation";
import { reopenCashCount } from "@/lib/services/reconciliation-closed-state";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";

const TZ = "Asia/Kolkata";
const RUN = Date.now().toString(36);
const REQUEST_ID = "00000000-0000-4000-8000-0000000000aa";

const tenantId: TenantId = asTenantId(uuidv7());
const locationA = uuidv7();
const personA = uuidv7();
const memberA = uuidv7();
const planId = uuidv7();
const planB = uuidv7();
const subscriptionId = uuidv7();

let userId = asUserId("");

const ctx = () => ({
  tenantId,
  userId,
  roleKey: "owner",
  allLocations: true,
  locationIds: [] as string[],
  requestId: REQUEST_ID,
  permissions: new Set([
    "reports.financial",
    "payments.read",
    "payments.record",
    "payments.refund",
    "members.write",
    "settings.manage",
    "invoices.write",
  ]),
});

async function auditRows(action: string): Promise<
  Array<{ action: string; request_id: string | null; entity_type: string }>
> {
  const result = await admin.query(
    "select action, request_id, entity_type from audit_log where tenant_id = $1 and action = $2",
    [tenantId, action],
  );
  return result.rows;
}

beforeAll(async () => {
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Audit Club', 'active', $3)",
    [tenantId, `audit-${RUN}`, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Site A', true)",
    [locationA, tenantId],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Audit Member')",
    [personA, tenantId],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [memberA, tenantId, personA, locationA, `AUD-${RUN}`],
  );
  await admin.query(
    "insert into membership_plans (id, tenant_id, location_id, name, kind, duration_days, amount_paise) values ($1, $2, $3, 'Monthly', 'duration', 30, 100000)",
    [planId, tenantId, locationA],
  );
  // A second plan: a member may hold only one active subscription per
  // plan, so the create-subscription case needs its own.
  await admin.query(
    "insert into membership_plans (id, tenant_id, location_id, name, kind, duration_days, amount_paise) values ($1, $2, $3, 'Monthly B', 'duration', 30, 100000)",
    [planB, tenantId, locationA],
  );
  await admin.query(
    "insert into subscriptions (id, tenant_id, member_id, plan_id, location_id, starts_on, ends_on, status) values ($1, $2, $3, $4, $5, current_date, current_date + 29, 'active')",
    [subscriptionId, tenantId, memberA, planId, locationA],
  );
  userId = asUserId(randomUUID());
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    userId,
    `+9177${RUN}${String(1).padStart(3, "0")}`,
  ]);
}, 120_000);

afterAll(async () => {
  await deleteAuditRowsForTenant(admin, tenantId);
  await admin.query("delete from receipts where tenant_id = $1", [tenantId]);
  await admin.query("delete from payment_reversals where tenant_id = $1", [
    tenantId,
  ]);
  await admin.query("delete from payments where tenant_id = $1", [tenantId]);
  await admin.query("delete from invoices where tenant_id = $1", [tenantId]);
  await admin.query("delete from cash_counts where tenant_id = $1", [tenantId]);
  await admin.query("delete from subscriptions where tenant_id = $1", [tenantId]);
  await admin.query("delete from membership_plans where tenant_id = $1", [
    tenantId,
  ]);
  await admin.query("delete from payment_qrs where tenant_id = $1", [tenantId]);
  await admin.query("delete from members where tenant_id = $1", [tenantId]);
  await admin.query("delete from persons where tenant_id = $1", [tenantId]);
  await admin.query("delete from locations where tenant_id = $1", [tenantId]);
  await admin.query("delete from tenants where id = $1", [tenantId]);
  await admin.query("delete from users where phone like $1", [`+9177${RUN}%`]);
  await admin.end();
}, 120_000);

describe("the money audit rows carry the request id (F-11)", () => {
  it("records the payment, its reversal and its receipt with the request id", async () => {
    const invoice = await createInvoiceForSubscription(ctx(), {
      subscriptionId,
    });
    expect(invoice.ok).toBe(true);
    if (!invoice.ok) return;

    const payment = await recordPayment(ctx(), {
      invoiceId: invoice.id,
      amountPaise: 100000,
      method: "cash",
    });
    expect(payment.ok).toBe(true);
    if (!payment.ok) return;

    const reversal = await reversePayment(ctx(), {
      paymentId: payment.id,
      amountPaise: 30000,
      reason: "Part refunded in cash",
    });
    expect(reversal.ok).toBe(true);

    const receipt = await getOrCreateReceipt(ctx(), payment.id);
    expect(receipt.ok).toBe(true);

    for (const action of ["payment.record", "payment.reverse", "receipt.generate"]) {
      const rows = await auditRows(action);
      expect(rows.length, `${action} was written`).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.request_id, `${action} carries the request id`).toBe(REQUEST_ID);
      }
    }
  }, 60_000);

  it("records the issued invoice with the request id", async () => {
    const rows = await auditRows("invoice.issue");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.request_id).toBe(REQUEST_ID);
    }
  }, 60_000);

  it("records the subscription and the payment QR with the request id", async () => {
    const subscription = await createSubscription(ctx(), {
      memberId: memberA,
      planId: planB,
    });
    expect(subscription.ok).toBe(true);

    const qr = await createPaymentQr(ctx(), {
      nickname: `QR-${RUN}`,
      kind: "upi",
      upiId: "owner@bank",
      payeeName: "Owner",
    });
    expect(qr.ok).toBe(true);

    for (const action of ["subscription.create", "payment_qr.create"]) {
      const rows = await auditRows(action);
      expect(rows.length, `${action} was written`).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.request_id, `${action} carries the request id`).toBe(
          REQUEST_ID,
        );
      }
    }
  }, 60_000);

  it("records the cash count and its reopen with the request id", async () => {
    const onDate = todayInZone(TZ);
    // The counter took 100000 in cash today, so the count matches the
    // system figure (a variance above Rs 500 would need a reason).
    const confirmed = await confirmCashCount(ctx(), {
      locationId: locationA,
      onDate,
      countedPaise: 100000,
    });
    expect(confirmed.ok).toBe(true);

    const reopened = await reopenCashCount(ctx(), {
      locationId: locationA,
      onDate,
      reason: "Recount requested",
    });
    expect(reopened.ok).toBe(true);

    for (const action of ["cash_count.confirm", "cash_count.reopen"]) {
      const rows = await auditRows(action);
      expect(rows.length, `${action} was written`).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.request_id, `${action} carries the request id`).toBe(
          REQUEST_ID,
        );
      }
    }
  }, 60_000);
});

describe("reopening a closed day is a no-op the second time (F-06)", () => {
  it("writes exactly one reopen audit row for two concurrent reopens", async () => {
    // Yesterday's day — today's count was closed by the case above.
    const onDate = addDays(todayInZone(TZ), -1);
    const confirmed = await confirmCashCount(ctx(), {
      locationId: locationA,
      onDate,
      countedPaise: 0,
    });
    expect(confirmed.ok).toBe(true);

    const liveRows = await admin.query(
      "select id from cash_counts where tenant_id = $1 and location_id = $2 and on_date = $3 and superseded_at is null",
      [tenantId, locationA, onDate],
    );
    const countId = liveRows.rows[0].id as string;

    // The interleaving the defect needed: every reopen must READ the
    // live row before any of them commits. A second connection holds
    // the row lock, so the reopens pile up on that row and are then
    // released together.
    const blocker = await admin.connect();
    const pending = [1, 2, 3].map(() =>
      reopenCashCount(ctx(), {
        locationId: locationA,
        onDate,
        reason: "Recount requested",
      }),
    );
    try {
      await blocker.query("begin");
      await blocker.query(
        "select id from cash_counts where id = $1 for update",
        [countId],
      );
      // Let the reopens reach the blocked statement.
      await new Promise((resolve) => setTimeout(resolve, 250));
      await blocker.query("commit");
    } finally {
      // A checked-out client must be RELEASED, never ended: ending it
      // leaves the pool's bookkeeping unbalanced and pool.end() then
      // waits forever.
      await blocker.query("rollback").catch(() => {});
      blocker.release();
    }

    const results = await Promise.all(pending);
    // One reopen succeeded; the others found the day already reopened
    // — never two reopen events.
    expect(results.filter((result) => result.ok).length).toBe(1);

    // The reopen audit rows for THIS cash count (the earlier case
    // closed and reopened today, so the count is per cash-count row).
    const rows = await admin.query(
      "select id from audit_log where tenant_id = $1 and action = 'cash_count.reopen' and entity_id = $2",
      [tenantId, countId],
    );
    expect(rows.rows.length).toBe(1);

    // The live row is gone either way: the day is open again.
    const stillLive = await admin.query(
      "select id from cash_counts where tenant_id = $1 and location_id = $2 and on_date = $3 and superseded_at is null",
      [tenantId, locationA, onDate],
    );
    expect(stillLive.rows).toHaveLength(0);
  }, 60_000);
});
