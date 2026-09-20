import { and, asc, between, eq } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { leaveRequests, leaveTypes } from "@/db/schema/leave";
import type { StaffId, TenantId } from "@/lib/ids";

// V-26 — leave balances. The leave year is the calendar year (stated
// assumption): balances count requests whose from_date falls in the
// year. `available` is quota minus approved minus pending, so two
// pending requests cannot both pass the check and overdraw the quota.

export type LeaveBalanceRow = {
  leaveTypeId: string;
  name: string;
  isPaid: boolean;
  annualQuota: number | null;
  usedDays: number;
  pendingDays: number;
  availableDays: number | null;
};

export function daysInclusive(fromDate: string, toDate: string): number {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  const diff = Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd);
  return Math.round(diff / 86_400_000) + 1;
}

export function yearBounds(year: number): { fromDate: string; toDate: string } {
  return { fromDate: `${year}-01-01`, toDate: `${year}-12-31` };
}

export async function balancesInTx(
  tx: TenantTx,
  tenantId: TenantId,
  staffId: StaffId,
  year: number,
): Promise<LeaveBalanceRow[]> {
  const types = await tx
    .select()
    .from(leaveTypes)
    .where(eq(leaveTypes.tenantId, tenantId))
    .orderBy(asc(leaveTypes.name));

  const bounds = yearBounds(year);
  const requests = await tx
    .select({
      leaveTypeId: leaveRequests.leaveTypeId,
      days: leaveRequests.days,
      status: leaveRequests.status,
    })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.tenantId, tenantId),
        eq(leaveRequests.staffId, staffId),
        between(leaveRequests.fromDate, bounds.fromDate, bounds.toDate),
      ),
    );

  const used = new Map<string, number>();
  const pending = new Map<string, number>();
  for (const request of requests) {
    const days = Number(request.days);
    if (request.status === "approved") {
      used.set(request.leaveTypeId, (used.get(request.leaveTypeId) ?? 0) + days);
    } else if (request.status === "pending") {
      pending.set(
        request.leaveTypeId,
        (pending.get(request.leaveTypeId) ?? 0) + days,
      );
    }
  }

  return types.map((type) => {
    const usedDays = used.get(type.id) ?? 0;
    const pendingDays = pending.get(type.id) ?? 0;
    return {
      leaveTypeId: type.id,
      name: type.name,
      isPaid: type.isPaid,
      annualQuota: type.annualQuota,
      usedDays,
      pendingDays,
      availableDays:
        type.annualQuota === null
          ? null
          : Math.max(0, type.annualQuota - usedDays - pendingDays),
    };
  });
}
