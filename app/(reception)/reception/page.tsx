import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getTodayAction } from "@/lib/actions/coach";
import { listStaffAttendanceDayAction } from "@/lib/actions/staff-attendance";
import { ReceptionCheckIns } from "@/components/reception-check-ins";
import { StaffAttendanceBoard } from "@/components/staff-attendance-board";
import { CountChip } from "@/components/ui/CountChip";
import { requireReception } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import { todayInZone } from "@/lib/time/tz";

export default async function ReceptionTodayPage() {
  const ctx = await requireReception();
  const { sessions } = await getTodayAction();
  // U-08 — the receptionist role carries attendance.mark
  // (lib/services/roles.ts), so the panel is interactive. If a future
  // role reaches this surface without it, the panel degrades to
  // read-only rather than offering a tap that would fail.
  const canMark = hasPermission(ctx, "attendance.mark");
  // V-24 — the staff-attendance half U-08 deferred. Reception carries
  // staff.attendance; a role without it sees no board rather than a
  // tap that would be refused.
  const canMarkStaff = hasPermission(ctx, "staff.attendance");
  const today = todayInZone("Asia/Kolkata");
  const staffRows = canMarkStaff
    ? await listStaffAttendanceDayAction({ date: today })
    : [];

  return (
    <main className="px-5 pt-10">
      <div className="flex items-center gap-2.5">
        <h1 className="font-display text-[22px] font-semibold text-marine">Today</h1>
        <CountChip
          count={sessions.length}
          label={sessions.length === 1 ? "session" : "sessions"}
        />
      </div>

      <Link
        href="/reception/collect-payment"
        className="mt-6 flex items-center gap-3 bg-paper border border-line rounded-card px-4 min-h-[56px] py-3"
        data-testid="collect-payment-link"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-tight">Collect payment</p>
          <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
            Show a club payment QR with the amount.
          </p>
        </div>
        <ChevronRight size={18} className="text-ink-3 flex-none" />
      </Link>

      <Link
        href="/reception/members"
        className="mt-3 flex items-center gap-3 bg-paper border border-line rounded-card px-4 min-h-[56px] py-3"
        data-testid="member-search-link"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-tight">Find a member</p>
          <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
            Search by name, phone or member code.
          </p>
        </div>
        <ChevronRight size={18} className="text-ink-3 flex-none" />
      </Link>

      <Link
        href="/reception/cafe"
        className="mt-3 flex items-center gap-3 bg-paper border border-line rounded-card px-4 min-h-[56px] py-3"
        data-testid="cafe-link"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-tight">Café</p>
          <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
            Take a counter order and settle it.
          </p>
        </div>
        <ChevronRight size={18} className="text-ink-3 flex-none" />
      </Link>

      <ReceptionCheckIns sessions={sessions} canMark={canMark} />

      {canMarkStaff ? (
        <StaffAttendanceBoard
          date={today}
          rows={staffRows}
          canMark={canMarkStaff}
        />
      ) : null}
    </main>
  );
}
