import type { Ctx } from "@/lib/auth/context";

const STAFF_ROLES = ["owner", "admin", "coach"] as const;
const MANAGEMENT_ROLES = ["owner", "admin"] as const;

export function assertStaff(ctx: Ctx): void {
  if (!STAFF_ROLES.includes(ctx.role as (typeof STAFF_ROLES)[number])) {
    throw new Error(`forbidden: role '${ctx.role}' cannot perform this action`);
  }
}

export function assertManagement(ctx: Ctx): void {
  if (!MANAGEMENT_ROLES.includes(ctx.role as (typeof MANAGEMENT_ROLES)[number])) {
    throw new Error(`forbidden: role '${ctx.role}' cannot perform this action`);
  }
}
