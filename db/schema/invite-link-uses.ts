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
      sql`${t.purpose} in ('invite', 'relogin', 'reset')`,
    ),
    index("invite_link_uses_membership_idx").on(
      t.tenantId,
      t.membershipId,
      t.usedAt,
    ),
  ],
);

// 2026-09-11 auth feature, slice 2b: 'reset' is the ops-issued,
// owner-only, 1-hour-TTL link that forces the set-PIN screen and
// overwrites the credential. See the migration header for the
// schema rationale and lib/services/invite-link-issue.ts for the
// issuance + role guard.
export type InviteLinkPurpose = "invite" | "relogin" | "reset";
