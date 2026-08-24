import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { boolean, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { auditColumns, softDelete } from "./_shared";
import { tenants } from "./tenants";

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    ...softDelete,
    ...auditColumns,
  },
  (t) => [
    index("locations_tenant_live_idx").on(t.tenantId).where(sql`deleted_at is null`),
    unique("locations_id_tenant_key").on(t.id, t.tenantId),
  ],
);

export type Location = typeof locations.$inferSelect;
