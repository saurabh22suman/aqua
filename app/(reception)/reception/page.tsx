import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getTodayAction } from "@/lib/actions/coach";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm, titleCase } from "@/lib/terminology/keys";
import { listStaffAttendanceDayAction } from "@/lib/actions/staff-attendance";
import { ReceptionCheckIns } from "@/components/reception-check-ins";
import { StaffAttendanceBoard } from "@/components/staff-attendance-board";
import { CountChip } from "@/components/ui/CountChip";
import { KhelIcon } from "@/components/icons/khel-icons";
import { requireReception } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { todayInZone } from "@/lib/time/tz";

export default async function ReceptionTodayPage() {
  const ctx = await requireReception();
  const [{ sessions }, terminology] = await Promise.all([
    getTodayAction(),
    getTerminologyAction(),
  ]);
  // U-08 — the receptionist role carries attendance.mark
  // (lib/services/roles.ts), so the panel is interactive. If a future
  // role reaches this surface without it, the panel degrades to
  // read-only rather than offering a tap that would fail.
  const canMark = hasPermission(ctx, "attendance.mark");
  // V-24 — the staff-attendance half U-08 deferred. Reception carries
  // staff.attendance; a role without it sees no board rather than a
  // tap that would be refused.
  const canMarkStaff = hasPermission(ctx, "staff.attendance");
  // C03 — module entries follow grant + entitlement, never surface
  // alone: a card is only shown when its action would be allowed
  // (payments.record/invoices.read) and the tenant's plan includes the
  // module the action's requirePermission checks. Otherwise the tap
  // would land on a refused action.
  const canCollect = hasPermission(ctx, "payments.record") && hasFeature(ctx, "billing");
  const canCloseDay = canCollect;
  const canSeeDues = hasPermission(ctx, "invoices.read") && hasFeature(ctx, "billing");
  const canUseCafe = hasPermission(ctx, "payments.record") && hasFeature(ctx, "cafe.pos");
  const today = todayInZone("Asia/Kolkata");
  const staffRows = canMarkStaff
    ? await listStaffAttendanceDayAction({ date: today })
    : [];

  return (
    <main className="px-5 pt-6 pb-8">
      <div className="flex items-center gap-2.5">
        <h1 className="font-display text-[22px] font-semibold text-marine">Today</h1>
        <CountChip
          count={sessions.length}
          label={sessions.length === 1 ? "session" : "sessions"}
        />
      </div>

      {/* The module entries are ONE grid, not five stacked full-width
          cards: on a phone they are a compact two-up set, and each one
          carries a short purpose instead of a paragraph. The manual
          payment confirmation stays where it matters — on the
          collect-payment entry. */}
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {canCollect ? (
          <Link
            href="/reception/collect-payment"
            className="flex items-center gap-3 bg-paper border border-line rounded-card px-4 min-h-[56px] py-3"
            data-testid="collect-payment-link"
          >
            <span className="grid h-10 w-10 flex-none place-items-center rounded-ctl bg-deck text-ink-2">
              <KhelIcon name="collect-payment" size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium leading-tight">
                Collect payment
              </span>
              <span className="mt-0.5 block text-[12px] text-ink-3 leading-tight">
                Cash or UPI — verify at the counter.
              </span>
            </span>
            <ChevronRight size={18} className="text-ink-3 flex-none" />
          </Link>
        ) : null}

        {canCloseDay ? (
          <Link
            href="/reception/close"
            className="flex items-center gap-3 bg-paper border border-line rounded-card px-4 min-h-[56px] py-3"
            data-testid="close-day-link"
          >
            <span className="grid h-10 w-10 flex-none place-items-center rounded-ctl bg-deck text-ink-2">
              <KhelIcon name="audit-activity" size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium leading-tight">
                Close day
              </span>
              <span className="mt-0.5 block text-[12px] text-ink-3 leading-tight">
                Count today&apos;s cash and close the counter.
              </span>
            </span>
            <ChevronRight size={18} className="text-ink-3 flex-none" />
          </Link>
        ) : null}

        {canSeeDues ? (
          <Link
            href="/reception/dues"
            className="flex items-center gap-3 bg-paper border border-line rounded-card px-4 min-h-[56px] py-3"
            data-testid="dues-link"
          >
            <span className="grid h-10 w-10 flex-none place-items-center rounded-ctl bg-deck text-ink-2">
              <KhelIcon name="fees" size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium leading-tight">
                Dues
              </span>
              <span className="mt-0.5 block text-[12px] text-ink-3 leading-tight">
                Pending fees, overdue first.
              </span>
            </span>
            <ChevronRight size={18} className="text-ink-3 flex-none" />
          </Link>
        ) : null}

        <Link
          href="/reception/members"
          className="flex items-center gap-3 bg-paper border border-line rounded-card px-4 min-h-[56px] py-3"
          data-testid="member-search-link"
        >
          <span className="grid h-10 w-10 flex-none place-items-center rounded-ctl bg-deck text-ink-2">
            <KhelIcon name="members" size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-medium leading-tight">
              Find a {titleCase(resolveTerm(terminology, "member", 1)).toLowerCase()}
            </span>
            <span className="mt-0.5 block text-[12px] text-ink-3 leading-tight">
              Search by name, phone or code.
            </span>
          </span>
          <ChevronRight size={18} className="text-ink-3 flex-none" />
        </Link>

        {canUseCafe ? (
          <Link
            href="/reception/cafe"
            className="flex items-center gap-3 bg-paper border border-line rounded-card px-4 min-h-[56px] py-3"
            data-testid="cafe-link"
          >
            <span className="grid h-10 w-10 flex-none place-items-center rounded-ctl bg-deck text-ink-2">
              <KhelIcon name="cafe" size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium leading-tight">
                Café
              </span>
              <span className="mt-0.5 block text-[12px] text-ink-3 leading-tight">
                Take a counter order and settle it.
              </span>
            </span>
            <ChevronRight size={18} className="text-ink-3 flex-none" />
          </Link>
        ) : null}
      </div>

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
