import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns } from "./_shared";
import { tenants } from "./tenants";
import { payments } from "./payments";
import type { TenantId, UserId } from "@/lib/ids";

// PR2-C8 — payment reversals. A reversal is a NEW row; the original
// payments row is never edited (the live-attack audit's immutability
// rule). The invoice's paid/outstanding figures are recomputed in the
// same transaction by lib/services/payment-reversals.ts, so the
// reversal is always visible against the document it corrects.

export const paymentReversals = pgTable(
  "payment_reversals",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    paymentId: uuid("payment_id").notNull(),
    amountPaise: bigint("amount_paise", { mode: "bigint" }).notNull(),
    reason: text("reason").notNull(),
    reversedBy: uuid("reversed_by").$type<UserId>(),
    ...auditColumns,
  },
  (t) => [
    check("payment_reversals_amount_check", sql`${t.amountPaise} > 0`),
    check(
      "payment_reversals_reason_check",
      sql`char_length(${t.reason}) between 3 and 300`,
    ),
    unique("payment_reversals_id_tenant_key").on(t.id, t.tenantId),
    index("payment_reversals_tenant_payment_idx").on(t.tenantId, t.paymentId),
    foreignKey({
      name: "payment_reversals_payment_tenant_fkey",
      columns: [t.paymentId, t.tenantId],
      foreignColumns: [payments.id, payments.tenantId],
    }),
  ],
);
