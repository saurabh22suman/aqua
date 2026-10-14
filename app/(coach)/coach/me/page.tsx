import { requireDefaultCtx } from "@/lib/auth/context";
import { getCurrentStaffIdentity } from "@/lib/services/staff";
import { TenantSignOut } from "@/components/tenant-sign-out";
import { requireCoach } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
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
import Link from "next/link";
import { BookOpen, ChevronRight } from "lucide-react";

// K2 — coach's account surface. Minimum the K2 brief asks for: the
// user's name and phone, plus a sign-out button. The bottom nav's
// "Me" tab (app/(coach)/layout.tsx) lands here. A full profile editor
// is explicitly out of scope for the demo; when one lands, it can
// replace the two-line identity block in place without touching the
// nav or the sign-out form.
//
// F4 (mobile UX plan v2): this page previously required the
// members.read permission, which the coach role does not hold — every
// tap on "Me" threw ForbiddenError. requireCoach() is the
// authorization boundary; the identity read only needs the caller's
// own user row.
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

      {/* R02 — the designated curriculum lead's editing surface entry.
          Ordinary coaches do not hold levels.write, so this card is
          invisible to them. */}
      {hasPermission(ctx, "levels.write") ? (
        <Link
          href="/coach/curriculum"
          className="mt-4 flex min-h-[56px] items-center gap-3 rounded-card border border-line bg-paper px-4 py-3"
          data-testid="coach-curriculum-link"
        >
          <BookOpen size={17} className="flex-none text-ink-2" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-medium leading-tight">
              Curriculum framework
            </span>
            <span className="mt-0.5 block text-[12px] leading-tight text-ink-3">
              Levels, skills and the four-band rubric you assess against.
            </span>
          </span>
          <ChevronRight size={17} className="flex-none text-ink-3" aria-hidden="true" />
        </Link>
      ) : null}

      <TenantSignOut />
    </main>
  );
}
