import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns, softDelete } from "./_shared";
import { tenants } from "./tenants";
import type { TenantId } from "@/lib/ids";

// C-35 (payment gateway decision, 2026-09-14) — owner payment QRs.
// Two kinds: a UPI QR generated from upi_id + payee_name, or an
// uploaded image QR. Images live in Postgres because no object store
// exists yet; see the migration for the caps and the kind contract.

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const paymentQrs = pgTable(
  "payment_qrs",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    nickname: text("nickname").notNull(),
    kind: text("kind").notNull(),
    upiId: text("upi_id"),
    payeeName: text("payee_name"),
    imageData: bytea("image_data"),
    imageMime: text("image_mime"),
    imageSize: integer("image_size"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    ...softDelete,
    ...auditColumns,
  },
  (t) => [
    check(
      "payment_qrs_kind_check",
      sql`${t.kind} in ('upi', 'image')`,
    ),
    check(
      "payment_qrs_kind_payload_check",
      sql`(${t.kind} = 'upi' and ${t.upiId} is not null and ${t.payeeName} is not null and ${t.imageData} is null) or (${t.kind} = 'image' and ${t.imageData} is not null and ${t.imageMime} is not null and ${t.upiId} is null and ${t.payeeName} is null)`,
    ),
    check(
      "payment_qrs_nickname_check",
      sql`char_length(${t.nickname}) between 1 and 60`,
    ),
    check(
      "payment_qrs_image_size_check",
      sql`${t.imageSize} is null or (${t.imageSize} >= 1 and ${t.imageSize} <= 262144)`,
    ),
    uniqueIndex("payment_qrs_tenant_nickname_live_uidx")
      .on(t.tenantId, sql`lower(${t.nickname})`)
      .where(sql`deleted_at is null`),
    index("payment_qrs_tenant_live_idx")
      .on(t.tenantId, t.sortOrder, t.createdAt)
      .where(sql`deleted_at is null`),
  ],
);

export type PaymentQr = typeof paymentQrs.$inferSelect;
