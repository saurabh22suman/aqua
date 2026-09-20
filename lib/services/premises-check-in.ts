import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { staffAttendance } from "@/db/schema/staff-attendance";
import { ownStaffIdInTx } from "@/lib/services/staff-self";
import type { MyAttendanceRow } from "@/lib/services/staff-attendance-list";
import { tenantTimezoneInTx } from "@/lib/services/tenant-timezone";
import { verifyPremisesQrToken } from "@/lib/services/premises-qr";
import { todayInZone } from "@/lib/time/tz";
import { asTenantId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";
import type { StaffAttendanceMethod, StaffAttendanceStatus } from "@/db/schema/staff-attendance";

// V-25 — resolves what the premises check-in page shows: the tenant's
// name, the caller's own staff linkage and today's attendance. The
// token must verify AND name the caller's own tenant — a poster from
// another academy (or a forged token) renders the invalid state, not
// a check-in form.

export type PremisesCheckInView = {
  tenantName: string;
  today: MyAttendanceRow | null;
  hasStaffRecord: boolean;
};

export async function resolvePremisesCheckIn(
  ctx: ActionCtx,
  token: string,
): Promise<PremisesCheckInView | null> {
  const claims = verifyPremisesQrToken(token);
  if (!claims || claims.tenantId !== ctx.tenantId) return null;

  return withTenant(ctx.tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, asTenantId(ctx.tenantId)))
      .limit(1);

    const staffId = await ownStaffIdInTx(tx, ctx);
    if (!staffId) {
      return {
        tenantName: tenant?.name ?? "this academy",
        today: null,
        hasStaffRecord: false,
      };
    }

    const timezone = await tenantTimezoneInTx(tx, ctx.tenantId);
    const workDate = todayInZone(timezone);
    const [row] = await tx
      .select()
      .from(staffAttendance)
      .where(
        and(
          eq(staffAttendance.tenantId, ctx.tenantId),
          eq(staffAttendance.staffId, staffId),
          eq(staffAttendance.workDate, workDate),
        ),
      )
      .limit(1);

    return {
      tenantName: tenant?.name ?? "this academy",
      hasStaffRecord: true,
      today: row
        ? {
            id: row.id,
            workDate: row.workDate,
            status: row.status as StaffAttendanceStatus,
            lateMinutes: row.lateMinutes,
            method: row.method as StaffAttendanceMethod,
            checkedInAt: row.checkedInAt?.toISOString() ?? null,
            checkedOutAt: row.checkedOutAt?.toISOString() ?? null,
            note: row.note,
          }
        : null,
    };
  });
}
