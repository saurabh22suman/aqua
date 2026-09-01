import { timestamp, uuid } from "drizzle-orm/pg-core";
import type { UserId } from "@/lib/ids";

export const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").$type<UserId>(),
  updatedBy: uuid("updated_by").$type<UserId>(),
};

export const softDelete = {
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};
