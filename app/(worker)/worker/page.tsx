import { StaffInboxLink } from "@/components/announcements/staff-inbox-link";
import { OptionalWorkspaceGuide } from "@/components/onboarding/optional-workspace-guide";
import { notFound } from "next/navigation";
import { requireDefaultCtx } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permission";
import { getCurrentStaffIdentity } from "@/lib/services/staff";
import { TenantSignOut } from "@/components/tenant-sign-out";
import { StaffClubInstallLink } from "@/components/staff-club-install-link";
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

// A05 — the worker's real home. The worker template is `staff.self`
// only; building/publishing the roster and approving leave are
// `staff.roster` (owner/admin). The surface map still points worker at
// the parent placeholder (pinned by the role-gating tier1 tests, which
// this page must not require), so the page authorizes by role +
// permission itself, per the D2 page-guard principle. Same
// self-service cards as /coach/me and /reception/me; every read returns
// only the caller's own rows. This page adds no manager capability.
export default async function WorkerHomePage() {
  const ctx = await requireDefaultCtx();
  if (ctx.roleKey !== "worker" || !hasPermission(ctx, "staff.self")) {
    notFound();
  }
  const identity = await getCurrentStaffIdentity(ctx);

  const today = todayInZone("Asia/Kolkata");
  const [shifts, attendance, leaveTypes, myLeave] = await Promise.all([
    listMyShiftsAction({ fromDate: today, toDate: addDays(today, 13) }),
    getMyAttendanceAction({ date: today }),
    listLeaveTypesAction(),
    listMyLeaveAction({ year: Number(today.slice(0, 4)) }),
  ]);

  return (
    <StaffPage>
      <StaffPageHeader
        title="My workday"
        meta="Your shifts, attendance and leave"
      />

      <OptionalWorkspaceGuide
        startCollapsed
        title="Explore your workday"
        intro="A quick look at this page, whenever you want it."
        regionLabel="Optional worker guide"
        itemLabel="Page feature"
        items={[
          { key: "shifts", title: "My shifts", detail: "Your shifts are shown in the section below." },
          { key: "attendance", title: "Today's attendance", detail: "Your attendance section is below." },
          { key: "leave", title: "Leave", detail: "Your leave section is below." },
        ]}
      />

      <StaffIdentity name={identity?.fullName} phone={identity?.phone} />

      <StaffInboxLink href="/worker/announcements" />

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
