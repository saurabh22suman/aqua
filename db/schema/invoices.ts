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

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    locationId: uuid("location_id").notNull(),
    memberId: uuid("member_id").notNull().$type<MemberId>(),
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
    check("invoices_dates_check", sql`${t.dueOn} >= ${t.issuedOn}`),
    unique("invoices_id_tenant_key").on(t.id, t.tenantId),
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
