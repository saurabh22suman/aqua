import type { Ctx } from "@/lib/auth/context";

// receptionist was missing here even though its seeded role template
// (lib/services/roles.ts) grants members.read/members.write and this
// task's own done-when is "a receptionist adds a member" -- every
// assertStaff-gated action, including listing programs, was
// unreachable for the one role meant to use it most.
const STAFF_ROLES = ["owner", "admin", "coach", "receptionist"] as const;
const MANAGEMENT_ROLES = ["owner", "admin"] as const;
const MEMBERS_WRITE_ROLES = ["owner", "admin", "receptionist"] as const;
// Matches the seeded permission set exactly: coach, accountant and
// worker carry no enquiries.* permission at all, not even read --
// unlike members, where a coach at least reads their own register.
const ENQUIRIES_ROLES = ["owner", "admin", "receptionist"] as const;

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

// Covers both enquiries.read and enquiries.write -- the seeded roles
// that carry one carry the other (owner, admin, receptionist).
export function assertEnquiriesAccess(ctx: Ctx): void {
  if (!ENQUIRIES_ROLES.includes(ctx.roleKey as (typeof ENQUIRIES_ROLES)[number])) {
    throw new Error(
      `forbidden: role '${ctx.roleKey}' cannot perform this action`,
    );
  }
}
