import { and, eq, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { staff, type StaffType } from "@/db/schema/staff";
import { persons } from "@/db/schema/people";
import { users } from "@/db/schema/users";
import type { ActionCtx } from "@/lib/auth/context";
import { asPersonId, type StaffId, type PersonId, type TenantId, type UserId } from "@/lib/ids";
import { auditActorOf, writeAudit } from "@/lib/audit/write";
import {
  resolveStaffScope,
  staffScopePredicate,
  type StaffScopeCtx,
} from "@/lib/services/staff-scope";

export type StaffRow = {
  id: StaffId;
  personId: PersonId;
  fullName: string;
  userId: UserId | null;
  staffType: StaffType;
  employedOn: string | null;
};

// The staff directory.
//
// The list is bound to the caller's facilities. The staff row carries no
// location column, so the facility is resolved through staff_locations; the
// test is an EXISTS, so a staff member who works at two of the caller's
// facilities is still ONE row.
//
// A staff member attached to NO facility is not visible to a restricted
// caller (decision D3 — the recommendation implemented here, still the
// human's). The owner and any all-locations caller remain unrestricted and
// still see the whole club.
//
// A denied or empty scope produces no rows through the helper's `false`
// predicate — never "every row".
export async function listStaff(
  ctx: StaffScopeCtx,
  filters: { staffType?: StaffType } = {},
): Promise<StaffRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const conditions = [eq(staff.tenantId, ctx.tenantId), isNull(staff.deletedAt)];
    if (filters.staffType) conditions.push(eq(staff.staffType, filters.staffType));

    // The caller's facilities: their own ACTIVE membership's for a
    // facility-scoped caller; the switch's answer for every other role;
    // unrestricted for the owner, an all-locations caller or an explicit
    // system actor.
    const scope = await resolveStaffScope(tx, ctx);
    const predicate = staffScopePredicate(tx, staff.id, scope, ctx.tenantId);
    if (predicate) conditions.push(predicate);

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

    return rows.map((r) => ({ ...r, userId: r.userId ?? null, staffType: r.staffType as StaffType }));
  });
}

// One person can be both a coach and a member (C-04 done-when) --
// creating a staff record here never checks or touches the persons
// row's member status. existingPersonId links an already-registered
// person (e.g. a member who now also coaches); the "new person" branch
// is for staff who aren't members.
//
// NOT SCOPED BY THIS PACKET, deliberately: `staff.write` is the human's
// owner-only boundary (staff records carry no location column, so there is no
// facility to bind a create to), and the facility link of a staff record is
// written by the invite path (`staff.invite`, also owner-only). A staff record
// created here has NO staff_locations row, which under D3's recommended
// semantics means a facility-scoped manager does not see it. That is a product
// consequence recorded in the packet handoff, not a scope rule invented here.
export async function createStaff(
  ctx: ActionCtx,
  input:
    | { existingPersonId: string; staffType: StaffType; userId?: UserId; employedOn?: string }
    | { fullName: string; staffType: StaffType; userId?: UserId; employedOn?: string },
): Promise<{ ok: true; staffId: StaffId } | { ok: false; error: string }> {
  // Closed-key guard up front — the schema's CHECK constraint
  // would catch a typo too, but a typed error here is a
  // cleaner signal than a 23514 surfacing as an exception in
  // the calling action.
  const ALLOWED: ReadonlyArray<StaffType> = ["coach", "receptionist", "worker", "accountant"];
  if (!ALLOWED.includes(input.staffType)) {
    return { ok: false, error: `Unknown staff type "${input.staffType}".` };
  }

  return withTenant(ctx.tenantId, async (tx) => {
    let personId: PersonId;
    if ("existingPersonId" in input) {
      const [existing] = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(and(eq(persons.id, asPersonId(input.existingPersonId)), eq(persons.tenantId, ctx.tenantId)));
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
    // E-02 — the audit row shares the transaction with the insert
    // (docs/architecture.md:1330). A refusal above writes nothing.
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      ...auditActorOf(ctx),
      action: "staff.create",
      entityType: "staff",
      entityId: row.id,
      after: {
        personId,
        staffType: input.staffType,
        employedOn: input.employedOn ?? null,
        userId: input.userId ?? null,
      },
    });
    return { ok: true, staffId: row.id };
  });
}

// K2 — the "me" surface. Resolves the current user's full name and
// phone, used by /coach/me, /reception/me and the Account section of
// /owner/settings to label the logged-in user above the sign-out
// button.
//
// Phone is always present (users.phone is not null by schema), so the
// page never renders "No phone on file" for a logged-in user. Name
// is best-effort: it comes from persons via the staff row, and an
// owner / admin who was never entered as a person — the owner user
// in the seed has no staff row, only a users row — gets null. That
// matches the data; we don't fabricate a name. The "Signed in" label
// the UI shows in that case is the honest empty.
//
// Returns null only when ctx.userId is missing (which means the
// caller never resolved a real session — an internal misuse, not a
// user-facing case).
export type StaffIdentity = {
  fullName: string | null;
  phone: string;
};

export async function getCurrentStaffIdentity(
  ctx: ActionCtx,
): Promise<StaffIdentity | null> {
  if (!ctx.userId) return null;
  return withTenant(ctx.tenantId, async (tx) => {
    const phoneRow = await tx
      .select({ phone: users.phone })
      .from(users)
      .where(and(eq(users.id, ctx.userId!), isNull(users.deletedAt)))
      .limit(1);
    const phone = phoneRow[0]?.phone;
    if (!phone) return null;

    const nameRow = await tx
      .select({ fullName: persons.fullName })
      .from(staff)
      .innerJoin(persons, eq(persons.id, staff.personId))
      .where(
        and(
          eq(staff.tenantId, ctx.tenantId),
          eq(staff.userId, ctx.userId!),
          isNull(staff.deletedAt),
        ),
      )
      .limit(1);

    return { fullName: nameRow[0]?.fullName ?? null, phone };
  });
}

// A SQL fragment resolving the caller's OWN coach-type staff id,
// embedded into another query's WHERE clause (register.ts's coach-
// scoping queries) rather than fetched as a separate round trip. A
// caller who isn't a coach or has no staff record resolves to a
// subquery that matches nothing, which is the correct "sees no
// sessions" behaviour, not an error.
//
// M3: tenantId/userId are branded here on purpose, not left as plain
// string -- this is the exact function whose fix (comparing
// sessions.coach_id against a resolved StaffId instead of ctx.userId
// directly) closed the original bug. Branding the signature means a
// future caller passing the wrong id kind fails to compile instead of
// silently matching nothing (or worse, matching the wrong row).
export function coachStaffIdSubquery(tenantId: TenantId, userId: UserId | undefined) {
  return sql`(select ${staff.id} from ${staff} where ${staff.tenantId} = ${tenantId} and ${staff.userId} = ${userId ?? null} and ${staff.staffType} = 'coach' and ${staff.deletedAt} is null limit 1)`;
}
