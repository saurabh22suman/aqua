import { v7 as uuidv7 } from "uuid";
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { auditColumns, softDelete } from "./_shared";
import type { UserId, PersonId } from "@/lib/ids";

// 2026-09-11 auth feature, slice 2a: per-account PIN lockout counters
// for the phone+PIN login. See db/migrations/20260912000000_pin_lockout.sql
// for the schema rationale and the service-layer comment in
// lib/services/credentials.ts for the lockout threshold + window.
export const users = pgTable("users", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7())
    .$type<UserId>(),
  betterAuthId: text("better_auth_id").unique(),
  personId: uuid("person_id").$type<PersonId>(),
  phone: text("phone").notNull().unique(),
  failedPinAttempts: integer("failed_pin_attempts").notNull().default(0),
  pinLockedUntil: timestamp("pin_locked_until", { withTimezone: true }),
  ...softDelete,
  ...auditColumns,
});

export type User = typeof users.$inferSelect;
