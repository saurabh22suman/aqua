import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns, softDelete } from "./_shared";
import { tenants } from "./tenants";
import { members } from "./people";
import type { TenantId, MemberId } from "@/lib/ids";

// U-03 — staff-authored notes on the member 360. See
// db/migrations/20260918124000_u03_member_notes.sql for the shape
// rationale (soft delete, non-empty body, tenant-leading live index).
export const memberNotes = pgTable(
  "member_notes",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    memberId: uuid("member_id").notNull().$type<MemberId>(),
    body: text("body").notNull(),
    ...softDelete,
    ...auditColumns,
  },
  (t) => [
    check(
      "member_notes_body_check",
      sql`char_length(btrim(${t.body})) between 1 and 4000`,
    ),
    unique("member_notes_id_tenant_key").on(t.id, t.tenantId),
    foreignKey({
      name: "member_notes_member_tenant_fkey",
      columns: [t.memberId, t.tenantId],
      foreignColumns: [members.id, members.tenantId],
    }),
    index("member_notes_tenant_member_live_idx")
      .on(t.tenantId, t.memberId, t.createdAt.desc())
      .where(sql`deleted_at is null`),
  ],
);

export type MemberNote = typeof memberNotes.$inferSelect;
