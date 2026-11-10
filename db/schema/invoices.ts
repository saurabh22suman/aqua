import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns } from "./_shared";
import { tenants } from "./tenants";
import { members } from "./people";
import { locations } from "./locations";
import { subscriptions } from "./subscriptions";
import type { TenantId, MemberId } from "@/lib/ids";

// C-32 — invoices and their lines. India-specific shape: gapless
// per-financial-year number (C-31), the issuer's GSTIN snapshot (null
// means a Bill of Supply — an unregistered supplier cannot collect
// GST), SAC code and GST-rate snapshots on the lines, and
// subtotal + tax = total in integer paise (prices are GST-exclusive,
// C-29b).
//
// WR-1 / Option A — the payer is EXPLICIT. A walk-in booking has no
// member, but a walk-in bill is a real document with a real buyer, so
// member_id is nullable and payer_kind says which kind of payer the
// document names. The two states are exclusive (invoices_payer_check):
// a member document always has a member and carries NO buyer name, a
// guest document never has a member and always carries the buyer's
// name. The composite foreign key still applies whenever member_id is
// present, so a member payer stays tenant-checked.
//
// CORRECTION PASS (2026-11-05) — the mirror grows with the migration's
// new rule: guest_name carries the same 1..120 bound as the booking
// name it comes from (bookings_walk_in_name_check). Without this the
// mirror and db/migrations/20261105120000_invoice_guest_payer.sql
// would disagree, which is the same class of defect as F-6 in the
// review (a mirror that did not compile).
//
// DECISION PASS (2026-11-05) — two changes, both in step with the
// migration:
//
//   1. invoices_payer_check's member branch now also says
//      "and guest_name is null" (the migration's C4). The packet's own
//      invariant is that the two states are exclusive, and it did not
//      say anything about a member document's name.
//
//   2. THE IDENTITY OF AN ISSUED DOCUMENT IS FIXED, and that rule is NOT
//      in this mirror: it is the migration's BEFORE UPDATE trigger
//      (invoices_payer_immutable_trg), which Drizzle cannot express.
//      The trigger freezes payer_kind, member_id AND guest_name, so a
//      wrongly-billed walk-in invoice and a typo in its guest name are
//      corrected by VOIDING AND REISSUING, never by editing the issued
//      document (the human's decision, 2026-11-05). Read this mirror as
//      "the columns the guard compares", and read
//      db/migrations/20261105120000_invoice_guest_payer.sql for the
//      guard itself — the two must never disagree.

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    locationId: uuid("location_id").notNull(),
    // A guest invoice (a walk-in booking) has NO member. The payer kind
    // says so explicitly; the foreign key still applies when a member
    // is present.
    memberId: uuid("member_id").$type<MemberId>(),
    payerKind: text("payer_kind")
      .notNull()
      .default("member")
      .$type<InvoicePayerKind>(),
    // The buyer's name on a guest document. Null for a member payer:
    // the member's name is on the member's person record. Bounded to
    // the same 1..120 as bookings.walk_in_name, and FIXED at issue by
    // the migration's invoices_payer_immutable_trg.
    guestName: text("guest_name"),
    subscriptionId: uuid("subscription_id"),
    invoiceNumber: text("invoice_number").notNull(),
    financialYear: text("financial_year").notNull(),
    issuedOn: date("issued_on").notNull(),
    dueOn: date("due_on").notNull(),
    subtotalPaise: bigint("subtotal_paise", { mode: "bigint" }).notNull(),
    taxPaise: bigint("tax_paise", { mode: "bigint" }).notNull(),
    totalPaise: bigint("total_paise", { mode: "bigint" }).notNull(),
    paidPaise: bigint("paid_paise", { mode: "bigint" }).notNull().default(0n),
    status: text("status").notNull().default("issued"),
    // K-03 — the invoice's origin. 'membership' is the original
    // (subscription/renewal) path; 'cafe' is a billed counter order;
    // 'other' is the escape hatch for one-off documents. The café
    // payment rule (K-04) keys off this value, so it is a closed set,
    // not free text.
    source: text("source").notNull().default("membership").$type<InvoiceSource>(),
    gstin: text("gstin"),
    notes: text("notes"),
    ...auditColumns,
  },
  (t) => [
    check(
      "invoices_status_check",
      sql`${t.status} in ('draft', 'issued', 'partial', 'paid', 'void')`,
    ),
    check(
      "invoices_source_check",
      sql`${t.source} in ('membership', 'cafe', 'other')`,
    ),
    check(
      "invoices_number_check",
      sql`char_length(${t.invoiceNumber}) between 1 and 16`,
    ),
    check(
      "invoices_totals_check",
      sql`${t.subtotalPaise} + ${t.taxPaise} = ${t.totalPaise}`,
    ),
    check(
      "invoices_paid_within_total_check",
      sql`${t.paidPaise} <= ${t.totalPaise}`,
    ),
    // WR-1 — the payer is one of two kinds and the two are exclusive.
    check(
      "invoices_payer_kind_check",
      sql`${t.payerKind} in ('member', 'guest')`,
    ),
    // DECISION PASS — the member branch also says "and no buyer name":
    // a member document's buyer is the member's own person record, and
    // a name on the document would be a second, unreadable copy of it.
    check(
      "invoices_payer_check",
      sql`(${t.payerKind} = 'member' and ${t.memberId} is not null and ${t.guestName} is null)
          or (${t.payerKind} = 'guest' and ${t.memberId} is null and ${t.guestName} is not null and btrim(${t.guestName}) <> '')`,
    ),
    // CORRECTION PASS — the buyer's name is bounded exactly like the
    // booking name it comes from (bookings_walk_in_name_check).
    check(
      "invoices_guest_name_length_check",
      sql`${t.guestName} is null or char_length(${t.guestName}) between 1 and 120`,
    ),
    check("invoices_dates_check", sql`${t.dueOn} >= ${t.issuedOn}`),
    unique("invoices_id_tenant_key").on(t.id, t.tenantId),
    // The FK target for payments_invoice_payer_tenant_fkey: a payment's
    // payer must be the invoice's payer.
    unique("invoices_id_tenant_payer_key").on(t.id, t.tenantId, t.memberId),
    unique("invoices_number_tenant_key").on(
      t.tenantId,
      t.financialYear,
      t.invoiceNumber,
    ),
    uniqueIndex("invoices_subscription_due_live_uidx")
      .on(t.tenantId, t.subscriptionId, t.dueOn)
      .where(sql`subscription_id is not null and status <> 'void'`),
    index("invoices_tenant_status_due_idx").on(
      t.tenantId,
      t.status,
      t.dueOn,
    ),
    index("invoices_tenant_member_idx").on(t.tenantId, t.memberId),
    index("invoices_tenant_issued_idx").on(t.tenantId, t.issuedOn),
    foreignKey({
      name: "invoices_location_tenant_fkey",
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }),
    foreignKey({
      name: "invoices_member_tenant_fkey",
      columns: [t.memberId, t.tenantId],
      foreignColumns: [members.id, members.tenantId],
    }),
    foreignKey({
      name: "invoices_subscription_tenant_fkey",
      columns: [t.subscriptionId, t.tenantId],
      foreignColumns: [subscriptions.id, subscriptions.tenantId],
    }),
  ],
);

export const invoiceLineItems = pgTable(
  "invoice_line_items",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    invoiceId: uuid("invoice_id").notNull(),
    description: text("description").notNull(),
    sacCode: text("sac_code").notNull(),
    amountPaise: bigint("amount_paise", { mode: "bigint" }).notNull(),
    taxRateBp: integer("tax_rate_bp").notNull(),
    taxPaise: bigint("tax_paise", { mode: "bigint" }).notNull(),
    createdAt: auditColumns.createdAt,
  },
  (t) => [
    check(
      "invoice_line_items_description_check",
      sql`char_length(${t.description}) between 1 and 300`,
    ),
    check("invoice_line_items_sac_check", sql`${t.sacCode} ~ '^\\d{4,8}$'`),
    check("invoice_line_items_amount_check", sql`${t.amountPaise} > 0`),
    check(
      "invoice_line_items_rate_check",
      sql`${t.taxRateBp} between 0 and 10000`,
    ),
    unique("invoice_line_items_id_tenant_key").on(t.id, t.tenantId),
    index("invoice_line_items_invoice_idx").on(t.tenantId, t.invoiceId),
    foreignKey({
      name: "invoice_line_items_invoice_tenant_fkey",
      columns: [t.invoiceId, t.tenantId],
      foreignColumns: [invoices.id, invoices.tenantId],
    }).onDelete("cascade"),
  ],
);

export type Invoice = typeof invoices.$inferSelect;
export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect;
export type InvoiceStatus = "draft" | "issued" | "partial" | "paid" | "void";
export type InvoiceSource = "membership" | "cafe" | "other";
// WR-1 — which kind of payer a document names. 'member' is a member of
// the tenant; 'guest' is a walk-in buyer with no member record.
export type InvoicePayerKind = "member" | "guest";
