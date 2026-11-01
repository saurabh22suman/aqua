// @vitest-environment node
//
// F01 M-01 — genuine app-clock-skew stale-observation case.
//
// `markIntentCommitted` writes `committed_at` with the application's
// `new Date()`. Two app instances do not share a monotonic clock. This
// case commits K2 after K1 with the SECOND app instance's clock running
// one hour behind, so K2 carries an EARLIER application timestamp than
// K1 while the commit order stays K1 then K2.
//
// Fixture alignment (2026-10-30): the skew used to be applied by
// rewriting K2's `committed_at` after the commit. The approved M-04
// guard makes a committed row immutable (identity, payload, chain and
// the final marker are frozen), so that rewrite is now correctly
// refused. The skew is therefore applied to the app clock BEFORE the
// real second commit, through a Date-only fake clock, and the real
// clock is restored in a finally block. The ordering anomaly, the
// service behaviour and the stale-observation assertion are unchanged;
// the trigger is not bypassed and no production clock logic is touched.
//
// Before the ordering guard is corrected:
//   * the recovery read returns K1 instead of the later K2; and
//   * K3, observing K1, is accepted and creates a third payment.
// After the observed-intent chain guard:
//   * the read returns the chain tip K2; and
//   * K3 is refused with stale_observation and no financial effect.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import { todayInZone } from "@/lib/time/tz";
import { recordPayment } from "@/lib/services/payments";
import { listPaymentIntentRecovery } from "@/lib/services/payment-intent-recovery";
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
const invoiceId = uuidv7();

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

type IntentRow = {
  id: string;
  idempotency_key: string;
  committed_at: Date;
};

async function intentRow(key: string): Promise<IntentRow> {
  const result = await admin.query(
    "select id, idempotency_key, committed_at from payment_intents where tenant_id = $1 and idempotency_key = $2",
    [tenantId, key],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0] as IntentRow;
}

async function paymentRows() {
  const result = await admin.query(
    "select id from payments where tenant_id = $1 and invoice_id = $2 order by created_at",
    [tenantId, invoiceId],
  );
  return result.rows as { id: string }[];
}

beforeAll(async () => {
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Clock Skew Club', 'active', $3)",
    [tenantId, `clock-skew-${RUN}`, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Site A', true)",
    [locationId, tenantId],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name, phone, date_of_birth) values ($1, $2, 'Clock Skew Member', $3, '1990-01-01')",
    [personId, tenantId, `+9198${PHONE_RUN}61`],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status, joined_on) values ($1, $2, $3, $4, $5, 'active', current_date - 200)",
    [memberId, tenantId, personId, locationId, `SKEW-${RUN}`.slice(0, 16)],
  );
  await admin.query(
    `insert into invoices (id, tenant_id, location_id, member_id, invoice_number,
       financial_year, issued_on, due_on, subtotal_paise, tax_paise, total_paise,
       paid_paise, status)
     values ($1, $2, $3, $4, $5, '2026-27', $6, $6, 10000, 0, 10000, 0, 'issued')`,
    [
      invoiceId,
      tenantId,
      locationId,
      memberId,
      `SKEW${RUN}`.slice(0, 16),
      todayInZone(TZ),
    ],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    userId,
    `+9198${PHONE_RUN}62`,
  ]);
}, 120_000);

afterAll(async () => {
  await deleteAuditRowsForTenant(admin, tenantId);
  await admin.query(
    "delete from whatsapp_notification_outbox where tenant_id = $1",
    [tenantId],
  );
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

describe("F01 M-01 — app-clock skew must not defeat stale observation", () => {
  it("refuses a stale observation when a later commit carries an earlier app timestamp", async () => {
    const key1 = randomUUID();
    const first = await recordPayment(ctx, {
      invoiceId,
      amountPaise: 1000,
      method: "cash",
      idempotencyKey: key1,
      observedIntentId: null,
    });
    expect(first.ok).toBe(true);
    const intent1 = await intentRow(key1);

    // A second app instance commits K2 later but its wall clock is behind
    // K1's. The order of commits is K1 then K2; only the application
    // timestamp is inverted. The skew is applied to the app clock BEFORE
    // the real second commit, so the committed marker is written exactly the
    // way a lagging instance would write it (the committed row is immutable
    // after the commit).
    const skewedNow = new Date(
      new Date(intent1.committed_at).getTime() - 3_600_000,
    );
    const key2 = randomUUID();
    let second: Awaited<ReturnType<typeof recordPayment>>;
    vi.useFakeTimers({ toFake: ["Date"], now: skewedNow });
    try {
      second = await recordPayment(ctx, {
        invoiceId,
        amountPaise: 1000,
        method: "cash",
        idempotencyKey: key2,
        observedIntentId: intent1.id,
      });
    } finally {
      vi.useRealTimers();
    }
    expect(second.ok).toBe(true);
    const intent2 = await intentRow(key2);
    expect(
      new Date(intent2.committed_at).getTime(),
      "the second commit must carry the skewed (earlier) app timestamp",
    ).toBeLessThan(new Date(intent1.committed_at).getTime());

    const recovery = await listPaymentIntentRecovery(ctx, "payment", invoiceId);
    expect(recovery.lastCommitted?.intentId).toBe(intent2.id);

    // K3 saw K1 before K2 committed. The chain has K1 -> K2, so K3 is stale
    // regardless of the inverted wall-clock value.
    const third = await recordPayment(ctx, {
      invoiceId,
      amountPaise: 1000,
      method: "cash",
      idempotencyKey: randomUUID(),
      observedIntentId: intent1.id,
    });
    expect(third.ok).toBe(false);
    expect(third.ok === false ? third.conflict : undefined).toBe(
      "stale_observation",
    );
    expect(await paymentRows()).toHaveLength(2);
  }, 60_000);
});
