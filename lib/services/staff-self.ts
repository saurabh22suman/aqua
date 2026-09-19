import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { staff } from "@/db/schema/staff";
import type { StaffId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";

// One resolver for "the caller's OWN staff row", shared by the
// self-service staff services (attendance, leave) and the premises
// check-in page. A user with no staff record resolves to null — the
// callers render the honest empty state or refuse, never guess.

export async function ownStaffIdInTx(
  tx: TenantTx,
  ctx: ActionCtx,
): Promise<StaffId | null> {
  if (!ctx.userId) return null;
  const [row] = await tx
    .select({ id: staff.id })
    .from(staff)
    .where(
      and(
        eq(staff.tenantId, ctx.tenantId),
        eq(staff.userId, ctx.userId),
        isNull(staff.deletedAt),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}
