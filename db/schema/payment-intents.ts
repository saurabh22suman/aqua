import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns } from "./_shared";
import { tenants } from "./tenants";
import { locations } from "./locations";
import { invoices } from "./invoices";
import { payments } from "./payments";
import type { TenantId, UserId } from "@/lib/ids";

// F01 — the durable operation-intent ledger for counter payments and
// payment reversals. This is NOT a PSP payment intent (Release 1 has no
// gateway): it is the server-side identity of ONE counter operation.
//
// The row is committed BEFORE the financial effect, so an attempt has a
// durable identity even when the process or the response is lost. The
// financial transaction then locks this row, writes the payment /
// reversal + invoice update + audit + notification, and marks the row
// committed with the result id IN THE SAME TRANSACTION. Therefore:
//
//   prepared  = the intent is durable and NO financial effect exists;
//   committed = the effect exists and result_id names it;
//   cancelled = the operator discarded a prepared attempt; no effect.
//
// There is no expiry column. An unresolved intent is retried with the
// same key or discarded explicitly; a TTL that minted a replacement
// would reopen the duplicate-payment hole this closes.
//
// payload_fingerprint is a SHA-256 over the COMPLETE request payload
// (version, kind, target, amount, method, reference / reason), not the
// values themselves: the row binds the whole payload while keeping
// amounts, references and reasons out of this table. The financial row
// and its audit entry hold the values the operator actually submitted.
//
// actor_id is a bare users.id, like payments.received_by: the intent is
// bound to the signed-in actor, so a key seen by another sign-in is
// refused rather than replayed.

export const PAYMENT_INTENT_KINDS = ["payment", "reversal"] as const;
export type PaymentIntentKind = (typeof PAYMENT_INTENT_KINDS)[number];

export const PAYMENT_INTENT_STATES = [
  "prepared",
  "committed",
  "cancelled",
] as const;
export type PaymentIntentState = (typeof PAYMENT_INTENT_STATES)[number];

// The recovery observation carried into a NEW key. The UI may only start
// a new operation after a successful recovery read; the identity of the
// last committed intent it saw is stored here and re-checked atomically
// at commit. `unchecked` is only for trusted keyed service callers
// (tests/seeds); the public action always supplies `none` or `committed`.
export const PAYMENT_INTENT_OBSERVATIONS = [
  "unchecked",
  "none",
  "committed",
] as const;
export type PaymentIntentObservationKind =
  (typeof PAYMENT_INTENT_OBSERVATIONS)[number];

export const paymentIntents = pgTable(
  "payment_intents",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    actorId: uuid("actor_id").notNull().$type<UserId>(),
    kind: text("kind").notNull().$type<PaymentIntentKind>(),
    // The client-minted opaque key. uuid (not text) so a malformed key
    // cannot be stored; the service validates the same shape in Zod.
    idempotencyKey: uuid("idempotency_key").notNull(),
    // Exactly one target by kind — enforced by the check below.
    invoiceId: uuid("invoice_id"),
    paymentId: uuid("payment_id"),
    // A snapshot for audit. The recovery/cancel services check the
    // target's CURRENT location scope, so a narrowed scope hides the
    // attempt rather than authorising it from stale data.
    locationId: uuid("location_id").notNull(),
    payloadFingerprint: text("payload_fingerprint").notNull(),
    // The stale-snapshot guard. `observation_kind` distinguishes "not
    // supplied" (trusted keyed internal caller) from "the read found no
    // committed intent" (none) and "the read found this committed
    // intent" (committed). The commit re-checks it atomically.
    observationKind: text("observation_kind")
      .notNull()
      .default("unchecked")
      .$type<PaymentIntentObservationKind>(),
    observedIntentId: uuid("observed_intent_id"),
    state: text("state").notNull().default("prepared").$type<PaymentIntentState>(),
    resultId: uuid("result_id"),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...auditColumns,
  },
  (t) => [
    check(
      "payment_intents_kind_check",
      sql`${t.kind} in ('payment', 'reversal')`,
    ),
    check(
      "payment_intents_state_check",
      sql`${t.state} in ('prepared', 'committed', 'cancelled')`,
    ),
    check(
      "payment_intents_target_check",
      sql`(${t.kind} = 'payment' and ${t.invoiceId} is not null and ${t.paymentId} is null) or (${t.kind} = 'reversal' and ${t.invoiceId} is null and ${t.paymentId} is not null)`,
    ),
    check(
      "payment_intents_fingerprint_check",
      sql`char_length(${t.payloadFingerprint}) = 64`,
    ),
    check(
      "payment_intents_committed_check",
      sql`(${t.state} = 'committed' and ${t.resultId} is not null and ${t.committedAt} is not null) or (${t.state} <> 'committed' and ${t.resultId} is null and ${t.committedAt} is null)`,
    ),
    check(
      "payment_intents_cancelled_check",
      sql`(${t.state} = 'cancelled' and ${t.cancelledAt} is not null) or (${t.state} <> 'cancelled' and ${t.cancelledAt} is null)`,
    ),
    check(
      "payment_intents_observation_kind_check",
      sql`${t.observationKind} in ('unchecked', 'none', 'committed')`,
    ),
    check(
      "payment_intents_observation_check",
      sql`(${t.observationKind} = 'committed' and ${t.observedIntentId} is not null) or (${t.observationKind} in ('unchecked', 'none') and ${t.observedIntentId} is null)`,
    ),
    unique("payment_intents_id_tenant_key").on(t.id, t.tenantId),
    // One key, one operation, per tenant. The same key in another
    // tenant is another operation (different counter, different
    // business), exactly like account_entries.
    unique("payment_intents_tenant_key_unique").on(
      t.tenantId,
      t.idempotencyKey,
    ),
    // At most ONE unresolved attempt per actor and target. A second
    // device that mints its own key must recover the prepared attempt
    // (and its key) instead of preparing a parallel one. Committed and
    // cancelled rows do not participate, so sequential legitimate
    // payments/reversals are unaffected.
    uniqueIndex("payment_intents_tenant_actor_invoice_open_uidx")
      .on(t.tenantId, t.actorId, t.invoiceId)
      .where(sql`${t.kind} = 'payment' and ${t.state} = 'prepared'`),
    uniqueIndex("payment_intents_tenant_actor_payment_open_uidx")
      .on(t.tenantId, t.actorId, t.paymentId)
      .where(sql`${t.kind} = 'reversal' and ${t.state} = 'prepared'`),
    // One financial row can be named by at most one intent — the
    // backstop against a replay ever minting a second result.
    uniqueIndex("payment_intents_tenant_result_uidx")
      .on(t.tenantId, t.resultId)
      .where(sql`${t.resultId} is not null`),
    index("payment_intents_tenant_target_idx").on(
      t.tenantId,
      t.kind,
      t.invoiceId,
      t.paymentId,
      t.createdAt.desc(),
    ),
    // The latest committed row for the observed actor+target; the
    // stale-observation guard reads exactly this shape under the
    // per-target advisory lock.
    index("payment_intents_tenant_actor_target_committed_idx")
      .on(
        t.tenantId,
        t.actorId,
        t.kind,
        t.invoiceId,
        t.paymentId,
        t.committedAt.desc(),
      )
      .where(sql`${t.state} = 'committed'`),
    foreignKey({
      name: "payment_intents_invoice_tenant_fkey",
      columns: [t.invoiceId, t.tenantId],
      foreignColumns: [invoices.id, invoices.tenantId],
    }).onDelete("restrict"),
    foreignKey({
      name: "payment_intents_payment_tenant_fkey",
      columns: [t.paymentId, t.tenantId],
      foreignColumns: [payments.id, payments.tenantId],
    }).onDelete("restrict"),
    foreignKey({
      name: "payment_intents_location_tenant_fkey",
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }).onDelete("restrict"),
  ],
);

export type PaymentIntent = typeof paymentIntents.$inferSelect;
