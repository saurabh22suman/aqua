import { StaffInboxLink } from "@/components/announcements/staff-inbox-link";
import { requireDefaultCtx } from "@/lib/auth/context";
import { getCurrentStaffIdentity } from "@/lib/services/staff";
import { TenantSignOut } from "@/components/tenant-sign-out";
import { StaffClubInstallLink } from "@/components/staff-club-install-link";
import { requireCoach } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
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
import Link from "next/link";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import {
  STAFF_CARD,
  StaffIdentity,
  StaffPage,
  StaffPageHeader,
} from "@/components/staff-ui/staff-page";
import { StaffAppearance } from "@/components/staff-ui/staff-appearance";
import { OpenWorkspaceGuideLink } from "@/components/onboarding/guide-help-button";

// K2 — coach's account surface. The bottom nav's "Me" tab lands here.
// The identity block is the caller's own name/phone; the three
// self-service cards read only the caller's own rows (staff.self).
export default async function CoachMePage() {
  await requireCoach();
  const ctx = await requireDefaultCtx();
  const identity = await getCurrentStaffIdentity(ctx);

  // V-23..V-26 — the self-service cards. Every read is staff.self and
  // returns only the caller's own rows; the pages pass them in so the
  // cards stay pure.
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

      <StaffInboxLink href="/coach/announcements" />

      <StaffAppearance />

      <MyShiftsCard shifts={shifts} />
      <MyAttendanceCard attendance={attendance} />
      <MyLeaveCard
        types={leaveTypes}
        balances={myLeave.balances}
        requests={myLeave.requests}
      />

      {/* R02 — the designated curriculum lead's editing surface entry.
          Ordinary coaches do not hold levels.write, so this card is
          invisible to them. */}
      {hasPermission(ctx, "levels.write") ? (
        <Link
          href="/coach/curriculum"
          className={`mt-4 flex min-h-14 items-center gap-3 px-4 py-3 ${STAFF_CARD}`}
          data-testid="coach-curriculum-link"
        >
          <span className="grid h-10 w-10 flex-none place-items-center rounded-ctl bg-deck text-ink-2">
            <OwnerIcon name="programs" size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-medium leading-tight text-ink">
              Curriculum framework
            </span>
            <span className="mt-0.5 block text-[12px] leading-tight text-ink-3">
              Levels, skills and the four-band rubric you assess against.
            </span>
          </span>
          <OwnerIcon name="chevron" size={18} className="flex-none text-ink-3" />
        </Link>
      ) : null}

      <StaffClubInstallLink tenantId={ctx.tenantId} />
      {ctx.roleKey === "coach" ? <OpenWorkspaceGuideLink homeHref="/coach" /> : null}
      <TenantSignOut />
    </StaffPage>
  );
}
