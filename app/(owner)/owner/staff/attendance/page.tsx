import { notFound } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { listStaffAttendanceDayAction } from "@/lib/actions/staff-attendance";
import { callerIsLiveOwnerForSettingsOrDelegation } from "@/lib/services/owner-authority";
import { ownStaffIdInTx } from "@/lib/services/staff-self";
import { tenantTimezoneInTx } from "@/lib/services/tenant-timezone";
import { addDays, formatFullDateIST, todayInZone } from "@/lib/time/tz";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { OwnerPeriodStrip } from "@/components/owner-ui/owner-period-strip";
import { OwnerFormDate } from "@/components/owner-ui/owner-form-date";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { Input } from "@/components/ui/Input";
import { Button, buttonClasses } from "@/components/ui/Button";
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
  const marked = rows.filter((row) => row.status !== null).length;
  const unknown = rows.filter(
    (row) => row.status === null && row.attendanceVisibility === "limited",
  ).length;
  const unmarked = rows.length - marked - unknown;
  const late = rows.filter((row) => row.lateMinutes > 0).length;
  const summary = [
    `${marked} of ${rows.length} marked`,
    unmarked > 0 ? `${unmarked} not marked` : null,
    unknown > 0 ? `${unknown} unknown` : null,
    late > 0 ? `${late} late` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const dateForm = (
    <form method="get" className="mt-3 flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-sm font-medium" htmlFor="attendance-date">
        Date
        <Input id="attendance-date" name="date" type="date" defaultValue={date} />
      </label>
      <Button type="submit">Show date</Button>
    </form>
  );
  return (
    <OwnerPage workflow="planner">
      <PageHeader
        title="Staff attendance"
        purpose="Who is on, late or unmarked for this day. A manual change records your name and the reason."
      />
      {ctx.roleKey === "owner" ? <OwnerPeriodStrip label="Attendance date" value={formatFullDateIST(`${date}T12:00:00Z`)} period="day"
        previous={{ href: `/owner/staff/attendance?date=${addDays(date, -1)}` }}
        next={{ href: `/owner/staff/attendance?date=${addDays(date, 1)}` }}>
        <form method="get" className="space-y-3">
          <OwnerFormDate name="date" label="Date" initialDate={date} />
          <Button type="submit">Show date</Button>
        </form>
        <Link href={`/owner/staff/attendance?date=${today}`} className={buttonClasses({ variant: "secondary", size: "sm", className: "mt-3" })}>Today</Link>
      </OwnerPeriodStrip> : (
      <nav
        aria-label="Attendance date"
        className="mt-4 flex flex-wrap items-center gap-2"
      >
        <Link
          href={`/owner/staff/attendance?date=${addDays(date, -1)}`}
          className={buttonClasses({ variant: "secondary", size: "sm" })}
        >
          Previous day
        </Link>
        {date === today ? (
          <span
            aria-current="date"
            className="inline-flex min-h-11 items-center px-2 text-[13px] font-medium text-[var(--accent-ink)]"
          >
            Today
          </span>
        ) : (
          <Link
            href={`/owner/staff/attendance?date=${today}`}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            Today
          </Link>
        )}
        <Link
          href={`/owner/staff/attendance?date=${addDays(date, 1)}`}
          className={buttonClasses({ variant: "secondary", size: "sm" })}
        >
          Next day
        </Link>
      </nav>
      )}
      {ctx.roleKey !== "owner" ? <p className="mt-2 text-[13px] text-ink-2">
        Showing{" "}
        <span className="font-medium text-ink">
          {formatFullDateIST(`${date}T12:00:00Z`)}
        </span>
      </p> : null}
      {rows.length > 0 ? (
        <p className="mt-1 text-[12.5px] text-ink-3" role="status">
          {summary}
        </p>
      ) : null}
      {ctx.roleKey !== "owner" ? dateForm : null}
      {!canChangeDate ? <p className="mt-3 text-sm text-ink-3">Only an owner or admin can change another day’s attendance.</p> : null}
      <StaffAttendanceBoard date={date} rows={rows} canMark={canMark} canCreateMissing={hasStaff} showExtendedStatuses={isOwner} />
    </OwnerPage>
  );
}
