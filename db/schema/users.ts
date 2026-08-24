import { v7 as uuidv7 } from "uuid";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { auditColumns, softDelete } from "./_shared";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  betterAuthId: text("better_auth_id").unique(),
  personId: uuid("person_id"),
  phone: text("phone").notNull().unique(),
  ...softDelete,
  ...auditColumns,
});

export type User = typeof users.$inferSelect;
