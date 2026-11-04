// @vitest-environment node
//
// F01 durable-intent hardening — agent-owned regressions for the M-03 / M-04
// approval packet (owner: money-hardening lane, 2026-10-30).
//
// Two hardening properties are still PROPOSAL ONLY, so this file measures the
// CURRENT behaviour of the real application role:
//
//   M-03  deleting a financial target (invoice / payment / location) must not
//          erase durable intent history. Today the intent FKs are
//          ON DELETE CASCADE, so the target delete removes the intent row
//          and bypasses the DELETE revoke on payment_intents.
//   M-04  the committed marker, the payload fingerprint, the observed-intent
//          chain and the identity columns must be frozen; only the two real
//          producers may write prepared -> committed|cancelled. Today the app
//          role holds table-wide UPDATE and there is no trigger.
//
// Runtime path: every app-role statement goes through the application's own
// `withTenant` (db/client.ts connects as `app_login`, switches to `app_user`
// and sets the tenant scope). The privileged connection is used ONLY for
// synthetic fixture setup and for assertions.
//
// Expected results today: N1..N5b and P6b FAIL (the hardening is absent),
// P1..P6a PASS and must keep passing after the approved migration is applied.
// No RED is reconstructed by reversion: these are real, current failures.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import { todayInZone } from "@/lib/time/tz";
import { withTenant } from "@/db/tenant";
import { recordPayment } from "@/lib/services/payments";
import { preparePaymentIntent } from "@/lib/services/payment-intents";
import { paymentIntentFingerprint } from "@/lib/services/payment-intent-core";
import { cancelPaymentIntent } from "@/lib/services/payment-intent-recovery";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";

const TZ = "Asia/Kolkata";
const RUN = Date.now().toString(36);
const PHONE_RUN = String(Date.now() % 100_000_000).padStart(8, "0");

const tenantId: TenantId = asTenantId(uuidv7());
const teardownTenantId: TenantId = asTenantId(uuidv7());

const mainLocation = uuidv7();
const probeLocation = uuidv7();
const personId = uuidv7();
const memberId = uuidv7();
const userId = asUserId(randomUUID());

const invInvoiceDelete = uuidv7();
const invPrepUpdate = uuidv7();
const invCommitUpdate = uuidv7();
const invChainUpdate = uuidv7();
const invCommit = uuidv7();
const invCancel = uuidv7();
const invRawTransition = uuidv7();
const invLocationDelete = uuidv7();
const invPaymentDelete = uuidv7();
const invReversalDelete = uuidv7();

const payReversal = uuidv7();
const payNoIntent = uuidv7();

const teardownLocation = uuidv7();
const teardownPerson = uuidv7();
const teardownMember = uuidv7();
const teardownInvoice = uuidv7();
const teardownInvoice2 = uuidv7();
const teardownInvoice3 = uuidv7();
const teardownPayment = uuidv7();

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

function errorCode(error: unknown): string | undefined {
  let cursor: unknown = error;
  for (let i = 0; i < 6 && cursor && typeof cursor === "object"; i += 1) {
    const code = (cursor as { code?: unknown }).code;
    if (typeof code === "string") return code;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return undefined;
}

function fingerprintFor(invoiceId: string) {
  return paymentIntentFingerprint({
    kind: "payment",
    invoiceId,
    amountPaise: 1000,
    method: "cash",
    reference: null,
  });
}

async function prepareOn(invoiceId: string) {
  const key = randomUUID();
  const prepared = await preparePaymentIntent(ctx, {
    invoiceId,
    idempotencyKey: key,
    fingerprint: fingerprintFor(invoiceId),
    observedIntentId: null,
  });
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) throw new Error(prepared.error);
  return { key, intentId: prepared.intent.id };
}

async function intentRows(intentId: string) {
  const result = await admin.query(
    "select id, state, result_id, payload_fingerprint, observation_kind, observed_intent_id from payment_intents where id = $1 and tenant_id = $2",
    [intentId, tenantId],
  );
  return result.rows as Array<{
    id: string;
    state: string;
    result_id: string | null;
    payload_fingerprint: string;
    observation_kind: string;
    observed_intent_id: string | null;
  }>;
}

async function intentExists(intentId: string): Promise<boolean> {
  return (await intentRows(intentId)).length === 1;
}

async function paymentCount(invoiceId: string): Promise<number> {
  const result = await admin.query(
    "select count(*)::int as n from payments where tenant_id = $1 and invoice_id = $2",
    [tenantId, invoiceId],
  );
  return Number((result.rows[0] as { n: number }).n);
}

async function intentIdFor(invoiceId: string, state?: string) {
  const result = await admin.query(
    "select id from payment_intents where tenant_id = $1 and invoice_id = $2 and state = coalesce($3, state)",
    [tenantId, invoiceId, state ?? null],
  );
  return result.rows[0].id as string;
}

// The app role's own statement path (app_login -> app_user + tenant scope).
async function appSql(statement: SQL) {
  return withTenant(tenantId, async (tx) => {
    await tx.execute(statement);
  });
}

async function appSqlError(statement: SQL) {
  try {
    await appSql(statement);
    return undefined;
  } catch (error) {
    return error;
  }
}

beforeAll(async () => {
  for (const [id, slug] of [
    [tenantId, `mh-hardening-${RUN}`],
    [teardownTenantId, `mh-teardown-${RUN}`],
  ] as const) {
    await admin.query(
      "insert into tenants (id, slug, name, status, timezone) values ($1, $2, $3, 'active', $4)",
      [id, slug, `Money Hardening ${RUN}`, TZ],
    );
  }
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true), ($3, $2, 'Probe', false)",
    [mainLocation, tenantId, probeLocation],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Teardown', true)",
    [teardownLocation, teardownTenantId],
  );
  await admin.query(
    "insert into config_values (id, key, scope_type, scope_id, tenant_id, value) values ($1, 'access.location_scoped_staff', 'tenant', $2::text, $2::uuid, 'true')",
    [randomUUID(), tenantId],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name, phone, date_of_birth) values ($1, $2, 'Hardening Member', $3, '1990-01-01')",
    [personId, tenantId, `+9198${PHONE_RUN}71`],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status, joined_on) values ($1, $2, $3, $4, $5, 'active', current_date - 200)",
    [memberId, tenantId, personId, mainLocation, `MH-${RUN}`.slice(0, 16)],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name, phone, date_of_birth) values ($1, $2, 'Teardown Member', $3, '1990-01-01')",
    [teardownPerson, teardownTenantId, `+9198${PHONE_RUN}72`],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status, joined_on) values ($1, $2, $3, $4, $5, 'active', current_date - 200)",
    [teardownMember, teardownTenantId, teardownPerson, teardownLocation, `MT-${RUN}`.slice(0, 16)],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    userId,
    `+9198${PHONE_RUN}73`,
  ]);

  const today = todayInZone(TZ);
  const invoiceIds = [
    invInvoiceDelete,
    invPrepUpdate,
    invCommitUpdate,
    invChainUpdate,
    invCommit,
    invCancel,
    invRawTransition,
    invLocationDelete,
    invPaymentDelete,
    invReversalDelete,
  ];
  for (const [index, invoiceId] of invoiceIds.entries()) {
    await admin.query(
      `insert into invoices (id, tenant_id, location_id, member_id, invoice_number,
         financial_year, issued_on, due_on, subtotal_paise, tax_paise, total_paise,
         paid_paise, status)
       values ($1, $2, $3, $4, $5, '2026-27', $6, $6, 10000, 0, 10000, 0, 'issued')`,
      [
        invoiceId,
        tenantId,
        mainLocation,
        memberId,
        `MH${RUN}${index}`.slice(0, 16),
        today,
      ],
    );
  }
  await admin.query(
    `insert into invoices (id, tenant_id, location_id, member_id, invoice_number,
       financial_year, issued_on, due_on, subtotal_paise, tax_paise, total_paise,
       paid_paise, status)
     values ($1, $2, $3, $4, $5, '2026-27', $6, $6, 10000, 0, 10000, 0, 'issued')`,
    [
      teardownInvoice,
      teardownTenantId,
      teardownLocation,
      teardownMember,
      `MT${RUN}0`.slice(0, 16),
      today,
    ],
  );
  await admin.query(
    `insert into invoices (id, tenant_id, location_id, member_id, invoice_number,
       financial_year, issued_on, due_on, subtotal_paise, tax_paise, total_paise,
       paid_paise, status)
     values ($1, $2, $3, $4, $5, '2026-27', $6, $6, 10000, 0, 10000, 0, 'issued')`,
    [
      teardownInvoice2,
      teardownTenantId,
      teardownLocation,
      teardownMember,
      `MT${RUN}1`.slice(0, 16),
      today,
    ],
  );
  await admin.query(
    `insert into invoices (id, tenant_id, location_id, member_id, invoice_number,
       financial_year, issued_on, due_on, subtotal_paise, tax_paise, total_paise,
       paid_paise, status)
     values ($1, $2, $3, $4, $5, '2026-27', $6, $6, 10000, 0, 10000, 0, 'issued')`,
    [
      teardownInvoice3,
      teardownTenantId,
      teardownLocation,
      teardownMember,
      `MT${RUN}2`.slice(0, 16),
      today,
    ],
  );
  for (const [id, invoiceId] of [
    [payReversal, invReversalDelete],
    [payNoIntent, invPaymentDelete],
  ] as const) {
    await admin.query(
      `insert into payments (id, tenant_id, invoice_id, member_id, location_id,
         amount_paise, method, channel, status, received_at)
       values ($1, $2, $3, $4, $5, 1000, 'cash', 'counter', 'captured', now())`,
      [id, tenantId, invoiceId, memberId, mainLocation],
    );
  }
  await admin.query(
    `insert into payments (id, tenant_id, invoice_id, member_id, location_id,
       amount_paise, method, channel, status, received_at)
     values ($1, $2, $3, $4, $5, 1000, 'cash', 'counter', 'captured', now())`,
    [
      teardownPayment,
      teardownTenantId,
      teardownInvoice,
      teardownMember,
      teardownLocation,
    ],
  );
}, 120_000);

afterAll(async () => {
  for (const id of [tenantId, teardownTenantId]) {
    await deleteAuditRowsForTenant(admin, id);
    await admin.query("delete from payment_intents where tenant_id = $1", [id]);
    await admin.query("delete from payments where tenant_id = $1", [id]);
    await admin.query("delete from invoices where tenant_id = $1", [id]);
    await admin.query("delete from members where tenant_id = $1", [id]);
    await admin.query("delete from persons where tenant_id = $1", [id]);
    await admin.query("delete from config_values where tenant_id = $1", [id]);
    await admin.query("delete from locations where tenant_id = $1", [id]);
    await admin.query("delete from tenants where id = $1", [id]);
  }
  await admin.query("delete from users where id = $1", [userId]);
  await admin.end();
}, 120_000);

describe("F01 hardening M-03 — a target delete must not erase durable intent", () => {
  it("N1 refuses an app-role invoice delete while an intent references it", async () => {
    const { intentId } = await prepareOn(invInvoiceDelete);
    const error = await appSqlError(
      sql`delete from invoices where id = ${invInvoiceDelete} and tenant_id = ${tenantId}`,
    );
    expect(error, "the delete must be refused").toBeDefined();
    expect(errorCode(error)).toBe("23503");
    expect(await intentExists(intentId), "the intent must survive").toBe(true);
  }, 60_000);

  it("N2 refuses an app-role payment delete while an intent references it", async () => {
    const intentId = uuidv7();
    await admin.query(
      `insert into payment_intents
         (id, tenant_id, actor_id, kind, idempotency_key, payment_id, location_id,
          payload_fingerprint, observation_kind, observed_intent_id, state,
          created_by, updated_by)
       values ($1, $2, $3, 'reversal', $4, $5, $6, $7, 'none', null, 'prepared', $3, $3)`,
      [
        intentId,
        tenantId,
        userId,
        randomUUID(),
        payReversal,
        mainLocation,
        "b".repeat(64),
      ],
    );
    const error = await appSqlError(
      sql`delete from payments where id = ${payReversal} and tenant_id = ${tenantId}`,
    );
    expect(error, "the delete must be refused").toBeDefined();
    expect(errorCode(error)).toBe("23503");
    expect(await intentExists(intentId), "the intent must survive").toBe(true);
  }, 60_000);

  it("N3 refuses an app-role location delete while an intent references it", async () => {
    const intentId = uuidv7();
    await admin.query(
      `insert into payment_intents
         (id, tenant_id, actor_id, kind, idempotency_key, invoice_id, location_id,
          payload_fingerprint, observation_kind, observed_intent_id, state,
          created_by, updated_by)
       values ($1, $2, $3, 'payment', $4, $5, $6, $7, 'none', null, 'prepared', $3, $3)`,
      [
        intentId,
        tenantId,
        userId,
        randomUUID(),
        invLocationDelete,
        probeLocation,
        "c".repeat(64),
      ],
    );
    const error = await appSqlError(
      sql`delete from locations where id = ${probeLocation} and tenant_id = ${tenantId}`,
    );
    expect(error, "the delete must be refused").toBeDefined();
    expect(errorCode(error)).toBe("23503");
    expect(await intentExists(intentId), "the intent must survive").toBe(true);
  }, 60_000);
});

describe("F01 hardening M-04 — the marker, payload, chain and identity are frozen", () => {
  it("N4 refuses an app-role payload rewrite on a committed intent", async () => {
    const committed = await recordPayment(ctx, {
      invoiceId: invCommitUpdate,
      amountPaise: 1000,
      method: "cash",
      idempotencyKey: randomUUID(),
      observedIntentId: null,
    });
    expect(committed.ok).toBe(true);
    const intentId = await intentIdFor(invCommitUpdate, "committed");
    const error = await appSqlError(
      sql`update payment_intents set payload_fingerprint = ${"a".repeat(64)} where id = ${intentId} and tenant_id = ${tenantId}`,
    );
    expect(error, "the rewrite must be refused").toBeDefined();
    expect(errorCode(error)).toBe("23514");
    expect((await intentRows(intentId))[0].payload_fingerprint).toBe(
      fingerprintFor(invCommitUpdate),
    );
  }, 60_000);

  it("N5 refuses an app-role payload rewrite on a prepared intent", async () => {
    const { intentId } = await prepareOn(invPrepUpdate);
    const error = await appSqlError(
      sql`update payment_intents set payload_fingerprint = ${"d".repeat(64)} where id = ${intentId} and tenant_id = ${tenantId}`,
    );
    expect(error, "the rewrite must be refused").toBeDefined();
    expect(errorCode(error)).toBe("23514");
    expect((await intentRows(intentId))[0].payload_fingerprint).toBe(
      fingerprintFor(invPrepUpdate),
    );
  }, 60_000);

  it("N5b refuses an app-role rewrite of the observed-intent chain", async () => {
    const committed = await recordPayment(ctx, {
      invoiceId: invChainUpdate,
      amountPaise: 1000,
      method: "cash",
      idempotencyKey: randomUUID(),
      observedIntentId: null,
    });
    expect(committed.ok).toBe(true);
    const intentId = await intentIdFor(invChainUpdate, "committed");
    const error = await appSqlError(
      sql`update payment_intents set observation_kind = 'committed', observed_intent_id = ${randomUUID()} where id = ${intentId} and tenant_id = ${tenantId}`,
    );
    expect(error, "the rewrite must be refused").toBeDefined();
    expect(errorCode(error)).toBe("23514");
    const row = (await intentRows(intentId))[0];
    expect(row.observation_kind).toBe("none");
    expect(row.observed_intent_id).toBeNull();
  }, 60_000);
});

describe("F01 hardening — the legitimate transitions and the surrounding boundary stay intact", () => {
  it("P1 still commits prepared -> committed through the real producer", async () => {
    const { key } = await prepareOn(invCommit);
    const committed = await recordPayment(ctx, {
      invoiceId: invCommit,
      amountPaise: 1000,
      method: "cash",
      idempotencyKey: key,
      observedIntentId: null,
    });
    expect(committed.ok).toBe(true);
    expect(await paymentCount(invCommit)).toBe(1);
    const intentId = await intentIdFor(invCommit);
    const row = (await intentRows(intentId))[0];
    expect(row.state).toBe("committed");
    expect(row.result_id).toBeTruthy();
  }, 60_000);

  it("P2 still cancels prepared -> cancelled through the real producer", async () => {
    const { intentId } = await prepareOn(invCancel);
    const cancelled = await cancelPaymentIntent(ctx, "payment", intentId);
    expect(cancelled.ok).toBe(true);
    expect((await intentRows(intentId))[0].state).toBe("cancelled");
    expect(await paymentCount(invCancel)).toBe(0);
  }, 60_000);

  it("P3 allows the legitimate prepared -> committed transition an app producer writes", async () => {
    const { intentId } = await prepareOn(invRawTransition);
    const resultId = randomUUID();
    await appSql(
      sql`update payment_intents set state = 'committed', result_id = ${resultId}, committed_at = now(), updated_at = now(), updated_by = ${userId} where id = ${intentId} and tenant_id = ${tenantId} and state = 'prepared'`,
    );
    const row = (await intentRows(intentId))[0];
    expect(row.state).toBe("committed");
    expect(row.result_id).toBe(resultId);
  }, 60_000);

  it("P4 still allows an app-role delete of a target with no intent", async () => {
    await appSql(
      sql`delete from payments where id = ${payNoIntent} and tenant_id = ${tenantId}`,
    );
    const left = await admin.query(
      "select count(*)::int as n from payments where id = $1",
      [payNoIntent],
    );
    expect(Number(left.rows[0].n)).toBe(0);
  }, 60_000);

  it("P5 still denies an app-role delete of an intent row", async () => {
    const { intentId } = await prepareOn(invReversalDelete);
    const error = await appSqlError(
      sql`delete from payment_intents where id = ${intentId} and tenant_id = ${tenantId}`,
    );
    expect(error).toBeDefined();
    expect(errorCode(error)).toBe("42501");
    expect(await intentExists(intentId)).toBe(true);
  }, 60_000);
});

describe("F01 hardening — the existing privileged tenant teardown still works", () => {
  it("P7 refuses a DIRECT privileged delete of the whole tenant, with no partial cascade", async () => {
    // Baseline of the EXISTING tenant-deletion policy, measured before any
    // hardening: a single privileged `delete from tenants` is REFUSED today
    // (23503, locations_tenant_id_fkey is a NO ACTION child of tenants) and
    // the whole statement rolls back — the tenant row and every child row
    // survive. After the hardening this must stay exactly as it is: still
    // refused, still no partial cascade, nothing deleted. The reported
    // constraint may differ; the outcome class may not.
    const intentId = uuidv7();
    await admin.query(
      `insert into payment_intents
         (id, tenant_id, actor_id, kind, idempotency_key, invoice_id, location_id,
          payload_fingerprint, observation_kind, observed_intent_id, state,
          created_by, updated_by)
       values ($1, $2, $3, 'payment', $4, $5, $6, $7, 'none', null, 'prepared', $3, $3)`,
      [
        intentId,
        teardownTenantId,
        userId,
        randomUUID(),
        teardownInvoice2,
        teardownLocation,
        "a".repeat(64),
      ],
    );

    let error: unknown;
    try {
      await admin.query("delete from tenants where id = $1", [teardownTenantId]);
    } catch (caught) {
      error = caught;
    }
    expect(error, "the direct tenant delete must be refused").toBeDefined();
    expect(errorCode(error)).toBe("23503");

    const expected = {
      tenants: 1,
      payment_intents: 1,
      payments: 1,
      invoices: 3,
      members: 1,
      persons: 1,
      locations: 1,
    };
    for (const [table, count] of Object.entries(expected)) {
      const left = await admin.query(
        `select count(*)::int as n from ${table} where ${table === "tenants" ? "id = $1" : "tenant_id = $1"}`,
        [teardownTenantId],
      );
      expect(Number(left.rows[0].n), `${table} must survive`).toBe(count);
    }
  }, 60_000);

  it("P6b refuses a privileged target delete while an intent references it", async () => {
    const intentId = uuidv7();
    await admin.query(
      `insert into payment_intents
         (id, tenant_id, actor_id, kind, idempotency_key, payment_id, location_id,
          payload_fingerprint, observation_kind, observed_intent_id, state,
          created_by, updated_by)
       values ($1, $2, $3, 'reversal', $4, $5, $6, $7, 'none', null, 'prepared', $3, $3)`,
      [
        intentId,
        teardownTenantId,
        userId,
        randomUUID(),
        teardownPayment,
        teardownLocation,
        "f".repeat(64),
      ],
    );
    let error: unknown;
    try {
      await admin.query("delete from payments where id = $1 and tenant_id = $2", [
        teardownPayment,
        teardownTenantId,
      ]);
    } catch (caught) {
      error = caught;
    }
    expect(error, "the privileged delete must be refused too").toBeDefined();
    expect(errorCode(error)).toBe("23503");
    const rows = await admin.query(
      "select count(*)::int as n from payment_intents where id = $1",
      [intentId],
    );
    expect(Number(rows.rows[0].n), "the intent must survive").toBe(1);
  }, 60_000);

  it("P6a tears a whole tenant down in the existing order", async () => {
    const intentId = uuidv7();
    await admin.query(
      `insert into payment_intents
         (id, tenant_id, actor_id, kind, idempotency_key, invoice_id, location_id,
          payload_fingerprint, observation_kind, observed_intent_id, state,
          created_by, updated_by)
       values ($1, $2, $3, 'payment', $4, $5, $6, $7, 'none', null, 'prepared', $3, $3)`,
      [
        intentId,
        teardownTenantId,
        userId,
        randomUUID(),
        teardownInvoice3,
        teardownLocation,
        "e".repeat(64),
      ],
    );

    // The order the repository already uses: intents, payments, invoices,
    // members, persons, config, locations, tenant.
    await admin.query("delete from payment_intents where tenant_id = $1", [
      teardownTenantId,
    ]);
    await admin.query("delete from payments where tenant_id = $1", [
      teardownTenantId,
    ]);
    await admin.query("delete from invoices where tenant_id = $1", [
      teardownTenantId,
    ]);
    await admin.query("delete from members where tenant_id = $1", [
      teardownTenantId,
    ]);
    await admin.query("delete from persons where tenant_id = $1", [
      teardownTenantId,
    ]);
    await admin.query("delete from locations where tenant_id = $1", [
      teardownTenantId,
    ]);
    await admin.query("delete from tenants where id = $1", [teardownTenantId]);

    for (const table of [
      "payment_intents",
      "payments",
      "invoices",
      "members",
      "persons",
      "locations",
    ]) {
      const left = await admin.query(
        `select count(*)::int as n from ${table} where tenant_id = $1`,
        [teardownTenantId],
      );
      expect(Number(left.rows[0].n), `${table} must be empty`).toBe(0);
    }
    const tenant = await admin.query(
      "select count(*)::int as n from tenants where id = $1",
      [teardownTenantId],
    );
    expect(Number(tenant.rows[0].n)).toBe(0);
  }, 60_000);
});
