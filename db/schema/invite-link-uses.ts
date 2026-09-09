import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import type { TenantId } from "@/lib/ids";

export const inviteLinkUses = pgTable(
  "invite_link_uses",
  {
    jti: text("jti").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    membershipId: uuid("membership_id").notNull(),
    purpose: text("purpose").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "invite_link_uses_purpose_check",
      sql`${t.purpose} in ('invite', 'relogin')`,
    ),
    index("invite_link_uses_membership_idx").on(
      t.tenantId,
      t.membershipId,
      t.usedAt,
    ),
  ],
);

export type InviteLinkPurpose = "invite" | "relogin";
