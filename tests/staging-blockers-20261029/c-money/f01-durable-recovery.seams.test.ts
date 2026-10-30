// @vitest-environment node
//
// F01 durable recovery — new-seam acceptance cases added after the
// approved core patch. These exercise the prepared-intent row directly
// (commit/discard race, revoked location scope and missing actor
// context) and the app-role privilege boundary (DELETE denied, UPDATE
// allowed). They are not claimed as pre-edit RED; the existing-writer
// RED is in f01-durable-recovery.pre-edit-red.test.ts.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import { todayInZone } from "@/lib/time/tz";
import { withTenant } from "@/db/tenant";
import { recordPayment } from "@/lib/services/payments";
import { preparePaymentIntent } from "@/lib/services/payment-intents";
import { paymentIntentFingerprint } from "@/lib/services/payment-intent-core";
import { cancelPaymentIntent, listPaymentIntentRecovery } from "@/lib/services/payment-intent-recovery";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";

const TZ = "Asia/Kolkata";
const RUN = Date.now().toString(36);
const PHONE_RUN = String(Date.now() % 100_000_000).padStart(8, "0");

const tenantId: TenantId = asTenantId(uuidv7());
const mainLocation = uuidv7();
const otherLocation = uuidv7();
const personId = uuidv7();
const memberId = uuidv7();
const userId = asUserId(randomUUID());
const raceInvoiceId = uuidv7();
const revokedLocationInvoiceId = uuidv7();
const missingActorInvoiceId = uuidv7();
const privilegeInvoiceId = uuidv7();
const closedRecoveryInvoiceId = uuidv7();
const revokedRecoveryInvoiceId = uuidv7();
const uncheckedCallInvoiceId = uuidv7();
const ambiguousChainInvoiceId = uuidv7();
const cycleChainInvoiceId = uuidv7();
const ambiguousPreparedInvoiceId = uuidv7();

const broadCtx = {
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
const restrictedCtx = {
  ...broadCtx,
  allLocations: false,
  locationIds: [otherLocation],
};

function paymentPayload(invoiceId: string) {
  return {
    kind: "payment" as const,
    invoiceId,
    amountPaise: 1000,
    method: "cash",
    reference: null,
  };
}

function fingerprintFor(invoiceId: string) {
  return paymentIntentFingerprint(paymentPayload(invoiceId));
}

async function prepare(invoiceId: string, key = randomUUID()) {
  const prepared = await preparePaymentIntent(broadCtx, {
    invoiceId,
    idempotencyKey: key,
    fingerprint: fingerprintFor(invoiceId),
    observedIntentId: null,
  });
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) throw new Error(prepared.error);
  return { key, intentId: prepared.intent.id };
}

async function paymentRows(invoiceId: string) {
  const result = await admin.query(
    "select id, amount_paise from payments where tenant_id = $1 and invoice_id = $2",
    [tenantId, invoiceId],
  );
  return result.rows as { id: string; amount_paise: string }[];
}

async function intentRow(intentId: string) {
  const result = await admin.query(
    "select state, result_id, idempotency_key from payment_intents where tenant_id = $1 and id = $2",
    [tenantId, intentId],
  );
  return result.rows[0] as
    | { state: string; result_id: string | null; idempotency_key: string }
    | undefined;
}

function errorCode(error: unknown): string | undefined {
  let cursor: unknown = error;
  for (let i = 0; i < 5 && cursor && typeof cursor === "object"; i += 1) {
    const code = (cursor as { code?: unknown }).code;
    if (typeof code === "string") return code;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return undefined;
}

async function insertCommittedIntent(input: {
  invoiceId: string;
  id?: string;
  observationKind?: "unchecked" | "none" | "committed";
  observedIntentId?: string | null;
}) {
  const id = input.id ?? uuidv7();
  await admin.query(
    `insert into payment_intents
       (id, tenant_id, actor_id, kind, idempotency_key, invoice_id, location_id,
        payload_fingerprint, observation_kind, observed_intent_id, state,
        result_id, committed_at, created_by, updated_by)
     values ($1, $2, $3, 'payment', $4, $5, $6, $7, $8, $9, 'committed', $10, now(), $3, $3)`,
    [
      id,
      tenantId,
      userId,
      randomUUID(),
      input.invoiceId,
      mainLocation,
      fingerprintFor(input.invoiceId),
      input.observationKind ?? "none",
      input.observedIntentId ?? null,
      randomUUID(),
    ],
  );
  return id;
}

beforeAll(async () => {
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Durable Seam Club', 'active', $3)",
    [tenantId, `durable-seam-${RUN}`, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true), ($3, $2, 'Other', false)",
    [mainLocation, tenantId, otherLocation],
  );
  await admin.query(
    "insert into config_values (id, key, scope_type, scope_id, tenant_id, value) values ($1, 'access.location_scoped_staff', 'tenant', $2::text, $2::uuid, 'true')",
    [randomUUID(), tenantId],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name, phone, date_of_birth) values ($1, $2, 'Durable Member', $3, '1990-01-01')",
    [personId, tenantId, `+9198${PHONE_RUN}51`],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status, joined_on) values ($1, $2, $3, $4, $5, 'active', current_date - 200)",
    [memberId, tenantId, personId, mainLocation, `DS-${RUN}`.slice(0, 16)],
  );
  const today = todayInZone(TZ);
  const invoiceIds = [
    raceInvoiceId,
    revokedLocationInvoiceId,
    missingActorInvoiceId,
    privilegeInvoiceId,
    closedRecoveryInvoiceId,
    revokedRecoveryInvoiceId,
    uncheckedCallInvoiceId,
    ambiguousChainInvoiceId,
    cycleChainInvoiceId,
    ambiguousPreparedInvoiceId,
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
        `DS${RUN}${index}`.slice(0, 16),
        today,
      ],
    );
  }
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    userId,
    `+9198${PHONE_RUN}52`,
  ]);
}, 120_000);

afterAll(async () => {
  await deleteAuditRowsForTenant(admin, tenantId);
  await admin.query("delete from payment_intents where tenant_id = $1", [
    tenantId,
  ]);
  await admin.query("delete from payments where tenant_id = $1", [tenantId]);
  await admin.query("delete from invoices where tenant_id = $1", [tenantId]);
  await admin.query("delete from members where tenant_id = $1", [tenantId]);
  await admin.query("delete from persons where tenant_id = $1", [tenantId]);
  await admin.query("delete from config_values where tenant_id = $1", [
    tenantId,
  ]);
  await admin.query("delete from locations where tenant_id = $1", [tenantId]);
  await admin.query("delete from tenants where id = $1", [tenantId]);
  await admin.query("delete from users where id = $1", [userId]);
  await admin.end();
}, 120_000);

describe("F01 durable recovery — commit/discard and scope", () => {
  it("commits or discards a prepared attempt exactly once", async () => {
    const { key, intentId } = await prepare(raceInvoiceId);
    const [commit, discard] = await Promise.all([
      recordPayment(broadCtx, {
        invoiceId: raceInvoiceId,
        amountPaise: 1000,
        method: "cash",
        idempotencyKey: key,
        observedIntentId: null,
      }),
      cancelPaymentIntent(broadCtx, "payment", intentId),
    ]);

    expect(
      Number(commit.ok) + Number(discard.ok),
      "exactly one side may win",
    ).toBe(1);

    const rows = await paymentRows(raceInvoiceId);
    const state = await intentRow(intentId);
    expect(state).toBeTruthy();
    if (rows.length === 1) {
      expect(commit.ok).toBe(true);
      expect(discard.ok).toBe(false);
      expect(state!.state).toBe("committed");
      expect(state!.result_id).toBe(rows[0].id);
      expect(state!.idempotency_key).toBe(key);
    } else {
      expect(rows).toHaveLength(0);
      expect(commit.ok).toBe(false);
      expect(discard.ok).toBe(true);
      expect(state!.state).toBe("cancelled");
      expect(state!.result_id).toBeNull();
    }
  }, 60_000);

  it("refuses a commit after the actor's location scope is revoked, leaving the intent prepared", async () => {
    const { key, intentId } = await prepare(revokedLocationInvoiceId);
    const commit = await recordPayment(restrictedCtx, {
      invoiceId: revokedLocationInvoiceId,
      amountPaise: 1000,
      method: "cash",
      idempotencyKey: key,
      observedIntentId: null,
    });

    expect(commit.ok).toBe(false);
    expect(commit.ok === false ? commit.error : "").toMatch(/not found/i);
    expect(await paymentRows(revokedLocationInvoiceId)).toHaveLength(0);
    expect((await intentRow(intentId))!.state).toBe("prepared");
  }, 60_000);

  it("refuses a commit with a missing authenticated context, leaving the intent prepared", async () => {
    // Missing actor context, NOT a mid-flight session revocation. The
    // public action's current-session check is the authority; the service
    // does not claim to revalidate a session after that check.
    const { key, intentId } = await prepare(missingActorInvoiceId);
    const commit = await recordPayment(
      { ...broadCtx, userId: undefined },
      {
        invoiceId: missingActorInvoiceId,
        amountPaise: 1000,
        method: "cash",
        idempotencyKey: key,
        observedIntentId: null,
      },
    );

    expect(commit.ok).toBe(false);
    expect(commit.ok === false ? commit.error : "").toMatch(/authenticated/i);
    expect(await paymentRows(missingActorInvoiceId)).toHaveLength(0);
    expect((await intentRow(intentId))!.state).toBe("prepared");
  }, 60_000);

  it("denies DELETE and allows the producer's prepared -> committed marker", async () => {
    const { intentId } = await prepare(privilegeInvoiceId);

    let deleteError: unknown;
    try {
      await withTenant(tenantId, async (tx) => {
        await tx.execute(
          sql`delete from payment_intents where id = ${intentId}`,
        );
      });
    } catch (error) {
      deleteError = error;
    }
    expect(errorCode(deleteError)).toBe("42501");
    expect((await intentRow(intentId))!.state).toBe("prepared");

    // The app role may write exactly ONE legitimate marker transition —
    // prepared -> committed — with the same columns markIntentCommitted
    // writes (state, result_id, committed_at, updated_at, updated_by). A
    // raw audit-only UPDATE of a prepared row is not a producer behaviour
    // and is not asserted here any more.
    const resultId = randomUUID();
    await withTenant(tenantId, async (tx) => {
      await tx.execute(
        sql`update payment_intents
              set state = 'committed',
                  result_id = ${resultId},
                  committed_at = now(),
                  updated_at = now(),
                  updated_by = ${userId}
            where id = ${intentId} and tenant_id = ${tenantId} and state = 'prepared'`,
      );
    });
    const row = (await intentRow(intentId))!;
    expect(row.state).toBe("committed");
    expect(row.result_id).toBe(resultId);
  }, 60_000);

  it("offers a bounded discard for a prepared intent on a closed invoice", async () => {
    const { intentId } = await prepare(closedRecoveryInvoiceId);
    await admin.query(
      "update invoices set status = 'paid', paid_paise = total_paise where tenant_id = $1 and id = $2",
      [tenantId, closedRecoveryInvoiceId],
    );

    const recovery = await listPaymentIntentRecovery(
      broadCtx,
      "payment",
      closedRecoveryInvoiceId,
    );
    expect(recovery.open?.intentId).toBe(intentId);
    expect(recovery.lastCommitted).toBeNull();

    const cancel = await cancelPaymentIntent(
      broadCtx,
      "payment",
      intentId,
    );
    expect(cancel.ok).toBe(true);
    expect((await intentRow(intentId))!.state).toBe("cancelled");
    expect(await paymentRows(closedRecoveryInvoiceId)).toHaveLength(0);
  }, 60_000);

  it("does not expose or cancel a prepared intent when the location scope is revoked", async () => {
    const { intentId } = await prepare(revokedRecoveryInvoiceId);

    const recovery = await listPaymentIntentRecovery(
      restrictedCtx,
      "payment",
      revokedRecoveryInvoiceId,
    );
    expect(recovery).toEqual({ open: null, lastCommitted: null });

    const cancel = await cancelPaymentIntent(
      restrictedCtx,
      "payment",
      intentId,
    );
    expect(cancel.ok).toBe(false);
    expect((await intentRow(intentId))!.state).toBe("prepared");
  }, 60_000);

  it("refuses a keyed service call without a validated observation after a commit", async () => {
    const first = await recordPayment(broadCtx, {
      invoiceId: uncheckedCallInvoiceId,
      amountPaise: 1000,
      method: "cash",
      idempotencyKey: randomUUID(),
      observedIntentId: null,
    });
    expect(first.ok).toBe(true);

    // A trusted keyed caller may no longer omit the observation: omission
    // is treated as "the caller saw no committed intent" and validated
    // against the chain, so this is refused instead of forking a second
    // tip.
    const second = await recordPayment(broadCtx, {
      invoiceId: uncheckedCallInvoiceId,
      amountPaise: 1000,
      method: "cash",
      idempotencyKey: randomUUID(),
    });
    expect(second.ok).toBe(false);
    expect(second.ok === false ? second.conflict : undefined).toBe(
      "stale_observation",
    );
    expect(await paymentRows(uncheckedCallInvoiceId)).toHaveLength(1);
  }, 60_000);

  it("surfaces a two-tip committed fork as ambiguous and refuses a new key", async () => {
    await insertCommittedIntent({ invoiceId: ambiguousChainInvoiceId });
    await insertCommittedIntent({ invoiceId: ambiguousChainInvoiceId });

    const recovery = await listPaymentIntentRecovery(
      broadCtx,
      "payment",
      ambiguousChainInvoiceId,
    );
    expect(recovery.ambiguous).toBe(true);
    expect(recovery.open).toBeNull();
    expect(recovery.lastCommitted).toBeNull();

    const refused = await recordPayment(broadCtx, {
      invoiceId: ambiguousChainInvoiceId,
      amountPaise: 1000,
      method: "cash",
      idempotencyKey: randomUUID(),
      observedIntentId: null,
    });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false ? refused.conflict : undefined).toBe(
      "stale_observation",
    );
    expect(await paymentRows(ambiguousChainInvoiceId)).toHaveLength(0);
  }, 60_000);

  it("fails a zero-tip cycle closed as ambiguous and refuses a new key", async () => {
    const first = uuidv7();
    const second = uuidv7();
    await insertCommittedIntent({
      invoiceId: cycleChainInvoiceId,
      id: first,
      observationKind: "committed",
      observedIntentId: second,
    });
    await insertCommittedIntent({
      invoiceId: cycleChainInvoiceId,
      id: second,
      observationKind: "committed",
      observedIntentId: first,
    });

    const recovery = await listPaymentIntentRecovery(
      broadCtx,
      "payment",
      cycleChainInvoiceId,
    );
    expect(recovery.ambiguous).toBe(true);
    expect(recovery.lastCommitted).toBeNull();

    const refused = await recordPayment(broadCtx, {
      invoiceId: cycleChainInvoiceId,
      amountPaise: 1000,
      method: "cash",
      idempotencyKey: randomUUID(),
      observedIntentId: null,
    });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false ? refused.conflict : undefined).toBe(
      "stale_observation",
    );
    expect(await paymentRows(cycleChainInvoiceId)).toHaveLength(0);
  }, 60_000);

  it("fails a prepared commit closed when the chain became ambiguous", async () => {
    const { key, intentId } = await prepare(ambiguousPreparedInvoiceId);
    await insertCommittedIntent({ invoiceId: ambiguousPreparedInvoiceId });
    await insertCommittedIntent({ invoiceId: ambiguousPreparedInvoiceId });

    const commit = await recordPayment(broadCtx, {
      invoiceId: ambiguousPreparedInvoiceId,
      amountPaise: 1000,
      method: "cash",
      idempotencyKey: key,
      observedIntentId: null,
    });
    expect(commit.ok).toBe(false);
    expect(commit.ok === false ? commit.conflict : undefined).toBe(
      "stale_observation",
    );
    expect(await paymentRows(ambiguousPreparedInvoiceId)).toHaveLength(0);
    expect((await intentRow(intentId))!.state).toBe("prepared");
  }, 60_000);
});
