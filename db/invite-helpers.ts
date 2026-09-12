import { persons } from "./schema/people";
import { staff, type StaffType } from "./schema/staff";
import type { TenantTx } from "./tenant";
import type { PersonId, StaffId, TenantId, UserId } from "@/lib/ids";

// PR C — shared helper for the invite paths.
//
// Phase 3.6's inviteStaff fixed the audit gap (inviting a coach
// produced only a tenant_memberships row, with no persons or
// staff row — the operator's only path to attach the coach to a
// batch was a separate "create staff from scratch" form that
// duplicated the person's identity). inviteOwner, on the other
// hand, was never updated — it still produces only users +
// tenant_memberships. An owner who also coaches today has no
// persons/staff rows and therefore cannot be assigned to a batch.
//
// This module is the one place the invariant lives: an invite in
// this codebase produces a persons row (always, so the membership
// has an attached identity), and a staff row when the role maps
// to a staffType (coach, receptionist). Both invite paths call
// ensurePersonAndStaff so they cannot diverge again — the audit
// pattern is "two parallel paths silently disagree"; one helper
// is the mechanical answer.
//
// Lives under db/ rather than lib/services/ because it takes a
// tenant transaction (Tx) directly — the invite paths each open
// their own withTenant(tenantId, async (tx) => …) and call this
// from inside. Splitting the helper out of those services keeps
// the divergence trap from reforming in the next refactor.

export type EnsurePersonAndStaffInput = {
  fullName: string;
  userId: UserId;
  staffType?: StaffType;
};

export type EnsurePersonAndStaffResult = {
  personId: PersonId;
  staffId: StaffId | null;
};

export async function ensurePersonAndStaff(
  tx: TenantTx,
  tenantId: TenantId,
  actorId: UserId,
  input: EnsurePersonAndStaffInput,
): Promise<EnsurePersonAndStaffResult> {
  const [personRow] = await tx
    .insert(persons)
    .values({
      tenantId,
      fullName: input.fullName,
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning({ id: persons.id });
  if (!personRow) {
    // The schema's NOT NULL on persons.fullName plus the insert
    // returning always returning one row make this a defensive
    // branch, not a normal failure. The caller surfaces it as
    // 'invalid' (matches the existing invite error code).
    throw new Error("Failed to create persons row for invite.");
  }
  if (!input.staffType) {
    return { personId: personRow.id, staffId: null };
  }
  const [staffRow] = await tx
    .insert(staff)
    .values({
      tenantId,
      personId: personRow.id,
      userId: input.userId,
      staffType: input.staffType,
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning({ id: staff.id });
  if (!staffRow) {
    throw new Error("Failed to create staff row for invite.");
  }
  return { personId: personRow.id, staffId: staffRow.id };
}