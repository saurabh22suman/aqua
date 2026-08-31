import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { boolean, index, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { auditColumns, softDelete } from "./_shared";
import { tenants } from "./tenants";
import type { TenantId } from "@/lib/ids";

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id)
      .$type<TenantId>(),
    name: text("name").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    address: jsonb("address").$type<Record<string, unknown>>(),
    ...softDelete,
    ...auditColumns,
  },
  (t) => [
    index("locations_tenant_live_idx").on(t.tenantId).where(sql`deleted_at is null`),
    unique("locations_id_tenant_key").on(t.id, t.tenantId),
  ],
);

export type Location = typeof locations.$inferSelect;
