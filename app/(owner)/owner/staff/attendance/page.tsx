import { notFound } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { listStaffAttendanceDayAction } from "@/lib/actions/staff-attendance";
import { callerIsLiveOwnerForSettingsOrDelegation } from "@/lib/services/owner-authority";
import { ownStaffIdInTx } from "@/lib/services/staff-self";
import { tenantTimezoneInTx } from "@/lib/services/tenant-timezone";
import { todayInZone } from "@/lib/time/tz";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { StaffAttendanceBoard } from "@/components/staff-attendance-board";

export default async function StaffAttendancePage({
  searchParams,
}: {
  searchParams?: Promise<{ date?: string }>;
}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "staff.attendance");
  if (!hasFeature(ctx, "staff")) notFound();
  const { timezone, hasStaff, isOwner } = await withTenant(ctx.tenantId, async (tx) => ({
    timezone: await tenantTimezoneInTx(tx, ctx.tenantId),
    hasStaff: (await ownStaffIdInTx(tx, ctx)) !== null,
    isOwner: await callerIsLiveOwnerForSettingsOrDelegation(tx, ctx),
  }));
  const today = todayInZone(timezone);
  const requested = (await searchParams)?.date;
  const parsed = z.string().date().safeParse(requested);
  if (requested !== undefined && !parsed.success) notFound();
  const date = parsed.success ? parsed.data : today;
  const rows = await listStaffAttendanceDayAction({ date });
  const canChangeDate = date === today || hasPermission(ctx, "settings.manage");
  const canMark = canChangeDate && (hasStaff || isOwner);
  return (
    <OwnerPage>
      <PageHeader title="Staff attendance" />
      <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm font-medium" htmlFor="attendance-date">
          Date
          <Input id="attendance-date" name="date" type="date" defaultValue={date} />
        </label>
        <Button type="submit">Show date</Button>
      </form>
      {!canChangeDate ? <p className="mt-3 text-sm text-ink-3">Only an owner or admin can change another day’s attendance.</p> : null}
      <StaffAttendanceBoard date={date} rows={rows} canMark={canMark} canCreateMissing={hasStaff} showExtendedStatuses={isOwner} />
    </OwnerPage>
  );
}
