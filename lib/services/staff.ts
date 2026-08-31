import { and, eq, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { staff, type StaffType } from "@/db/schema/staff";
import { persons } from "@/db/schema/people";
import type { Ctx } from "@/lib/auth/context";

type ActionCtx = Pick<Ctx, "tenantId"> & { userId?: string };

export type StaffRow = {
  id: string;
  personId: string;
  fullName: string;
  userId: string | null;
  staffType: StaffType;
  employedOn: string | null;
};

export async function listStaff(
  ctx: ActionCtx,
  filters: { staffType?: StaffType } = {},
): Promise<StaffRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const conditions = [eq(staff.tenantId, ctx.tenantId), isNull(staff.deletedAt)];
    if (filters.staffType) conditions.push(eq(staff.staffType, filters.staffType));

    const rows = await tx
      .select({
        id: staff.id,
        personId: staff.personId,
        fullName: persons.fullName,
        userId: staff.userId,
        staffType: staff.staffType,
        employedOn: staff.employedOn,
      })
      .from(staff)
      .innerJoin(persons, eq(persons.id, staff.personId))
      .where(and(...conditions))
      .orderBy(persons.fullName);

    return rows.map((r) => ({ ...r, staffType: r.staffType as StaffType }));
  });
}

// One person can be both a coach and a member (C-04 done-when) --
// creating a staff record here never checks or touches the persons
// row's member status. existingPersonId links an already-registered
// person (e.g. a member who now also coaches); the "new person" branch
// is for staff who aren't members.
export async function createStaff(
  ctx: ActionCtx,
  input:
    | { existingPersonId: string; staffType: StaffType; userId?: string; employedOn?: string }
    | { fullName: string; staffType: StaffType; userId?: string; employedOn?: string },
): Promise<{ ok: true; staffId: string } | { ok: false; error: string }> {
  return withTenant(ctx.tenantId, async (tx) => {
    let personId: string;
    if ("existingPersonId" in input) {
      const [existing] = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(and(eq(persons.id, input.existingPersonId), eq(persons.tenantId, ctx.tenantId)));
      if (!existing) return { ok: false, error: "Person not found in this tenant." };
      personId = existing.id;
    } else {
      const [created] = await tx
        .insert(persons)
        .values({
          tenantId: ctx.tenantId,
          fullName: input.fullName,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: persons.id });
      personId = created.id;
    }

    const [row] = await tx
      .insert(staff)
      .values({
        tenantId: ctx.tenantId,
        personId,
        userId: input.userId,
        staffType: input.staffType,
        employedOn: input.employedOn,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .onConflictDoNothing({
        target: [staff.tenantId, staff.personId, staff.staffType],
        where: isNull(staff.deletedAt),
      })
      .returning({ id: staff.id });

    if (!row) return { ok: false, error: "This person already has a staff record of that type." };
    return { ok: true, staffId: row.id };
  });
}

// A SQL fragment resolving the caller's OWN coach-type staff id,
// embedded into another query's WHERE clause (register.ts's coach-
// scoping queries) rather than fetched as a separate round trip. A
// caller who isn't a coach or has no staff record resolves to a
// subquery that matches nothing, which is the correct "sees no
// sessions" behaviour, not an error.
export function coachStaffIdSubquery(tenantId: string, userId: string | undefined) {
  return sql`(select ${staff.id} from ${staff} where ${staff.tenantId} = ${tenantId} and ${staff.userId} = ${userId ?? null} and ${staff.staffType} = 'coach' and ${staff.deletedAt} is null limit 1)`;
}
