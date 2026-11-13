import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import { getCurrentStaffIdentity } from "@/lib/services/staff";
import { TenantSignOut } from "@/components/tenant-sign-out";
import { StaffClubInstallLink } from "@/components/staff-club-install-link";
import { requireReception } from "@/lib/auth/surface-guard";
import { listMyShiftsAction } from "@/lib/actions/shifts";
import { getMyAttendanceAction } from "@/lib/actions/staff-attendance";
import {
  listLeaveTypesAction,
  listMyLeaveAction,
} from "@/lib/actions/leave";
import { MyShiftsCard } from "@/components/my-shifts-card";
import { MyAttendanceCard } from "@/components/my-attendance-card";
import { MyLeaveCard } from "@/components/my-leave-card";
import { addDays, todayInZone } from "@/lib/time/tz";
import {
  StaffIdentity,
  StaffPage,
  StaffPageHeader,
} from "@/components/staff-ui/staff-page";
import { StaffAppearance } from "@/components/staff-ui/staff-appearance";

// K2 — reception's account surface. Mirrors /coach/me: identity, the
// caller's own shifts/attendance/leave, sign-out. Reception's bottom
// nav keeps its four tabs.
export default async function ReceptionMePage() {
  await requireReception();
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.read");
  const identity = await getCurrentStaffIdentity(ctx);

  // V-23..V-26 — same self-service cards as /coach/me; every read is
  // staff.self and returns only the caller's own rows.
  const today = todayInZone("Asia/Kolkata");
  const [shifts, attendance, leaveTypes, myLeave] = await Promise.all([
    listMyShiftsAction({ fromDate: today, toDate: addDays(today, 13) }),
    getMyAttendanceAction({ date: today }),
    listLeaveTypesAction(),
    listMyLeaveAction({ year: Number(today.slice(0, 4)) }),
  ]);

  return (
    <StaffPage>
      <StaffPageHeader title="Me" />

      <StaffIdentity name={identity?.fullName} phone={identity?.phone} />

      <StaffAppearance />

      <MyShiftsCard shifts={shifts} />
      <MyAttendanceCard attendance={attendance} />
      <MyLeaveCard
        types={leaveTypes}
        balances={myLeave.balances}
        requests={myLeave.requests}
      />

      <StaffClubInstallLink tenantId={ctx.tenantId} />
      <TenantSignOut />
    </StaffPage>
  );
}
