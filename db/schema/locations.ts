import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns, softDelete } from "./_shared";
import { tenants } from "./tenants";
import type { TenantId } from "@/lib/ids";

// O-01 (docs/ops-platform-design.md §8) — the hierarchy is fixed:
// tenant → location → facility → sub-unit, the same four levels for
// every tenant. What varies is how many nodes exist and what kind
// each one is; a single-site tenant never sees the concept.
export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id)
      .$type<TenantId>(),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("club"),
    isPrimary: boolean("is_primary").notNull().default(false),
    address: jsonb("address").$type<Record<string, unknown>>(),
    ...softDelete,
    ...auditColumns,
  },
  (t) => [
    index("locations_tenant_live_idx").on(t.tenantId).where(sql`deleted_at is null`),
    uniqueIndex("locations_tenant_primary_uidx")
      .on(t.tenantId)
      .where(sql`is_primary and deleted_at is null`),
    unique("locations_id_tenant_key").on(t.id, t.tenantId),
    check(
      "locations_kind_check",
      sql`${t.kind} in ('club', 'cafe', 'mixed')`,
    ),
  ],
);

export type Location = typeof locations.$inferSelect;
export type LocationKind = "club" | "cafe" | "mixed";
