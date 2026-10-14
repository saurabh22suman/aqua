import { notFound } from "next/navigation";
import { requireDefaultCtx } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permission";
import { getCurrentStaffIdentity } from "@/lib/services/staff";
import { TenantSignOut } from "@/components/tenant-sign-out";
import { formatPhoneIN } from "@/lib/phone";
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

// A05 — the worker's real home. The worker template is `staff.self`
// only; building/publishing the roster and approving leave are
// `staff.roster` (owner/admin). The surface map still points worker at
// the parent placeholder (pinned by the role-gating tier1 tests, which
// this page must not require), so the page authorizes by role +
// permission itself, per the D2 page-guard principle. Same self-service
// cards as /coach/me and /reception/me; every read returns only the
// caller's own rows.
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
    <main className="px-5 pt-6 pb-8">
      <h1 className="font-display text-[19px] font-semibold">Me</h1>

      <section className="mt-5 rounded-card border border-line bg-paper p-4">
        <p className="font-display text-[15px] font-semibold">
          {identity?.fullName ?? "Signed in"}
        </p>
        <p className="mt-1 text-[13px] text-ink-3 font-mono">
          {identity?.phone ? formatPhoneIN(identity.phone) : "No phone on file"}
        </p>
      </section>

      <MyShiftsCard shifts={shifts} />
      <MyAttendanceCard attendance={attendance} />
      <MyLeaveCard
        types={leaveTypes}
        balances={myLeave.balances}
        requests={myLeave.requests}
      />

      <TenantSignOut />
    </main>
  );
}
