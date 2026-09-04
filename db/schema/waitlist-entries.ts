import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import type { MemberId, TenantId, UserId } from "@/lib/ids";

export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    memberId: uuid("member_id").notNull().$type<MemberId>(),
    batchId: uuid("batch_id").notNull(),
    status: text("status").notNull().default("waiting"),
    position: integer("position").notNull().default(1),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdBy: uuid("created_by").$type<UserId>(),
    updatedBy: uuid("updated_by").$type<UserId>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The "open queue for this batch" query — the
    // session generator / dashboard's "next to enrol when a
    // slot opens" path.
    index("waitlist_entries_batch_queue_idx")
      .on(t.tenantId, t.batchId, t.position)
      .where(sql`status = 'waiting'`),
  ],
);

export type WaitlistStatus = "waiting" | "promoted" | "cancelled" | "expired";
