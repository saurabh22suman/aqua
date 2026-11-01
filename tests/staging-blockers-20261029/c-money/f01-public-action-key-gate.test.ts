// @vitest-environment node
//
// Staging blocker F01 — the PUBLIC Server Action boundary.
//
// ACCEPTANCE REGRESSION — EXPECTED RED until the F01 change is approved
// and applied.
//
// A Server Action is a public HTTP boundary: anything the browser sends
// arrives there. If the action accepts a payment without an operation
// key, the replay gap is open — a direct request (or a client that
// drops the key) records the money again, and no idempotency anywhere
// below the action can stop it.
//
// This file therefore pins the boundary itself:
//
//   - a public payment request WITHOUT an operation key is refused with a
//     refresh/retry message, and NOTHING is written;
//   - a public reversal request WITHOUT an operation key is refused, and
//     NOTHING is written;
//   - the same public request WITH an operation key is recorded, and its
//     retry is recorded ONCE.
//
// Only the session lookup is replaced (the test has no browser session);
// the REAL permission gate runs, with the caller's resolved permissions
// and the tenant's billing feature entitlement.
//
// Fixture setup and cleanup run through the privileged pool
// (tests/db/privileged-fixture.ts); every count is read back from the
// database and every write goes through the application's own services
// over the app_login connection.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import { todayInZone } from "@/lib/time/tz";
import { recordPaymentAction } from "@/lib/actions/payments";
import { reversePaymentAction } from "@/lib/actions/payment-reversals";
import { recordPayment } from "@/lib/services/payments";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";

const TZ = "Asia/Kolkata";
const RUN = Date.now().toString(36);
const PHONE_RUN = String(Date.now() % 100_000_000).padStart(8, "0");

// The action resolves the caller's session from the request. The test
// supplies the resolved context instead; the permission gate below the
// action is the real one.
const holder = vi.hoisted(() => ({
  ctx: null as null | {
    tenantId: TenantId;
    userId: ReturnType<typeof asUserId>;
    roleKey: string;
    allLocations: boolean;
    locationIds: string[];
    permissions: Set<string>;
    features: Set<string>;
  },
}));

vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: async () => holder.ctx,
}));

const tenantId: TenantId = asTenantId(uuidv7());
const locationA = uuidv7();
const personA = uuidv7();
const memberA = uuidv7();
const invoiceId = uuidv7();
// A second invoice, so the keyed case does not depend on what the cases
// before it wrote.
const keyedInvoiceId = uuidv7();
const userId = asUserId(randomUUID());

beforeAll(async () => {
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Action Gate Club', 'active', $3)",
    [tenantId, `action-${RUN}`, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Site A', true)",
    [locationA, tenantId],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name, phone, date_of_birth) values ($1, $2, 'Gate Member', $3, '1990-01-01')",
    [personA, tenantId, `+9198${PHONE_RUN}5001`],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status, joined_on) values ($1, $2, $3, $4, $5, 'active', current_date - 200)",
    [memberA, tenantId, personA, locationA, `GATE-${RUN}`],
  );
  await admin.query(
    `insert into invoices (id, tenant_id, location_id, member_id, invoice_number,
       financial_year, issued_on, due_on, subtotal_paise, tax_paise, total_paise,
       paid_paise, status)
     values ($1, $2, $3, $4, $5, '2026-27', $6, $6, 10000, 0, 10000, 0, 'issued'),
            ($7, $2, $3, $4, $8, '2026-27', $6, $6, 10000, 0, 10000, 0, 'issued')`,
    [
      invoiceId,
      tenantId,
      locationA,
      memberA,
      `AGT${RUN}1`.slice(0, 16),
      todayInZone(TZ),
      keyedInvoiceId,
      `AGT${RUN}2`.slice(0, 16),
    ],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    userId,
    `+9198${PHONE_RUN}9001`,
  ]);
  holder.ctx = {
    tenantId,
    userId,
    roleKey: "receptionist",
    allLocations: true,
    locationIds: [],
    permissions: new Set([
      "payments.record",
      "payments.refund",
      "payments.read",
      "invoices.read",
    ]),
    // payments.record / payments.refund live in the billing module, so
    // the tenant must have that entitlement for the real permission gate
    // to pass.
    features: new Set(["billing"]),
  };
}, 120_000);

afterAll(async () => {
  await deleteAuditRowsForTenant(admin, tenantId);
  await admin.query("delete from payment_reversals where tenant_id = $1", [
    tenantId,
  ]);
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
  await admin.query("delete from users where phone like $1", [
    `+9198${PHONE_RUN}%`,
  ]);
  await admin.end();
}, 120_000);

async function paymentRows(forInvoiceId: string) {
  const result = await admin.query(
    "select id, amount_paise from payments where tenant_id = $1 and invoice_id = $2 order by created_at",
    [tenantId, forInvoiceId],
  );
  return result.rows as { id: string; amount_paise: string }[];
}

async function reversalRows(paymentId: string) {
  const result = await admin.query(
    "select id, amount_paise from payment_reversals where tenant_id = $1 and payment_id = $2",
    [tenantId, paymentId],
  );
  return result.rows as { id: string; amount_paise: string }[];
}

describe("F01 — the public action boundary refuses a request without an operation key", () => {
  it("refuses a public payment request without a key and writes nothing", async () => {
    const refused = await recordPaymentAction({
      invoiceId,
      amountPaise: 5000,
      method: "cash",
    });

    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error).toMatch(
      /one-time key|refresh/i,
    );
    expect(await paymentRows(invoiceId)).toHaveLength(0);
    const audits = await admin.query(
      "select id from audit_log where tenant_id = $1 and action = 'payment.record'",
      [tenantId],
    );
    expect(audits.rows).toHaveLength(0);
  }, 60_000);

  it("refuses a public reversal request without a key and writes nothing", async () => {
    // A captured payment to reverse (recorded through the service with a
    // key — the service is a trusted internal caller).
    const payment = await recordPayment(
      {
        tenantId,
        userId,
        roleKey: "receptionist",
        allLocations: true,
        locationIds: [],
        permissions: new Set(["payments.record"]),
      },
      {
        invoiceId,
        amountPaise: 1000,
        method: "cash",
        idempotencyKey: randomUUID(),
      },
    );
    expect(payment.ok).toBe(true);
    if (!payment.ok) return;

    const refused = await reversePaymentAction({
      paymentId: payment.id,
      amountPaise: 300,
      reason: "Wrong entry",
    });

    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error).toMatch(
      /one-time key|refresh/i,
    );
    expect(await reversalRows(payment.id)).toHaveLength(0);
    const audits = await admin.query(
      "select id from audit_log where tenant_id = $1 and action = 'payment.reverse'",
      [tenantId],
    );
    expect(audits.rows).toHaveLength(0);
  }, 60_000);

  it("records a keyed public request once, and its retry once", async () => {
    const payload = {
      invoiceId: keyedInvoiceId,
      amountPaise: 5000,
      method: "cash",
      idempotencyKey: randomUUID(),
      observedIntentId: null,
    };
    const before = (await paymentRows(keyedInvoiceId)).length;

    const first = await recordPaymentAction(payload);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const retry = await recordPaymentAction(payload);
    expect(retry.ok).toBe(true);

    // ONE EFFECT for two attempts of the same operation.
    const after = await paymentRows(keyedInvoiceId);
    expect(after.length).toBe(before + 1);
    expect(after.filter((row) => row.id === first.id)).toHaveLength(1);
  }, 60_000);
});
