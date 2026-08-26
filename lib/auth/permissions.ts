import type { Ctx } from "@/lib/auth/context";

const STAFF_ROLES = ["owner", "admin", "coach"] as const;
const MANAGEMENT_ROLES = ["owner", "admin"] as const;

// F-12 deletes both of these: role-key string comparisons are the F-04
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
