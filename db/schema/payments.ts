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
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns } from "./_shared";
import { tenants } from "./tenants";
import { members } from "./people";
import { locations } from "./locations";
import { invoices } from "./invoices";
import type { TenantId, MemberId, UserId } from "@/lib/ids";

// C-33 — payments recorded at the counter. Cash, UPI reference or bank
// transfer; `received_by` is the desk user (bare user id, same shape
// as attendance.marked_by); `reference` carries the UPI UTR or bank
// transaction reference, never card data. `channel` is 'counter' today.

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    invoiceId: uuid("invoice_id"),
    memberId: uuid("member_id").notNull().$type<MemberId>(),
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
      sql`${t.method} in ('cash', 'upi', 'bank_transfer')`,
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
    unique("payments_id_tenant_key").on(t.id, t.tenantId),
    index("payments_tenant_received_idx").on(t.tenantId, t.receivedAt.desc()),
    index("payments_tenant_invoice_idx").on(t.tenantId, t.invoiceId),
    index("payments_tenant_member_idx").on(t.tenantId, t.memberId),
    foreignKey({
      name: "payments_invoice_tenant_fkey",
      columns: [t.invoiceId, t.tenantId],
      foreignColumns: [invoices.id, invoices.tenantId],
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
export type PaymentMethod = "cash" | "upi" | "bank_transfer";
