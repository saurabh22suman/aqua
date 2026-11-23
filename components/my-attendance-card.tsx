import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { STAFF_CARD } from "@/components/staff-ui/staff-page";
import { StaffCheckInControls } from "@/components/staff-check-in-controls";
import type { MyAttendanceRow } from "@/lib/services/staff-attendance";

// V-24 — the staff member's own attendance on the Me tab: today's
// state plus check-in/out. The page reads through
// getMyAttendanceAction (staff.self) and passes the row in, so the
// card can only ever show the caller's own attendance. A pure
// component, so page tests can render it without a data layer.

export function MyAttendanceCard({
  attendance,
  date,
  id,
}: {
  attendance: MyAttendanceRow | null;
  date: string;
  /** Page-local anchor so a summary can point at the one action. */
  id?: string;
}) {
  return (
    <section id={id} className={`mt-4 scroll-mt-4 p-4 ${STAFF_CARD}`}>
      <h2 className="flex items-center gap-2 text-[15px] font-medium text-ink">
        <OwnerIcon name="check" size={16} className="text-ink-3" />
        Today&apos;s attendance
      </h2>
      <StaffCheckInControls initialAttendance={attendance} date={date} />
    </section>
  );
}
