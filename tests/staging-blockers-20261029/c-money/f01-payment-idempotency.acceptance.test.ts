// @vitest-environment node
//
// Staging blocker F01 — durable operation idempotency for a counter
// payment and a partial reversal.
//
// ACCEPTANCE REGRESSION — EXPECTED RED until the F01 change is approved
// and applied.
//
// This file states the contract the F01 proposal defines
// (docs/audits/staging-blockers-20261029/c-money/proposals/f01-idempotency-proposal.md):
// ONE operation, ONE effect. It is not a reproduction of today's bug and
// it is not a gate that must stay green before the decision: every case
// below asserts the behaviour the counter needs, so today it fails.
//
// The cases are ordered deliberately. The DURABLE, FINANCIAL assertion
// comes first in every case — the payment/reversal rows, the invoice
// balance and the audit rows written exactly once — and only then the
// replay metadata (the same id back, the `replayed` flag, the response
// shape). A missing response field is not the evidence; the money moving
// twice is.
//
//   - a retried cash payment      -> one payment, one payment.record
//     financial audit row and one payment outbox; the prepare transaction
//     also writes payment_intent.prepare; the invoice moves once;
//   - CONCURRENT retries           -> one effect;
//   - a repeated PARTIAL reversal  -> one reversal, one payment.reverse
//     financial audit row and NO outbox (reversals do not enqueue a member
//     notification); the invoice gives the money up once;
//   - the same key with a DIFFERENT payload -> refused, no second
//     operation, and the refusal leaks nothing;
//   - two DISTINCT operations with the same amount -> two legitimate
//     payments (equal amounts are real money; no amount/time heuristic);
//   - SCOPES: the key is tenant-scoped (the same key in another tenant is
//     another operation) and a caller outside the invoice's location
//     scope is refused without leaking anything.
//
// The operation key is passed through the service boundary as
// `idempotencyKey`. The service input is parsed by Zod, so until the
// proposed change lands the key is stripped and ignored — which is
// exactly why the file is RED today and green after the approved change.
//
// Fixture setup and cleanup run through the privileged pool
// (tests/db/privileged-fixture.ts); every count is read back from the
// database and every write goes through the application's own services
// over the app_login connection.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import { todayInZone } from "@/lib/time/tz";
import { recordPayment } from "@/lib/services/payments";
import { reversePayment } from "@/lib/services/payment-reversals";
import { listPaymentIntentRecovery } from "@/lib/services/payment-intent-recovery";
import { voidInvoice } from "@/lib/services/invoice-mutations";
import { getInvoice } from "@/lib/services/invoices";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";

const TZ = "Asia/Kolkata";
const RUN = Date.now().toString(36);
// Phone numbers must be E.164 digits only — the contact resolver drops
// a number with a letter in it, so the run marker is numeric.
const PHONE_RUN = String(Date.now() % 100_000_000).padStart(8, "0");

type Seeded = {
  tenantId: TenantId;
  locationA: string;
  locationB: string;
  personId: string;
  memberId: string;
};

const home: Seeded = {
  tenantId: asTenantId(uuidv7()),
  locationA: uuidv7(),
  locationB: uuidv7(),
  personId: uuidv7(),
  memberId: uuidv7(),
};

const neighbour: Seeded = {
  tenantId: asTenantId(uuidv7()),
  locationA: uuidv7(),
  locationB: uuidv7(),
  personId: uuidv7(),
  memberId: uuidv7(),
};

const seeded: Seeded[] = [home, neighbour];

// One invoice per behaviour, so no case can be moved by another one.
const invoice = {
  retry: uuidv7(),
  distinct: uuidv7(),
  concurrent: uuidv7(),
  reversal: uuidv7(),
  response: uuidv7(),
  payload: uuidv7(),
  shared: uuidv7(),
  other: uuidv7(),
  scope: uuidv7(),
  late: uuidv7(),
  lateVoid: uuidv7(),
  reference: uuidv7(),
  reason: uuidv7(),
  race: uuidv7(),
  raceSecond: uuidv7(),
  raceReversalA: uuidv7(),
  raceReversalB: uuidv7(),
  neighbour: uuidv7(),
};

// The operation key is the opaque UUID the UI mints, and the service
// validates that shape: a key is not a readable string a caller could
// guess. The key is tenant-scoped, so the same key in another tenant is
// another operation, never a collision.
const KEY = {
  retry: randomUUID(),
  concurrent: randomUUID(),
  payload: randomUUID(),
  distinctA: randomUUID(),
  distinctB: randomUUID(),
  shared: randomUUID(),
  scope: randomUUID(),
  reversal: randomUUID(),
  response: randomUUID(),
  responseOther: randomUUID(),
  reference: randomUUID(),
  reason: randomUUID(),
  late: randomUUID(),
  lateReversal: randomUUID(),
  lateVoid: randomUUID(),
  lateVoidReversal: randomUUID(),
};
const SHARED_KEY = KEY.shared;

type Ctx = {
  tenantId: TenantId;
  userId: ReturnType<typeof asUserId>;
  roleKey: string;
  allLocations: boolean;
  locationIds: string[];
  permissions: Set<string>;
};

const PAYMENTS_PERMISSIONS = [
  "payments.record",
  "payments.read",
  "payments.refund",
  "invoices.read",
  "invoices.write",
];

let phoneCounter = 0;
let personCounter = 0;

async function makeUser(): Promise<ReturnType<typeof asUserId>> {
  phoneCounter += 1;
  const id = asUserId(randomUUID());
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    id,
    `+9198${PHONE_RUN}${String(phoneCounter).padStart(3, "0")}`,
  ]);
  return id;
}

async function makeCtx(
  s: Seeded,
  shape: {
    roleKey: string;
    allLocations: boolean;
    locationIds: string[];
    extraPermissions?: string[];
  },
): Promise<Ctx> {
  return {
    tenantId: s.tenantId,
    userId: await makeUser(),
    roleKey: shape.roleKey,
    allLocations: shape.allLocations,
    locationIds: shape.locationIds,
    permissions: new Set([
      ...PAYMENTS_PERMISSIONS,
      ...(shape.extraPermissions ?? []),
    ]),
  };
}

async function seedTenant(
  s: Seeded,
  slug: string,
  invoiceIds: { id: string; totalPaise: number; tag: string }[],
): Promise<void> {
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, $3, 'active', $4)",
    [s.tenantId, `${slug}-${RUN}`, slug, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $3, 'Site A', true), ($2, $3, 'Site B', false)",
    [s.locationA, s.locationB, s.tenantId],
  );
  // An adult member with a reachable number: the payment notification
  // is enqueued for exactly one contact, so the "one notification"
  // assertion is a real count and not an empty one.
  personCounter += 1;
  await admin.query(
    "insert into persons (id, tenant_id, full_name, phone, date_of_birth) values ($1, $2, $3, $4, '1990-01-01')",
    [
      s.personId,
      s.tenantId,
      `${slug} Member`,
      `+9198${PHONE_RUN}7${String(personCounter).padStart(2, "0")}`,
    ],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status, joined_on) values ($1, $2, $3, $4, $5, 'active', current_date - 200)",
    [s.memberId, s.tenantId, s.personId, s.locationA, `${slug.slice(0, 3).toUpperCase()}-${RUN}`],
  );
  const today = todayInZone(TZ);
  for (const row of invoiceIds) {
    await admin.query(
      `insert into invoices (id, tenant_id, location_id, member_id, invoice_number,
         financial_year, issued_on, due_on, subtotal_paise, tax_paise, total_paise,
         paid_paise, status)
       values ($1, $2, $3, $4, $5, '2026-27', $6, $6, $7, 0, $7, 0, 'issued')`,
      [
        row.id,
        s.tenantId,
        s.locationA,
        s.memberId,
        `IDM${RUN}${row.tag}`.slice(0, 16),
        today,
        row.totalPaise,
      ],
    );
  }
}

let counter: Ctx;
let restricted: Ctx;
let neighbourCounter: Ctx;
let owner: Ctx;

beforeAll(async () => {
  await seedTenant(home, "idem-home", [
    { id: invoice.retry, totalPaise: 10000, tag: "A" },
    { id: invoice.distinct, totalPaise: 20000, tag: "B" },
    { id: invoice.concurrent, totalPaise: 10000, tag: "C" },
    { id: invoice.reversal, totalPaise: 10000, tag: "D" },
    { id: invoice.response, totalPaise: 10000, tag: "E" },
    { id: invoice.payload, totalPaise: 10000, tag: "F" },
    { id: invoice.shared, totalPaise: 10000, tag: "G" },
    { id: invoice.other, totalPaise: 10000, tag: "H" },
    { id: invoice.scope, totalPaise: 10000, tag: "I" },
    { id: invoice.late, totalPaise: 10000, tag: "J" },
    { id: invoice.lateVoid, totalPaise: 10000, tag: "K" },
    { id: invoice.reference, totalPaise: 10000, tag: "M" },
    { id: invoice.reason, totalPaise: 10000, tag: "N" },
    { id: invoice.race, totalPaise: 10000, tag: "O" },
    { id: invoice.raceSecond, totalPaise: 10000, tag: "P" },
    { id: invoice.raceReversalA, totalPaise: 10000, tag: "Q" },
    { id: invoice.raceReversalB, totalPaise: 10000, tag: "R" },
  ]);
  await seedTenant(neighbour, "idem-next", [
    { id: invoice.neighbour, totalPaise: 10000, tag: "L" },
  ]);
  // Location scoping ON in the home tenant, so the restricted caller is
  // really outside the invoice's location (the tenant-wide default is
  // unrestricted and would hide that boundary).
  await admin.query(
    "insert into config_values (id, key, scope_type, scope_id, tenant_id, value) values ($1, 'access.location_scoped_staff', 'tenant', $2::text, $2::uuid, 'true')",
    [randomUUID(), home.tenantId],
  );
  counter = await makeCtx(home, {
    roleKey: "receptionist",
    allLocations: true,
    locationIds: [],
  });
  restricted = await makeCtx(home, {
    roleKey: "admin",
    allLocations: false,
    locationIds: [home.locationB],
  });
  neighbourCounter = await makeCtx(neighbour, {
    roleKey: "receptionist",
    allLocations: true,
    locationIds: [],
  });
  // The invoice void is management authority (settings.manage) — the
  // late-retry case needs it to change the invoice's state after the
  // money was given back.
  owner = await makeCtx(home, {
    roleKey: "owner",
    allLocations: true,
    locationIds: [],
    extraPermissions: ["settings.manage"],
  });
}, 120_000);

beforeEach(async () => {
  // The outbox is per member, not per invoice: each case must see its own
  // notification(s), not the previous case's. The payment/audit rows stay
  // per invoice and are asserted directly.
  for (const s of seeded) {
    await admin.query(
      "delete from whatsapp_notification_outbox where tenant_id = $1",
      [s.tenantId],
    );
  }
});

afterAll(async () => {
  for (const s of seeded) {
    await deleteAuditRowsForTenant(admin, s.tenantId);
    await admin.query(
      "delete from whatsapp_notification_outbox where tenant_id = $1",
      [s.tenantId],
    );
    await admin.query("delete from payment_reversals where tenant_id = $1", [
      s.tenantId,
    ]);
    // F01 hardening (M-03): the durable intent rows reference the
    // financial targets, so they are removed BEFORE the targets, in
    // the same order the production teardown uses.
    await admin.query("delete from payment_intents where tenant_id = $1", [
      s.tenantId,
    ]);
    await admin.query("delete from payments where tenant_id = $1", [s.tenantId]);
    await admin.query("delete from invoices where tenant_id = $1", [s.tenantId]);
    await admin.query("delete from members where tenant_id = $1", [s.tenantId]);
    await admin.query("delete from persons where tenant_id = $1", [s.tenantId]);
    await admin.query("delete from locations where tenant_id = $1", [s.tenantId]);
    await admin.query("delete from config_values where tenant_id = $1", [
      s.tenantId,
    ]);
    await admin.query("delete from tenants where id = $1", [s.tenantId]);
  }
  await admin.query("delete from users where phone like $1", [
    `+9198${PHONE_RUN}%`,
  ]);
  await admin.end();
}, 120_000);

// The intended result shape. The cast is a TYPE-level statement of the
// contract; every id, count and refusal below is read back from the
// database, never from a mock.
type Outcome = {
  ok: boolean;
  id?: string;
  invoiceStatus?: string;
  replayed?: boolean;
  error?: string;
  // F01 — the machine-readable reason a request was refused.
  conflict?: "payload_mismatch" | "already_recorded";
};

function outcome(result: unknown): Outcome {
  return result as Outcome;
}

async function paymentRows(tenantId: TenantId, invoiceId: string) {
  const result = await admin.query(
    "select id, amount_paise, method, reference, invoice_id from payments where tenant_id = $1 and invoice_id = $2 order by created_at",
    [tenantId, invoiceId],
  );
  return result.rows as {
    id: string;
    amount_paise: string;
    method: string;
    reference: string | null;
    invoice_id: string | null;
  }[];
}

async function auditRows(
  tenantId: TenantId,
  action: string,
  entityId: string,
): Promise<string[]> {
  const result = await admin.query(
    "select id from audit_log where tenant_id = $1 and action = $2 and entity_id = $3",
    [tenantId, action, entityId],
  );
  return (result.rows as { id: string }[]).map((row) => row.id);
}

async function outboxRows(tenantId: TenantId, memberId: string) {
  const result = await admin.query(
    "select id, event_key from whatsapp_notification_outbox where tenant_id = $1 and member_id = $2 order by created_at",
    [tenantId, memberId],
  );
  return result.rows as { id: string; event_key: string }[];
}

describe("F01 — one operation, one effect (payment)", () => {
  it("applies a retried cash payment once and returns the same payment", async () => {
    const payload = {
      invoiceId: invoice.retry,
      amountPaise: 5000,
      method: "cash",
      idempotencyKey: KEY.retry,
    };

    const first = outcome(await recordPayment(counter, payload));
    expect(first.ok).toBe(true);
    expect(first.id).toBeTruthy();

    // The first attempt is one payment, one financial audit row, one payment outbox.
    expect(await paymentRows(home.tenantId, invoice.retry)).toHaveLength(1);
    expect(
      await auditRows(home.tenantId, "payment.record", first.id!),
    ).toHaveLength(1);
    expect(await outboxRows(home.tenantId, home.memberId)).toHaveLength(1);

    // The retry: the same operation, sent again.
    const retry = outcome(await recordPayment(counter, payload));
    expect(retry.ok).toBe(true);

    // ONE EFFECT: one payment row, one financial audit row, one payment outbox.
    expect(await paymentRows(home.tenantId, invoice.retry)).toHaveLength(1);
    expect(
      await auditRows(home.tenantId, "payment.record", first.id!),
    ).toHaveLength(1);
    expect(await outboxRows(home.tenantId, home.memberId)).toHaveLength(1);

    // THE INVOICE MOVED ONCE, NOT TWICE.
    const read = await getInvoice(counter, invoice.retry);
    expect(read!.paidPaise).toBe(5000);
    expect(read!.status).toBe("partial");

    // The replay metadata, once the money is proven to be right.
    expect(retry.id).toBe(first.id);
    expect(retry.replayed).toBe(true);
    expect(retry.invoiceStatus).toBe(first.invoiceStatus);
  }, 60_000);

  it("applies concurrent retries of one operation once", async () => {
    const payload = {
      invoiceId: invoice.concurrent,
      amountPaise: 5000,
      method: "cash",
      idempotencyKey: KEY.concurrent,
    };

    const results = await Promise.all([
      recordPayment(counter, payload),
      recordPayment(counter, payload),
      recordPayment(counter, payload),
    ]);
    const outcomes = results.map(outcome);

    // ONE EFFECT for three concurrent retries of one operation.
    expect(await paymentRows(home.tenantId, invoice.concurrent)).toHaveLength(1);
    const read = await getInvoice(counter, invoice.concurrent);
    expect(read!.paidPaise).toBe(5000);
    expect(read!.status).toBe("partial");

    const paymentId = outcomes.find((result) => result.id)?.id;
    expect(paymentId).toBeTruthy();
    expect(
      await auditRows(home.tenantId, "payment.record", paymentId!),
    ).toHaveLength(1);
    expect(await outboxRows(home.tenantId, home.memberId)).toHaveLength(1);

    // The replay metadata, once the money is proven to be right.
    for (const result of outcomes) {
      expect(result.ok).toBe(true);
      expect(result.id).toBe(paymentId);
    }
    expect(outcomes.filter((result) => result.replayed === false)).toHaveLength(1);
    expect(outcomes.filter((result) => result.replayed === true)).toHaveLength(2);
  }, 60_000);

  it("refuses the same key with a different payload and writes nothing", async () => {
    const first = outcome(
      await recordPayment(counter, {
        invoiceId: invoice.payload,
        amountPaise: 4000,
        method: "cash",
        idempotencyKey: KEY.payload,
      }),
    );
    expect(first.ok).toBe(true);
    expect(await paymentRows(home.tenantId, invoice.payload)).toHaveLength(1);

    // The same key, a DIFFERENT amount: the key is the identity of the
    // operation, so this is not a second operation.
    const mismatch = outcome(
      await recordPayment(counter, {
        invoiceId: invoice.payload,
        amountPaise: 3000,
        method: "cash",
        idempotencyKey: KEY.payload,
      }),
    );
    expect(mismatch.ok).toBe(false);

    // NO SECOND OPERATION: one row, one financial audit row, and the invoice moved
    // once.
    const rows = await paymentRows(home.tenantId, invoice.payload);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount_paise)).toBe(4000);
    expect(
      await auditRows(home.tenantId, "payment.record", first.id!),
    ).toHaveLength(1);
    const read = await getInvoice(counter, invoice.payload);
    expect(read!.paidPaise).toBe(4000);

    // The refusal says the key is taken and leaks nothing about the
    // operation it names.
    expect(mismatch.error).toMatch(/already recorded/i);
    expect(mismatch.error).not.toContain("4000");
    expect(mismatch.error).not.toContain(first.id!);
  }, 60_000);

  it("records two distinct operations of the same amount as two payments", async () => {
    const first = outcome(
      await recordPayment(counter, {
        invoiceId: invoice.distinct,
        amountPaise: 5000,
        method: "cash",
        idempotencyKey: KEY.distinctA,
        observedIntentId: null,
      }),
    );
    // The second legitimate operation observed the first one on the
    // recovery read. It must carry that observation so the chain keeps a
    // single tip; a new key from an unchecked snapshot is refused.
    const firstRecovery = await listPaymentIntentRecovery(
      counter,
      "payment",
      invoice.distinct,
    );
    expect(firstRecovery.lastCommitted?.intentId).toBeTruthy();
    const second = outcome(
      await recordPayment(counter, {
        invoiceId: invoice.distinct,
        amountPaise: 5000,
        method: "cash",
        idempotencyKey: KEY.distinctB,
        observedIntentId: firstRecovery.lastCommitted!.intentId,
      }),
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    // Two legitimate payments of the same amount — real money, never
    // deduplicated by amount, method or time.
    const rows = await paymentRows(home.tenantId, invoice.distinct);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => Number(row.amount_paise))).toEqual([5000, 5000]);
    expect(rows.every((row) => row.reference === null)).toBe(true);
    expect(first.id).not.toBe(second.id);

    const read = await getInvoice(counter, invoice.distinct);
    expect(read!.paidPaise).toBe(10000);
    expect(read!.status).toBe("partial");
  }, 60_000);
});

describe("F01 — scopes", () => {
  it("keeps the operation key inside its tenant", async () => {
    // The same key in two tenants: two independent operations.
    const homeOperation = outcome(
      await recordPayment(counter, {
        invoiceId: invoice.shared,
        amountPaise: 5000,
        method: "cash",
        idempotencyKey: SHARED_KEY,
      }),
    );
    const neighbourOperation = outcome(
      await recordPayment(neighbourCounter, {
        invoiceId: invoice.neighbour,
        amountPaise: 5000,
        method: "cash",
        idempotencyKey: SHARED_KEY,
      }),
    );
    expect(homeOperation.ok).toBe(true);
    expect(neighbourOperation.ok).toBe(true);

    // ONE OPERATION PER TENANT: the key does not collide across tenants.
    const homeRows = await paymentRows(home.tenantId, invoice.shared);
    const neighbourRows = await paymentRows(
      neighbour.tenantId,
      invoice.neighbour,
    );
    expect(homeRows).toHaveLength(1);
    expect(neighbourRows).toHaveLength(1);
    expect(homeRows[0].id).not.toBe(neighbourRows[0].id);

    // The neighbour's retry is the neighbour's own operation: one row.
    const retry = outcome(
      await recordPayment(neighbourCounter, {
        invoiceId: invoice.neighbour,
        amountPaise: 5000,
        method: "cash",
        idempotencyKey: SHARED_KEY,
      }),
    );
    expect(retry.ok).toBe(true);
    expect(await paymentRows(neighbour.tenantId, invoice.neighbour)).toHaveLength(
      1,
    );
    const neighbourRead = await getInvoice(neighbourCounter, invoice.neighbour);
    expect(neighbourRead!.paidPaise).toBe(5000);

    // The replay metadata, once the money is proven to be right.
    expect(retry.id).toBe(neighbourOperation.id);
    expect(retry.replayed).toBe(true);
  }, 60_000);

  it("refuses an out-of-scope caller without leaking the stored operation", async () => {
    const refused = outcome(
      await recordPayment(restricted, {
        invoiceId: invoice.scope,
        amountPaise: 5000,
        method: "cash",
        idempotencyKey: KEY.scope,
      }),
    );
    expect(refused.ok).toBe(false);
    expect(refused.error).toBe("Invoice not found.");

    // Nothing was written for the refused caller.
    expect(await paymentRows(home.tenantId, invoice.scope)).toHaveLength(0);

    // The refusal says nothing about the operation the key names, and
    // names no other operation of this tenant either.
    const stored = await admin.query(
      "select id from payments where tenant_id = $1",
      [home.tenantId],
    );
    for (const row of stored.rows as { id: string }[]) {
      expect(refused.error).not.toContain(row.id);
    }
    expect(JSON.stringify(refused)).not.toContain("f01-pay-scope");
  }, 60_000);
});

describe("F01 — one operation, one effect (reversal)", () => {
  it("applies a retried partial reversal once", async () => {
    const payment = outcome(
      await recordPayment(counter, {
        invoiceId: invoice.reversal,
        amountPaise: 1000,
        method: "cash",
      }),
    );
    expect(payment.ok).toBe(true);

    const payload = {
      paymentId: payment.id!,
      amountPaise: 300,
      reason: "Wrong entry",
      idempotencyKey: KEY.reversal,
    };

    const first = outcome(await reversePayment(counter, payload));
    expect(first.ok).toBe(true);

    const retry = outcome(await reversePayment(counter, payload));
    expect(retry.ok).toBe(true);

    // ONE REVERSAL for one operation.
    const reversals = await admin.query(
      "select id, amount_paise from payment_reversals where tenant_id = $1 and payment_id = $2",
      [home.tenantId, payment.id],
    );
    expect(reversals.rows).toHaveLength(1);
    expect(Number((reversals.rows as { amount_paise: string }[])[0].amount_paise)).toBe(
      300,
    );
    expect(
      await auditRows(home.tenantId, "payment.reverse", payment.id!),
    ).toHaveLength(1);

    // THE INVOICE GAVE THE MONEY UP ONCE, NOT TWICE.
    const read = await getInvoice(counter, invoice.reversal);
    expect(read!.paidPaise).toBe(700);

    // The replay metadata, once the money is proven to be right.
    expect(retry.id).toBe(first.id);
    expect(retry.replayed).toBe(true);
  }, 60_000);
});

describe("F01 — the COMPLETE payload decides whether it is the same operation", () => {
  it("refuses the same key with a different payment reference", async () => {
    const first = outcome(
      await recordPayment(counter, {
        invoiceId: invoice.reference,
        amountPaise: 5000,
        method: "upi",
        reference: "UTR-111111",
        idempotencyKey: KEY.reference,
      }),
    );
    expect(first.ok).toBe(true);
    expect(await paymentRows(home.tenantId, invoice.reference)).toHaveLength(1);

    // The same key, a DIFFERENT reference: the key is the identity of
    // the request, and the request changed — so this is not a retry.
    const mismatch = outcome(
      await recordPayment(counter, {
        invoiceId: invoice.reference,
        amountPaise: 5000,
        method: "upi",
        reference: "UTR-222222",
        idempotencyKey: KEY.reference,
      }),
    );
    expect(mismatch.ok).toBe(false);
    // The refusal says WHY, machine-readably: this operation committed
    // earlier with a different payload. The client must keep its
    // reconciliation key for it.
    expect(mismatch.conflict).toBe("payload_mismatch");

    // NO SECOND OPERATION: one row, one financial audit row, one payment outbox,
    // and the invoice moved once.
    const rows = await paymentRows(home.tenantId, invoice.reference);
    expect(rows).toHaveLength(1);
    expect(rows[0].reference).toBe("UTR-111111");
    expect(
      await auditRows(home.tenantId, "payment.record", first.id!),
    ).toHaveLength(1);
    expect(await outboxRows(home.tenantId, home.memberId)).toHaveLength(1);
    const read = await getInvoice(counter, invoice.reference);
    expect(read!.paidPaise).toBe(5000);

    // The refusal says the key is taken and leaks nothing about the
    // operation it names.
    expect(mismatch.error).toMatch(/already recorded/i);
    expect(mismatch.error).not.toContain("UTR-111111");
    expect(mismatch.error).not.toContain("UTR-222222");
    expect(mismatch.error).not.toContain(first.id!);
  }, 60_000);

  it("refuses the same key with a different reversal reason", async () => {
    const payment = outcome(
      await recordPayment(counter, {
        invoiceId: invoice.reason,
        amountPaise: 1000,
        method: "cash",
        idempotencyKey: randomUUID(),
      }),
    );
    expect(payment.ok).toBe(true);
    if (!payment.ok) return;

    const first = outcome(
      await reversePayment(counter, {
        paymentId: payment.id!,
        amountPaise: 300,
        reason: "Wrong entry",
        idempotencyKey: KEY.reason,
      }),
    );
    expect(first.ok).toBe(true);

    // The same key, a DIFFERENT reason: the request changed, so this is
    // not a retry.
    const mismatch = outcome(
      await reversePayment(counter, {
        paymentId: payment.id!,
        amountPaise: 300,
        reason: "Different reason",
        idempotencyKey: KEY.reason,
      }),
    );
    expect(mismatch.ok).toBe(false);
    expect(mismatch.conflict).toBe("payload_mismatch");

    // NO SECOND REVERSAL: one row, one financial audit row (no outbox), and the invoice gave
    // the money up once.
    const reversals = await admin.query(
      "select id, amount_paise, reason from payment_reversals where tenant_id = $1 and payment_id = $2",
      [home.tenantId, payment.id],
    );
    expect(reversals.rows).toHaveLength(1);
    expect(
      (reversals.rows as { reason: string }[])[0].reason,
    ).toBe("Wrong entry");
    expect(
      await auditRows(home.tenantId, "payment.reverse", payment.id!),
    ).toHaveLength(1);
    const read = await getInvoice(counter, invoice.reason);
    expect(read!.paidPaise).toBe(700);

    // The refusal leaks nothing about the operation it names.
    expect(mismatch.error).toMatch(/already recorded/i);
    expect(mismatch.error).not.toContain("Wrong entry");
    expect(mismatch.error).not.toContain("Different reason");
  }, 60_000);
});

describe("F01 — the index conflict is distinguishable from a payload mismatch", () => {
  it("answers the unique-index race with its own conflict kind", async () => {
    // Two DIFFERENT invoices, one key: the invoice locks cannot
    // serialise them, so the partial unique index is the backstop. The
    // loser must be told WHICH answer it got — "already_recorded" (the
    // key was consumed) is not "payload_mismatch" (this operation
    // committed with a different payload).
    const key = randomUUID();
    const [first, second] = await Promise.all([
      recordPayment(counter, {
        invoiceId: invoice.race,
        amountPaise: 5000,
        method: "cash",
        idempotencyKey: key,
      }),
      recordPayment(counter, {
        invoiceId: invoice.raceSecond,
        amountPaise: 5000,
        method: "cash",
        idempotencyKey: key,
      }),
    ]);
    const outcomes = [outcome(first), outcome(second)];
    const ok = outcomes.filter((result) => result.ok);
    const refused = outcomes.filter((result) => !result.ok);
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].conflict).toBe("already_recorded");
    expect(refused[0].conflict).not.toBe("payload_mismatch");

    // The loser wrote nothing of its own: ONE payment across the two
    // invoices, not two.
    const rows = [
      ...(await paymentRows(home.tenantId, invoice.race)),
      ...(await paymentRows(home.tenantId, invoice.raceSecond)),
    ];
    expect(rows).toHaveLength(1);
  }, 60_000);

  it("answers the reversal's unique-index race with its own conflict kind", async () => {
    const paymentA = outcome(
      await recordPayment(counter, {
        invoiceId: invoice.raceReversalA,
        amountPaise: 1000,
        method: "cash",
        idempotencyKey: randomUUID(),
      }),
    );
    const paymentB = outcome(
      await recordPayment(counter, {
        invoiceId: invoice.raceReversalB,
        amountPaise: 1000,
        method: "cash",
        idempotencyKey: randomUUID(),
      }),
    );
    expect(paymentA.ok).toBe(true);
    expect(paymentB.ok).toBe(true);
    if (!paymentA.ok || !paymentB.ok) return;

    // Two DIFFERENT payments, one key: the reversal's own index is the
    // backstop, and the answer names that index's conflict — not a
    // generic "something unique failed".
    const key = randomUUID();
    const [first, second] = await Promise.all([
      reversePayment(counter, {
        paymentId: paymentA.id!,
        amountPaise: 300,
        reason: "Wrong entry",
        idempotencyKey: key,
      }),
      reversePayment(counter, {
        paymentId: paymentB.id!,
        amountPaise: 300,
        reason: "Wrong entry",
        idempotencyKey: key,
      }),
    ]);
    const outcomes = [outcome(first), outcome(second)];
    const ok = outcomes.filter((result) => result.ok);
    const refused = outcomes.filter((result) => !result.ok);
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].conflict).toBe("already_recorded");

    // One reversal was written, not two.
    const reversals = await admin.query(
      "select id from payment_reversals where tenant_id = $1 and payment_id = any($2::uuid[])",
      [home.tenantId, [paymentA.id, paymentB.id]],
    );
    expect(reversals.rows).toHaveLength(1);
  }, 60_000);
});

describe("F01 — a late retry after the money or the invoice changed", () => {
  it("replays a payment whose money was fully reversed, without writing again", async () => {
    const payload = {
      invoiceId: invoice.late,
      amountPaise: 5000,
      method: "cash",
      idempotencyKey: KEY.late,
    };
    const first = outcome(await recordPayment(counter, payload));
    expect(first.ok).toBe(true);

    // The money goes back: the invoice is left with nothing paid.
    const reversal = outcome(
      await reversePayment(counter, {
        paymentId: first.id!,
        amountPaise: 5000,
        reason: "Wrong entry",
        idempotencyKey: KEY.lateReversal,
      }),
    );
    expect(reversal.ok).toBe(true);
    const afterReversal = await getInvoice(counter, invoice.late);
    expect(afterReversal!.paidPaise).toBe(0);
    expect(afterReversal!.status).toBe("issued");

    // The desk retries the SAME payment after the reversal.
    const retry = outcome(await recordPayment(counter, payload));

    // NOTHING WAS WRITTEN: one payment row, one financial audit row, and the
    // invoice still holds nothing.
    expect(await paymentRows(home.tenantId, invoice.late)).toHaveLength(1);
    expect(
      await auditRows(home.tenantId, "payment.record", first.id!),
    ).toHaveLength(1);
    const read = await getInvoice(counter, invoice.late);
    expect(read!.paidPaise).toBe(0);
    expect(read!.status).toBe("issued");

    // The replay is the same operation, and it reports the invoice's
    // CURRENT state — not "partial", which would be false now.
    expect(retry.ok).toBe(true);
    expect(retry.id).toBe(first.id);
    expect(retry.replayed).toBe(true);
    expect(retry.invoiceStatus).toBe("issued");
  }, 60_000);

  it("replays a payment whose invoice was voided, without writing again", async () => {
    const payload = {
      invoiceId: invoice.lateVoid,
      amountPaise: 5000,
      method: "cash",
      idempotencyKey: KEY.lateVoid,
    };
    const first = outcome(await recordPayment(counter, payload));
    expect(first.ok).toBe(true);

    const reversal = outcome(
      await reversePayment(counter, {
        paymentId: first.id!,
        amountPaise: 5000,
        reason: "Wrong entry",
        idempotencyKey: KEY.lateVoidReversal,
      }),
    );
    expect(reversal.ok).toBe(true);

    const voided = await voidInvoice(owner, invoice.lateVoid, "Duplicate raise");
    expect(voided.ok).toBe(true);

    // The desk retries the SAME payment after the invoice was voided.
    const retry = outcome(await recordPayment(counter, payload));

    // NOTHING WAS WRITTEN: one payment row, one financial audit row, and the
    // invoice is still void with nothing paid.
    expect(await paymentRows(home.tenantId, invoice.lateVoid)).toHaveLength(1);
    expect(
      await auditRows(home.tenantId, "payment.record", first.id!),
    ).toHaveLength(1);
    const read = await getInvoice(counter, invoice.lateVoid);
    expect(read!.paidPaise).toBe(0);
    expect(read!.status).toBe("void");

    // The replay is the same operation, and it reports the invoice's
    // CURRENT state — "void", not "partial".
    expect(retry.ok).toBe(true);
    expect(retry.id).toBe(first.id);
    expect(retry.replayed).toBe(true);
    expect(retry.invoiceStatus).toBe("void");
  }, 60_000);
});

describe("F01 — the replayed response", () => {
  it("returns the operation's own result and nothing else", async () => {
    const first = outcome(
      await recordPayment(counter, {
        invoiceId: invoice.response,
        amountPaise: 5000,
        method: "cash",
        idempotencyKey: KEY.response,
      }),
    );
    expect(first.ok).toBe(true);

    // A different operation, in another invoice — its id must not leak
    // into the replayed answer.
    const other = outcome(
      await recordPayment(counter, {
        invoiceId: invoice.other,
        amountPaise: 1000,
        method: "cash",
        idempotencyKey: KEY.responseOther,
      }),
    );
    expect(other.ok).toBe(true);
    expect(other.id).not.toBe(first.id);

    const replay = outcome(
      await recordPayment(counter, {
        invoiceId: invoice.response,
        amountPaise: 5000,
        method: "cash",
        idempotencyKey: KEY.response,
      }),
    );
    expect(replay.ok).toBe(true);

    // ONE EFFECT and the money moved once.
    expect(await paymentRows(home.tenantId, invoice.response)).toHaveLength(1);
    expect(
      await auditRows(home.tenantId, "payment.record", first.id!),
    ).toHaveLength(1);
    const read = await getInvoice(counter, invoice.response);
    expect(read!.paidPaise).toBe(5000);

    // The replay metadata, once the money is proven to be right.
    expect(replay.id).toBe(first.id);
    expect(replay.replayed).toBe(true);
    expect(first.replayed).toBe(false);
    expect(Object.keys(first).sort()).toEqual([
      "id",
      "invoiceStatus",
      "ok",
      "replayed",
    ]);
    expect(Object.keys(replay).sort()).toEqual([
      "id",
      "invoiceStatus",
      "ok",
      "replayed",
    ]);
    expect(JSON.stringify(replay)).not.toContain(other.id);
  }, 60_000);
});
