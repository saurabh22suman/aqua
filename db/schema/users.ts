import { v7 as uuidv7 } from "uuid";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { auditColumns, softDelete } from "./_shared";
import type { UserId, PersonId } from "@/lib/ids";

export const users = pgTable("users", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7())
    .$type<UserId>(),
  betterAuthId: text("better_auth_id").unique(),
  personId: uuid("person_id").$type<PersonId>(),
  phone: text("phone").notNull().unique(),
  ...softDelete,
  ...auditColumns,
});

export type User = typeof users.$inferSelect;
