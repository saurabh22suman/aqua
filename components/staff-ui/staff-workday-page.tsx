import { BackLink } from "@/components/ui/BackLink";
import { getMyAttendanceAction } from "@/lib/actions/staff-attendance";
import { listMyShiftsAction } from "@/lib/actions/shifts";
import { listLeaveTypesAction, listMyLeaveAction } from "@/lib/actions/leave";
import type { Ctx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import { addDays, todayInZone } from "@/lib/time/tz";
import { StaffPage, StaffPageHeader } from "./staff-page";
import { loadStaffWorkday, StaffWorkdaySections } from "./staff-workday";

export async function StaffWorkdayPage({ ctx, href, backHref, backLabel }: {
  ctx: Ctx;
  href: string;
  backHref: string;
  backLabel: string;
}) {
  requirePermission(ctx, "staff.self");
  const today = todayInZone("Asia/Kolkata");
  const workday = await loadStaffWorkday({
    shifts: listMyShiftsAction({ fromDate: today, toDate: addDays(today, 13) }),
    attendance: getMyAttendanceAction({ date: today }),
    leaveTypes: listLeaveTypesAction(),
    leave: listMyLeaveAction({ year: Number(today.slice(0, 4)) }),
  });

  return (
    <StaffPage>
      <BackLink href={backHref} label={backLabel} />
      <StaffPageHeader title="My workday" />
      <StaffWorkdaySections workday={workday} pageHref={href} />
    </StaffPage>
  );
}
