import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns } from "./_shared";
import { tenants } from "./tenants";
import { members } from "./people";
import { locations } from "./locations";
import type { TenantId, MemberId } from "@/lib/ids";

// Wave 2 — a member's additional facilities. members.location_id stays
// the home facility; this is the opt-in record. See
// db/migrations/20260913000200_member_facility_optins.sql for the
// lifecycle rules (ended_on is null = active).
export const memberFacilityOptins = pgTable(
  "member_facility_optins",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id)
      .$type<TenantId>(),
    memberId: uuid("member_id").notNull().$type<MemberId>(),
    locationId: uuid("location_id").notNull(),
    optedOn: date("opted_on").notNull(),
    endedOn: date("ended_on"),
    ...auditColumns,
  },
  (t) => [
    unique("member_facility_optins_id_tenant_key").on(t.id, t.tenantId),
    uniqueIndex("member_facility_optins_active_idx")
      .on(t.tenantId, t.memberId, t.locationId)
      .where(sql`ended_on is null`),
    index("member_facility_optins_tenant_location_idx")
      .on(t.tenantId, t.locationId)
      .where(sql`ended_on is null`),
    check(
      "member_facility_optins_dates_check",
      sql`${t.endedOn} is null or ${t.endedOn} >= ${t.optedOn}`,
    ),
    foreignKey({
      name: "member_facility_optins_member_tenant_fkey",
      columns: [t.memberId, t.tenantId],
      foreignColumns: [members.id, members.tenantId],
    }),
    foreignKey({
      name: "member_facility_optins_location_tenant_fkey",
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }),
  ],
);

export type MemberFacilityOptin = typeof memberFacilityOptins.$inferSelect;
