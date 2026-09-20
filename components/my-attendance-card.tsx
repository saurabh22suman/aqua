import { Clock } from "lucide-react";
import { formatTimeIST } from "@/lib/time/tz";
import { StaffCheckInControls } from "@/components/staff-check-in-controls";
import type { MyAttendanceRow } from "@/lib/services/staff-attendance";

// V-24 — the staff member's own attendance on the Me tab: today's
// state plus check-in/out. The page reads through
// getMyAttendanceAction (staff.self) and passes the row in, so the
// card can only ever show the caller's own attendance. A pure
// component, so page tests can render it without a data layer.

export function MyAttendanceCard({
  attendance,
}: {
  attendance: MyAttendanceRow | null;
}) {
  const checkedIn = Boolean(attendance?.checkedInAt);
  const checkedOut = Boolean(attendance?.checkedOutAt);

  let summary = "Not checked in yet.";
  if (checkedIn && attendance?.checkedInAt) {
    summary = `Checked in ${formatTimeIST(attendance.checkedInAt)}`;
    if (attendance.lateMinutes > 0) {
      summary += ` · ${attendance.lateMinutes} min late`;
    }
    if (checkedOut && attendance.checkedOutAt) {
      summary += ` · out ${formatTimeIST(attendance.checkedOutAt)}`;
    }
  } else if (attendance && !checkedIn) {
    summary =
      attendance.note ??
      `Marked ${attendance.status.replace("_", " ")} for today.`;
  }

  return (
    <section className="mt-5 rounded-card border border-line bg-paper p-4">
      <h2 className="flex items-center gap-1.5 font-display text-[15px] font-semibold">
        <Clock size={15} className="text-ink-3" />
        Today&apos;s attendance
      </h2>
      <p className="mt-2 text-[13px] text-ink-2">{summary}</p>
      <StaffCheckInControls checkedIn={checkedIn} checkedOut={checkedOut} />
    </section>
  );
}
