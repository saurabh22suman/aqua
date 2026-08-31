import type { Ctx } from "@/lib/auth/context";

// receptionist was missing here even though its seeded role template
// (lib/services/roles.ts) grants members.read/members.write and this
// task's own done-when is "a receptionist adds a member" -- every
// assertStaff-gated action, including listing programs, was
// unreachable for the one role meant to use it most.
const STAFF_ROLES = ["owner", "admin", "coach", "receptionist"] as const;
const MANAGEMENT_ROLES = ["owner", "admin"] as const;
const MEMBERS_WRITE_ROLES = ["owner", "admin", "receptionist"] as const;

// F-12 deletes all of these: role-key string comparisons are the F-04
// "Never" violation, tolerated only as an interim bridge to permission sets.
export function assertStaff(ctx: Ctx): void {
  if (!STAFF_ROLES.includes(ctx.roleKey as (typeof STAFF_ROLES)[number])) {
    throw new Error(
      `forbidden: role '${ctx.roleKey}' cannot perform this action`,
    );
  }
}

export function assertManagement(ctx: Ctx): void {
  if (!MANAGEMENT_ROLES.includes(ctx.roleKey as (typeof MANAGEMENT_ROLES)[number])) {
    throw new Error(
      `forbidden: role '${ctx.roleKey}' cannot perform this action`,
    );
  }
}

// Coaches read members (their own register) but do not create, edit,
// or transition them -- matches the seeded permission set: only
// owner/admin/receptionist carry members.write.
export function assertMembersWrite(ctx: Ctx): void {
  if (!MEMBERS_WRITE_ROLES.includes(ctx.roleKey as (typeof MEMBERS_WRITE_ROLES)[number])) {
    throw new Error(
      `forbidden: role '${ctx.roleKey}' cannot perform this action`,
    );
  }
}
