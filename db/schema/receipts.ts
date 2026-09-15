import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  check,
  customType,
  foreignKey,
  integer,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { payments } from "./payments";
import type { TenantId, UserId } from "@/lib/ids";

// The PDF bytes, same customType shape payment_qrs uses for image_data.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

// C-39 — the branded receipt, stored per payment. Generated lazily on
// first read so a PDF failure can never block recording money; the
// unique (tenant_id, payment_id) keeps generation idempotent.

export const receipts = pgTable(
  "receipts",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    paymentId: uuid("payment_id").notNull(),
    pdfData: bytea("pdf_data").notNull(),
    pdfSize: integer("pdf_size").notNull(),
    createdBy: uuid("created_by").$type<UserId>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("receipts_pdf_size_check", sql`${t.pdfSize} > 0`),
    unique("receipts_id_tenant_key").on(t.id, t.tenantId),
    unique("receipts_payment_tenant_key").on(t.tenantId, t.paymentId),
    foreignKey({
      name: "receipts_payment_tenant_fkey",
      columns: [t.paymentId, t.tenantId],
      foreignColumns: [payments.id, payments.tenantId],
    }),
  ],
);

export type Receipt = typeof receipts.$inferSelect;
