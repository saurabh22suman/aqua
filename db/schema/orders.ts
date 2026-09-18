import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  bigint,
  check,
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
import { locations } from "./locations";
import { members } from "./people";
import { users } from "./users";
import { invoices } from "./invoices";
import type { TenantId, MemberId, UserId } from "@/lib/ids";

// K-02 — counter orders. The order is the operational record; the
// invoice it bills into (K-03) is the legal document. Lines snapshot
// name, unit price, tax rate and SAC at capture time, so a later menu
// edit never rewrites what a customer was sold. `item_id` is a soft
// reference on purpose: the snapshot, not the menu row, is the truth.
//
// `member_id` is nullable for a walk-in; `counter_client_id` is
// reserved for the Phase 5 offline POS and is unused in Release 1.
// Void is terminal and keeps the lines (K-02 Done when).

export const ORDERS_STATUSES = ["placed", "served", "billed", "voided"] as const;
export type OrderStatus = (typeof ORDERS_STATUSES)[number];

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    locationId: uuid("location_id").notNull(),
    memberId: uuid("member_id").$type<MemberId>(),
    status: text("status").notNull().default("placed").$type<OrderStatus>(),
    channel: text("channel").notNull().default("counter"),
    servedBy: uuid("served_by").$type<UserId>(),
    invoiceId: uuid("invoice_id"),
    counterClientId: text("counter_client_id"),
    voidReason: text("void_reason"),
    ...auditColumns,
  },
  (t) => [
    check(
      "orders_status_check",
      sql`${t.status} in ('placed', 'served', 'billed', 'voided')`,
    ),
    check("orders_channel_check", sql`${t.channel} in ('counter')`),
    check(
      "orders_void_reason_check",
      sql`${t.voidReason} is null or char_length(${t.voidReason}) between 1 and 300`,
    ),
    unique("orders_id_tenant_key").on(t.id, t.tenantId),
    // K-03: an order bills into at most one invoice, 1:1.
    uniqueIndex("orders_tenant_invoice_uidx")
      .on(t.tenantId, t.invoiceId)
      .where(sql`invoice_id is not null`),
    index("orders_tenant_location_status_idx").on(
      t.tenantId,
      t.locationId,
      t.status,
      t.createdAt.desc(),
    ),
    index("orders_tenant_member_idx").on(t.tenantId, t.memberId),
    foreignKey({
      name: "orders_location_tenant_fkey",
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }),
    foreignKey({
      name: "orders_member_tenant_fkey",
      columns: [t.memberId, t.tenantId],
      foreignColumns: [members.id, members.tenantId],
    }),
    foreignKey({
      name: "orders_invoice_tenant_fkey",
      columns: [t.invoiceId, t.tenantId],
      foreignColumns: [invoices.id, invoices.tenantId],
    }),
    foreignKey({
      name: "orders_served_by_fkey",
      columns: [t.servedBy],
      foreignColumns: [users.id],
    }),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    orderId: uuid("order_id").notNull(),
    itemId: uuid("item_id").notNull(),
    itemName: text("item_name").notNull(),
    qty: integer("qty").notNull(),
    unitPricePaise: bigint("unit_price_paise", { mode: "bigint" }).notNull(),
    taxRateBp: integer("tax_rate_bp").notNull(),
    sacCode: text("sac_code").notNull(),
    linePaise: bigint("line_paise", { mode: "bigint" }).notNull(),
    taxPaise: bigint("tax_paise", { mode: "bigint" }).notNull(),
  },
  (t) => [
    check(
      "order_lines_item_name_check",
      sql`char_length(${t.itemName}) between 1 and 300`,
    ),
    check("order_lines_qty_check", sql`${t.qty} > 0`),
    check("order_lines_unit_price_check", sql`${t.unitPricePaise} >= 0`),
    check(
      "order_lines_tax_rate_check",
      sql`${t.taxRateBp} between 0 and 10000`,
    ),
    check("order_lines_sac_check", sql`${t.sacCode} ~ '^\\d{4,8}$'`),
    check("order_lines_line_check", sql`${t.linePaise} >= 0`),
    check("order_lines_tax_check", sql`${t.taxPaise} >= 0`),
    // line_paise is unit × qty, enforced in the database so a bad
    // service write cannot silently desync the order total.
    check(
      "order_lines_line_total_check",
      sql`${t.linePaise} = ${t.unitPricePaise} * ${t.qty}`,
    ),
    unique("order_lines_id_tenant_key").on(t.id, t.tenantId),
    index("order_lines_tenant_order_idx").on(t.tenantId, t.orderId),
    foreignKey({
      name: "order_lines_order_tenant_fkey",
      columns: [t.orderId, t.tenantId],
      foreignColumns: [orders.id, orders.tenantId],
    }).onDelete("cascade"),
  ],
);

export type Order = typeof orders.$inferSelect;
export type OrderLine = typeof orderLines.$inferSelect;
