import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  bigint,
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
import { members } from "./people";
import { locations } from "./locations";
import { invoices, type InvoicePayerKind } from "./invoices";
import type { TenantId, MemberId, UserId } from "@/lib/ids";

// C-33 — payments recorded at the counter. Cash, UPI reference or bank
// transfer; `received_by` is the desk user (bare user id, same shape
// as attendance.marked_by); `reference` carries the UPI UTR or bank
// transaction reference, never card data. `channel` is 'counter' today.
//
// WR-1 / Option A — a payment inherits its payer from the invoice it
// settles, so a payment against a guest invoice has NO member and says
// so explicitly. payments_payer_check keeps the two states exclusive,
// payments_guest_needs_invoice_check keeps a guest payment attached to
// a document, and payments_invoice_payer_tenant_fkey plus the
// payments_payer_matches_invoice trigger make the database refuse a
// payment whose payer is not its invoice's payer.
//
// The invoice's side of the same rule — the payer of an issued document
// is fixed — is a TRIGGER (invoices_payer_immutable_trg), and a trigger
// has no Drizzle representation. It lives only in the migration; this
// mirror carries the columns and the checks, and the two must be
// changed together.

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    invoiceId: uuid("invoice_id"),
    // A guest payment (a walk-in bill) has NO member.
    memberId: uuid("member_id").$type<MemberId>(),
    payerKind: text("payer_kind")
      .notNull()
      .default("member")
      .$type<InvoicePayerKind>(),
    locationId: uuid("location_id").notNull(),
    amountPaise: bigint("amount_paise", { mode: "bigint" }).notNull(),
    method: text("method").notNull(),
    channel: text("channel").notNull().default("counter"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    receivedBy: uuid("received_by").$type<UserId>(),
    reference: text("reference"),
    status: text("status").notNull().default("captured"),
    ...auditColumns,
  },
  (t) => [
    check("payments_amount_check", sql`${t.amountPaise} > 0`),
    check(
      "payments_method_check",
      sql`${t.method} in ('cash', 'upi', 'bank_transfer', 'card', 'other')`,
    ),
    check("payments_channel_check", sql`${t.channel} in ('counter', 'online')`),
    check(
      "payments_status_check",
      sql`${t.status} in ('pending', 'captured', 'failed', 'refunded')`,
    ),
    check(
      "payments_reference_check",
      sql`${t.reference} is null or char_length(${t.reference}) between 1 and 120`,
    ),
    // WR-1 — the payer is one of two kinds and the two are exclusive.
    check(
      "payments_payer_kind_check",
      sql`${t.payerKind} in ('member', 'guest')`,
    ),
    check(
      "payments_payer_check",
      sql`(${t.payerKind} = 'member' and ${t.memberId} is not null)
          or (${t.payerKind} = 'guest' and ${t.memberId} is null)`,
    ),
    // R1 (review 2026-11-05) — a guest payment settles a document. A
    // guest has no member, so the invoice is the only thing that names
    // the payer; a guest payment with no invoice is an orphan — money
    // with no document, no buyer and nothing to reconcile it against.
    // The member branch is deliberately NOT constrained: a member
    // payment with no invoice is the wallet top-up
    // (lib/services/wallet.ts writes invoice_id null with a member).
    check(
      "payments_guest_needs_invoice_check",
      sql`${t.payerKind} <> 'guest' or ${t.invoiceId} is not null`,
    ),
    unique("payments_id_tenant_key").on(t.id, t.tenantId),
    // Bug fix (live-attack audit): the same UPI/bank reference cannot
    // justify two different payments. Partial — cash never carries a
    // reference. See db/migrations/20260915140000_payments_reference_uniqueness.sql.
    uniqueIndex("payments_tenant_method_reference_uidx")
      .on(t.tenantId, t.method, t.reference)
      .where(sql`${t.reference} is not null`),
    index("payments_tenant_received_idx").on(t.tenantId, t.receivedAt.desc()),
    index("payments_tenant_invoice_idx").on(t.tenantId, t.invoiceId),
    index("payments_tenant_member_idx").on(t.tenantId, t.memberId),
    foreignKey({
      name: "payments_invoice_tenant_fkey",
      columns: [t.invoiceId, t.tenantId],
      foreignColumns: [invoices.id, invoices.tenantId],
    }),
    // WR-1 — the payment's payer must be the invoice's payer. MATCH
    // SIMPLE skips this key when a referencing column is null, so it is
    // enforced for a member payment and skipped for a guest payment;
    // the guest case is the trigger's job.
    foreignKey({
      name: "payments_invoice_payer_tenant_fkey",
      columns: [t.invoiceId, t.tenantId, t.memberId],
      foreignColumns: [invoices.id, invoices.tenantId, invoices.memberId],
    }),
    foreignKey({
      name: "payments_member_tenant_fkey",
      columns: [t.memberId, t.tenantId],
      foreignColumns: [members.id, members.tenantId],
    }),
    foreignKey({
      name: "payments_location_tenant_fkey",
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }),
  ],
);

export type Payment = typeof payments.$inferSelect;
export type PaymentMethod =
  | "cash"
  | "upi"
  | "bank_transfer"
  | "card"
  | "other";
