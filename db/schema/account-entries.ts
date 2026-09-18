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
import { tenants } from "./tenants";
import { members } from "./people";
import type { TenantId, MemberId, UserId } from "@/lib/ids";

// K-05 — the member wallet ledger. Append-only: one row per movement,
// with the running balance snapshotted on the row so any drift is
// detectable by re-derivation (lib/services/wallet.ts::balanceOf).
// The database is the last line of defence against a negative wallet
// (balance_after_paise >= 0) and against duplicate writes
// (unique tenant_id + idempotency_key). No UPDATE/DELETE grants — see
// db/migrations/20260918130000_k05_account_entries.sql and the
// append-only list in db/bootstrap-roles.ts.

export const ACCOUNT_ENTRY_DIRECTIONS = ["debit", "credit"] as const;
export type AccountEntryDirection = (typeof ACCOUNT_ENTRY_DIRECTIONS)[number];

export const ACCOUNT_ENTRY_SOURCE_TYPES = [
  "topup",
  "charge",
  "refund",
  "adjustment",
] as const;
export type AccountEntrySourceType = (typeof ACCOUNT_ENTRY_SOURCE_TYPES)[number];

export const accountEntries = pgTable(
  "account_entries",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    memberId: uuid("member_id").notNull().$type<MemberId>(),
    direction: text("direction").notNull().$type<AccountEntryDirection>(),
    amountPaise: bigint("amount_paise", { mode: "bigint" }).notNull(),
    balanceAfterPaise: bigint("balance_after_paise", {
      mode: "bigint",
    }).notNull(),
    sourceType: text("source_type").notNull().$type<AccountEntrySourceType>(),
    // Polymorphic soft reference (payment / order / invoice). No FK:
    // the ledger outlives the record that caused the entry.
    sourceId: uuid("source_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdBy: uuid("created_by").$type<UserId>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "account_entries_direction_check",
      sql`${t.direction} in ('debit', 'credit')`,
    ),
    check("account_entries_amount_check", sql`${t.amountPaise} > 0`),
    check(
      "account_entries_balance_check",
      sql`${t.balanceAfterPaise} >= 0`,
    ),
    check(
      "account_entries_source_type_check",
      sql`${t.sourceType} in ('topup', 'charge', 'refund', 'adjustment')`,
    ),
    check(
      "account_entries_idempotency_check",
      sql`char_length(${t.idempotencyKey}) between 1 and 200`,
    ),
    unique("account_entries_id_tenant_key").on(t.id, t.tenantId),
    unique("account_entries_tenant_idempotency_key").on(
      t.tenantId,
      t.idempotencyKey,
    ),
    index("account_entries_tenant_member_created_idx").on(
      t.tenantId,
      t.memberId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index("account_entries_tenant_source_idx").on(
      t.tenantId,
      t.sourceType,
      t.sourceId,
    ),
    foreignKey({
      name: "account_entries_member_tenant_fkey",
      columns: [t.memberId, t.tenantId],
      foreignColumns: [members.id, members.tenantId],
    }),
  ],
);

export type AccountEntry = typeof accountEntries.$inferSelect;
