import { v7 as uuidv7 } from "uuid";
import { check, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { auditColumns } from "./_shared";

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    status: text("status").notNull().default("trial"),
    planId: uuid("plan_id"),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    ...auditColumns,
  },
  (t) => [check("tenants_status_check", sql`${t.status} in ('trial', 'active', 'suspended', 'churned')`)],
);
