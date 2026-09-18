import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns, softDelete } from "./_shared";
import { tenants } from "./tenants";
import { locations } from "./locations";
import type { TenantId } from "@/lib/ids";

// K-01 — the café menu catalog (architecture.md §8.12: the café is a
// module on the kernel, not a parallel system). Location-scoped like
// every other sellable: one academy, one menu per counter. Prices are
// integer paise; GST is basis points; the SAC code is snapshotted
// onto orders later, so a menu edit never rewrites history.
//
// Soft delete only: an item that has been sold must survive as a row
// for the audit trail. The case-insensitive unique name is partial on
// `deleted_at is null`, so a name is reusable only after an archive.

export const menuCategories = pgTable(
  "menu_categories",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    locationId: uuid("location_id").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...softDelete,
    ...auditColumns,
  },
  (t) => [
    check(
      "menu_categories_name_check",
      sql`char_length(${t.name}) between 1 and 120`,
    ),
    unique("menu_categories_id_tenant_key").on(t.id, t.tenantId),
    uniqueIndex("menu_categories_tenant_location_name_live_uidx")
      .on(t.tenantId, t.locationId, sql`lower(${t.name})`)
      .where(sql`deleted_at is null`),
    index("menu_categories_tenant_location_live_idx")
      .on(t.tenantId, t.locationId, t.isActive, t.sortOrder)
      .where(sql`deleted_at is null`),
    foreignKey({
      name: "menu_categories_location_tenant_fkey",
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }),
  ],
);

export const menuItems = pgTable(
  "menu_items",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    locationId: uuid("location_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    name: text("name").notNull(),
    pricePaise: bigint("price_paise", { mode: "bigint" }).notNull(),
    taxRateBp: integer("tax_rate_bp").notNull().default(0),
    sacCode: text("sac_code").notNull(),
    isVeg: boolean("is_veg").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    ...softDelete,
    ...auditColumns,
  },
  (t) => [
    check(
      "menu_items_name_check",
      sql`char_length(${t.name}) between 1 and 120`,
    ),
    check("menu_items_price_check", sql`${t.pricePaise} > 0`),
    check(
      "menu_items_tax_rate_check",
      sql`${t.taxRateBp} between 0 and 10000`,
    ),
    check("menu_items_sac_check", sql`${t.sacCode} ~ '^\\d{4,8}$'`),
    unique("menu_items_id_tenant_key").on(t.id, t.tenantId),
    uniqueIndex("menu_items_tenant_location_name_live_uidx")
      .on(t.tenantId, t.locationId, sql`lower(${t.name})`)
      .where(sql`deleted_at is null`),
    index("menu_items_tenant_location_category_live_idx")
      .on(t.tenantId, t.locationId, t.categoryId)
      .where(sql`deleted_at is null`),
    foreignKey({
      name: "menu_items_location_tenant_fkey",
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }),
    foreignKey({
      name: "menu_items_category_tenant_fkey",
      columns: [t.categoryId, t.tenantId],
      foreignColumns: [menuCategories.id, menuCategories.tenantId],
    }),
  ],
);

export type MenuCategory = typeof menuCategories.$inferSelect;
export type MenuItem = typeof menuItems.$inferSelect;
